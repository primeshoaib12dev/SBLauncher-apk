#!/usr/bin/env node
'use strict';
// Run the launcher in a browser:  node src/web.js [--port 8787] [--host 127.0.0.1]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Service } = require('./service');
const { startServer } = require('./server');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const port = Number(arg('port', 8787)); const host = arg('host', '127.0.0.1');
const svc = new Service();
// Keep a log file next to the data (an Android app has no visible console) and never die from a stray error.
const logFile = path.join(svc.d.root, 'web.log');
for (const k of ['log', 'error']) { const orig = console[k].bind(console); console[k] = (...a) => { orig(...a); try { fs.appendFileSync(logFile, a.map(String).join(' ') + '\n'); } catch { /* ignore */ } }; }
process.on('uncaughtException', (e) => console.error('Unexpected error: ' + (e && e.stack || e)));
process.on('unhandledRejection', (e) => console.error('Unhandled rejection: ' + (e && e.stack || e)));
const tokenFile = path.join(svc.d.root, 'web-token');
let token; try { token = fs.readFileSync(tokenFile, 'utf8').trim(); } catch { /* first run */ }
if (/^[a-f0-9]{48}$/.test(process.env.SHOAIB_WEB_TOKEN || '')) token = process.env.SHOAIB_WEB_TOKEN; // set by the Android app
else if (!/^[a-f0-9]{48}$/.test(token || '')) { token = crypto.randomBytes(24).toString('hex'); fs.writeFileSync(tokenFile, token, { mode: 0o600 }); }

startServer({ service: svc, token, port, host }).then((s) => {
  console.log('\nShoaib Launcher (web mode) is running.\n');
  console.log('Open this link in your browser:\n  ' + s.url + '\n');
  console.log('Data folder: ' + svc.d.root + '\nExports are saved in: ' + s.exportsDir);
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) console.log('\nWARNING: listening on ' + host + ' - anyone on your network with the link can control the launcher. Keep the link private.');
  if (process.platform === 'android') console.log('\nTip (Termux): run  termux-wake-lock  so downloads continue when the screen is off. Press Ctrl+C to stop.');
  const stop = () => s.close().then(() => process.exit(0)); process.on('SIGINT', stop); process.on('SIGTERM', stop);
}).catch((e) => { console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Try: node src/web.js --port ${port + 1}` : e.message); process.exit(1); });
