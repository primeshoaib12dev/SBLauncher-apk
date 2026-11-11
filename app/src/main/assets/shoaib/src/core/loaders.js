'use strict';
// Mod loaders: Fabric/Quilt (official profile JSON), Forge/NeoForge (official installer jar, run with Java), OptiFine (user-supplied jar, patched with its own Patcher).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const V = require('./versions');
const { downloadFile } = require('./download');
const { listEntries, extractZip } = require('./zip');

const LOADER_URLS = {
  fabric: 'https://meta.fabricmc.net/v2',
  quilt: 'https://meta.quiltmc.org/v3',
  forge: 'https://maven.minecraftforge.net/net/minecraftforge/forge',
  forgePromos: 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
  neoforge: 'https://maven.neoforged.net/releases/net/neoforged/neoforge',
};
const SUPPORTED = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge', 'optifine'];
const NEEDS_INSTALLER = new Set(['forge', 'neoforge', 'optifine']);
const NAMES = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', optifine: 'OptiFine' };

async function fetchText(url) {
  let res; try { res = await fetch(url, { headers: { 'User-Agent': 'ShoaibLauncher/1.0' }, signal: AbortSignal.timeout(20000) }); } catch (e) { throw new Error(`Cannot reach ${new URL(url).hostname} (${e.cause?.code || e.message})`); }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`); return res.text();
}
const parseMetadata = (xml) => [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);

async function forgeVersions(mc, urls) {
  const all = parseMetadata(await fetchText(`${urls.forge}/maven-metadata.xml`)).filter((v) => v.startsWith(mc + '-'));
  if (!all.length) throw new Error(`Forge does not support Minecraft ${mc}`);
  let promos = {}; try { promos = (await V.fetchJson(urls.forgePromos)).promos || {}; } catch { /* promotions are optional */ }
  const rec = promos[`${mc}-recommended`]; const latest = promos[`${mc}-latest`];
  return all.map((v) => v.slice(mc.length + 1)).reverse().map((version) => ({ version, stable: true, recommended: version === rec, latest: version === latest }));
}
/** NeoForge versions are numbered after Minecraft: 1.21.1 -> 21.1.x, 1.21 -> 21.0.x. */
function neoPrefix(mc) { const m = /^1\.(\d+)(?:\.(\d+))?$/.exec(mc); return m ? `${m[1]}.${m[2] || 0}.` : `${mc}.`; }
async function neoVersions(mc, urls) {
  const pre = neoPrefix(mc);
  const all = parseMetadata(await fetchText(`${urls.neoforge}/maven-metadata.xml`)).filter((v) => v.startsWith(pre));
  if (!all.length) throw new Error(`NeoForge does not support Minecraft ${mc}`);
  return all.reverse().map((version) => ({ version, stable: !/alpha|beta|rc|snapshot/i.test(version) }));
}

/** Loader versions that exist for a Minecraft version (newest first). Throws a clear error if unsupported. */
async function loaderVersions(loader, mc, urls = LOADER_URLS) {
  if (loader === 'vanilla' || loader === 'optifine') return [];
  if (loader === 'forge') return forgeVersions(mc, urls);
  if (loader === 'neoforge') return neoVersions(mc, urls);
  if (!urls[loader]) throw new Error(`${loader} is not supported yet`);
  let list;
  try { list = await V.fetchJson(`${urls[loader]}/versions/loader/${encodeURIComponent(mc)}`); }
  catch (e) { throw new Error(`Could not load ${loader} versions for ${mc}: ${e.message}`); }
  if (!Array.isArray(list) || !list.length) throw new Error(`${loader} does not support Minecraft ${mc}`);
  return list.map((x) => ({ version: x.loader.version, stable: x.loader.stable !== false }));
}

/** Fabric/Quilt: download the official launcher profile and register it as a local version. Returns its version id. */
async function installLoaderProfile(d, loader, mc, loaderVersion, urls = LOADER_URLS) {
  if (loader === 'vanilla') return mc;
  if (NEEDS_INSTALLER.has(loader)) throw new Error(`${NAMES[loader]} is installed with its own installer`);
  const versions = await loaderVersions(loader, mc, urls);
  const lv = loaderVersion || (versions.find((v) => v.stable) || versions[0]).version;
  if (!versions.some((v) => v.version === lv)) throw new Error(`${loader} ${lv} is not available for Minecraft ${mc}`);
  const profile = await V.fetchJson(`${urls[loader]}/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(lv)}/profile/json`);
  if (!profile?.id || !profile.mainClass) throw new Error(`Invalid ${loader} profile received`);
  const dir = path.join(d.versions, profile.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${profile.id}.json`), JSON.stringify(profile));
  return profile.id;
}

/** Run a Java process, streaming lines. Never throws. */
function runJava(javaPath, args, { cwd, onLine = () => {}, onProcess = () => {}, timeoutMs = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(javaPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    onProcess(child);
    const lines = []; let buf = '';
    const feed = (data) => { buf += data.toString(); let i; while ((i = buf.indexOf('\n')) > -1) { const l = buf.slice(0, i).trimEnd(); buf = buf.slice(i + 1); if (l) { lines.push(l); if (lines.length > 300) lines.shift(); onLine(l); } } };
    child.stdout.on('data', feed); child.stderr.on('data', feed);
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, lines, error: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code === null ? -1 : code, lines }); });
  });
}
const tail = (lines, n = 12) => lines.slice(-n).join('\n');

/** Forge / NeoForge: download the official installer (checksum verified when published) and run `--installClient`. Returns the new version id. */
async function installForgeLike(d, { loader, mc, loaderVersion, javaPath, urls = LOADER_URLS, onLine, onProcess }) {
  const versions = await loaderVersions(loader, mc, urls);
  const lv = loaderVersion || (versions.find((v) => v.recommended) || versions.find((v) => v.stable) || versions[0]).version;
  if (!versions.some((v) => v.version === lv)) throw new Error(`${NAMES[loader]} ${lv} is not available for Minecraft ${mc}`);
  const full = loader === 'forge' ? `${mc}-${lv}` : lv;
  const url = loader === 'forge' ? `${urls.forge}/${full}/forge-${full}-installer.jar` : `${urls.neoforge}/${lv}/neoforge-${lv}-installer.jar`;
  const dest = path.join(d.cache, 'installers', path.basename(url));
  let sha1; try { sha1 = (await fetchText(url + '.sha1')).trim().split(/\s+/)[0]; if (!/^[a-f0-9]{40}$/i.test(sha1)) sha1 = undefined; } catch { /* checksum not published */ }
  await downloadFile({ url, dest, sha1 });
  fs.mkdirSync(d.mc, { recursive: true });
  const lp = path.join(d.mc, 'launcher_profiles.json'); if (!fs.existsSync(lp)) fs.writeFileSync(lp, JSON.stringify({ profiles: {}, version: 3 }));
  const before = new Set(fs.existsSync(d.versions) ? fs.readdirSync(d.versions) : []);
  const r = await runJava(javaPath, ['-Djava.awt.headless=true', '-jar', dest, '--installClient', d.mc], { cwd: d.mc, onLine, onProcess });
  if (r.code !== 0) throw new Error(`${NAMES[loader]} installer failed (exit ${r.code}${r.error ? ', ' + r.error : ''}).\n${tail(r.lines)}`);
  const has = (id) => fs.existsSync(path.join(d.versions, id, `${id}.json`));
  const created = fs.readdirSync(d.versions).filter((x) => !before.has(x) && has(x));
  const guess = [`${mc}-forge-${lv}`, `${mc}-forge${mc}-${lv}`, `neoforge-${lv}`, `${mc}-forge-${lv.replace(/-.*/, '')}`];
  const id = created.find((x) => /forge/i.test(x)) || created[0] || guess.find(has);
  if (!id) throw new Error(`${NAMES[loader]} installer finished but no new version was found.\n${tail(r.lines)}`);
  return id;
}

// ---------------- OptiFine ----------------
/** Reads an OptiFine jar the user downloaded from optifine.net: Minecraft version + edition (e.g. HD_U_J9). */
function inspectOptiFine(jarPath) {
  const m = /OptiFine_(.+?)_(HD_[A-Za-z0-9_]+?)(?:_pre\d+)?\.jar$/i.exec(path.basename(String(jarPath || '')));
  if (!m) throw new Error('This file name is not an OptiFine jar (expected something like OptiFine_1.21.1_HD_U_J9.jar)');
  let entries; try { entries = listEntries(fs.readFileSync(jarPath)); } catch { throw new Error('Cannot read this file as a jar'); }
  if (!entries.some((e) => e.name === 'optifine/Installer.class')) throw new Error('This jar is not the OptiFine installer jar from optifine.net');
  const lw = entries.map((e) => /^launchwrapper-of-([0-9.]+)\.jar$/.exec(e.name)).find(Boolean);
  return { mc: m[1], edition: m[2], launchwrapper: lw ? lw[1] : null, file: path.basename(jarPath) };
}
/** Copy the chosen jar into the launcher so later installs do not depend on the original location. */
function stageOptiFine(d, mc, jarPath) {
  const info = inspectOptiFine(jarPath);
  if (info.mc !== mc) throw new Error(`This OptiFine is for Minecraft ${info.mc}, but the profile uses ${mc}`);
  const dest = path.join(d.cache, 'optifine', info.file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(jarPath, dest);
  return { ...info, staged: dest };
}
function buildOptiFineVersion(parent, { id, mc, verName, launchwrapper }) {
  const v = { id, inheritsFrom: mc, type: parent.type || 'release', time: parent.time, releaseTime: parent.releaseTime, mainClass: 'net.minecraft.launchwrapper.Launch',
    libraries: [{ name: `optifine:OptiFine:${verName}`, shoaibLocal: true }, launchwrapper ? { name: `optifine:launchwrapper-of:${launchwrapper}`, shoaibLocal: true } : { name: 'net.minecraft:launchwrapper:1.12' }] };
  if (parent.minecraftArguments) v.minecraftArguments = `${parent.minecraftArguments} --tweakClass optifine.OptiFineTweaker`;
  else v.arguments = { game: ['--tweakClass', 'optifine.OptiFineTweaker'] };
  return v;
}
/** Patch the vanilla jar with OptiFine's own Patcher, extract its launchwrapper and register the version. Returns the new version id. */
async function installOptiFine(d, { mc, jarPath, javaPath, onLine, onProcess }) {
  const info = stageOptiFine(d, mc, jarPath); const verName = `${mc}_${info.edition}`; const id = `${mc}-OptiFine_${info.edition}`;
  const vanilla = path.join(d.versions, mc, `${mc}.jar`); if (!fs.existsSync(vanilla)) throw new Error(`Minecraft ${mc} must be downloaded before OptiFine`);
  const out = path.join(d.libraries, 'optifine', 'OptiFine', verName, `OptiFine-${verName}.jar`); fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = await runJava(javaPath, ['-cp', info.staged, 'optifine.Patcher', vanilla, info.staged, out], { cwd: d.mc, onLine, onProcess });
  if (r.code !== 0 || !fs.existsSync(out)) throw new Error(`OptiFine patching failed (exit ${r.code}${r.error ? ', ' + r.error : ''}).\n${tail(r.lines)}`);
  if (info.launchwrapper) extractZip(info.staged, d.libraries, { filter: (n) => (n === `launchwrapper-of-${info.launchwrapper}.jar` ? `optifine/launchwrapper-of/${info.launchwrapper}/launchwrapper-of-${info.launchwrapper}.jar` : false) });
  const parent = await V.getVersionJson(d, mc);
  const dir = path.join(d.versions, id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(buildOptiFineVersion(parent, { id, mc, verName, launchwrapper: info.launchwrapper })));
  return id;
}

module.exports = { loaderVersions, installLoaderProfile, installForgeLike, installOptiFine, inspectOptiFine, stageOptiFine, buildOptiFineVersion, neoPrefix, runJava, LOADER_URLS, SUPPORTED, NEEDS_INSTALLER, NAMES };
