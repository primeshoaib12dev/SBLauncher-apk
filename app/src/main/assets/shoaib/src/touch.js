'use strict';
// Touch-control layouts (Pojav/Battly-style on-screen buttons): storage, validation, import/export, default layout.
// This is the layout data + editor backend. Sending the presses into a running game needs a runtime that can inject input (not included yet).
const fs = require('fs');
const path = require('path');

const KEY_RE = /^key\.(keyboard|mouse)\.[a-z0-9._]+$/;
const TYPES = ['key', 'joystick', 'look'];
const SHAPES = ['round', 'pill', 'square', 'area'];
const MAX_KEYS = 4; // a button can press up to 4 keys together (for example F3 + F4)

function defaultLayout() {
  const k = (id, name, label, icon, keys, x, y, w, h, shape = 'round', extra = {}) => ({ id, type: 'key', name, label, icon, keys, toggle: false, x, y, w, h, shape, ...extra });
  return { buttons: [
    { id: 'move', type: 'joystick', name: 'Move', label: '', icon: '', keys: { up: 'key.keyboard.w', left: 'key.keyboard.a', down: 'key.keyboard.s', right: 'key.keyboard.d' }, toggle: false, x: 5, y: 50, w: 14, h: 38, shape: 'round' },
    { id: 'look', type: 'look', name: 'Look', label: '', icon: '', keys: [], toggle: false, x: 34, y: 14, w: 36, h: 62, shape: 'area' },
    k('jump', 'Jump', '', '\u2B06\uFE0F', ['key.keyboard.space'], 82, 52, 12, 26),
    k('sneak', 'Sneak', '', '\u2B07\uFE0F', ['key.keyboard.left.shift'], 70, 76, 8, 18),
    k('attack', 'Attack', '', '\uD83D\uDDE1\uFE0F', ['key.mouse.left'], 72, 42, 8, 18),
    k('use', 'Use', '', '\uD83D\uDEE1\uFE0F', ['key.mouse.right'], 88, 36, 8, 18),
    k('sprint', 'Sprint', '', '\uD83D\uDC5F', ['key.keyboard.left.control'], 64, 56, 8, 18),
    k('inv', 'Inventory', '', '\uD83C\uDF92', ['key.keyboard.e'], 62, 76, 8, 18),
    k('shot', 'Screenshot', '', '\uD83D\uDCF7', ['key.keyboard.f2'], 24, 2, 6, 11, 'square'),
    k('list', 'Players', '', '\uD83D\uDCCB', ['key.keyboard.tab'], 31, 2, 6, 11, 'square'),
    k('f3', 'Debug', '', '\u2139\uFE0F', ['key.keyboard.f3'], 38, 2, 6, 11, 'square'),
    k('chat', 'Chat', '', '\uD83D\uDCAC', ['key.keyboard.t'], 45, 2, 6, 11, 'square'),
    k('pause', 'Pause', '', '\u23F8\uFE0F', ['key.keyboard.escape'], 52, 2, 6, 11, 'square'),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n, i) => k('h' + n, 'Slot ' + n, String(n), '', [`key.keyboard.${n}`], 30 + i * 4.4, 88, 4, 9, 'square')),
  ] };
}

const cleanKey = (v) => (typeof v === 'string' && KEY_RE.test(v) && v !== 'key.keyboard.unknown' ? v : '');
function num(v, lo, hi, name) { const x = Number(v); if (!(x >= lo && x <= hi)) throw new Error(`${name} must be between ${lo} and ${hi}`); return Math.round(x * 100) / 100; }

/** Validates a layout and returns a clean copy. Accepts the old format ({key} / no icon) too. */
function validate(layout) {
  if (!layout || !Array.isArray(layout.buttons)) throw new Error('Invalid layout');
  if (layout.buttons.length > 80) throw new Error('Too many buttons (max 80)');
  const ids = new Set();
  return { buttons: layout.buttons.map((b) => {
    if (!TYPES.includes(b.type)) throw new Error(`Unknown button type ${b.type}`);
    const id = String(b.id || '').slice(0, 24); if (!id || ids.has(id)) throw new Error('Buttons need unique ids'); ids.add(id);
    const out = { id, type: b.type, name: String(b.name || b.label || id).slice(0, 24), label: String(b.label || '').slice(0, 10), icon: String(b.icon || '').slice(0, 8),
      toggle: !!b.toggle, x: num(b.x, 0, 100, 'x'), y: num(b.y, 0, 100, 'y'), w: num(b.w, 2, 60, 'width'), h: num(b.h, 2, 90, 'height'), shape: SHAPES.includes(b.shape) ? b.shape : 'round' };
    if (b.type === 'key') {
      const raw = Array.isArray(b.keys) ? b.keys : (b.key ? [b.key] : []);
      if (raw.length > MAX_KEYS) throw new Error(`A button can press at most ${MAX_KEYS} keys`);
      for (const k of raw) if (k && k !== 'key.keyboard.unknown' && !KEY_RE.test(k)) throw new Error(`Invalid key for ${id}`);
      out.keys = raw.map(cleanKey);
      if (!out.keys.some(Boolean)) throw new Error(`Button "${out.name}" needs at least one key`);
    } else if (b.type === 'joystick') {
      out.keys = {}; for (const d of ['up', 'left', 'down', 'right']) { if (!KEY_RE.test(b.keys?.[d] || '')) throw new Error(`Joystick ${d} key invalid`); out.keys[d] = b.keys[d]; }
    } else out.keys = [];
    return out;
  }) };
}

class Touch {
  constructor(svc) { this.svc = svc; this.file = path.join(svc.d.root, 'touch-layouts.json'); }
  _read() { try { const d = JSON.parse(fs.readFileSync(this.file, 'utf8')); return { active: d.active || 'Default', layouts: d.layouts || {} }; } catch { return { active: 'Default', layouts: {} }; } }
  _write(d) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(d, null, 2)); }
  list() {
    const d = this._read(); const layouts = { Default: defaultLayout() };
    for (const [n, l] of Object.entries(d.layouts)) { try { layouts[n] = validate(l); } catch { /* skip a corrupted layout */ } }
    return { active: layouts[d.active] ? d.active : 'Default', names: Object.keys(layouts), layouts };
  }
  save(name, layout) {
    name = String(name || '').trim(); if (!name || name.length > 30) throw new Error('Layout name must be 1-30 characters');
    if (name === 'Default') throw new Error('The Default layout is built in. Save your edits under another name.');
    const d = this._read(); d.layouts[name] = validate(layout); this._write(d); return this.list();
  }
  delete(name) { if (name === 'Default') throw new Error('Cannot delete the Default layout'); const d = this._read(); delete d.layouts[name]; if (d.active === name) d.active = 'Default'; this._write(d); return this.list(); }
  setActive(name) { const l = this.list(); if (!l.layouts[name]) throw new Error('Layout not found'); const d = this._read(); d.active = name; this._write(d); return this.list(); }
  exportLayout(name, dest) {
    const l = this.list(); if (!l.layouts[name]) throw new Error('Layout not found');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify({ format: 'shoaib-touch-layout', version: 1, name, layout: l.layouts[name] }, null, 2)); return { name };
  }
  importLayout(file) {
    let d; try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('Not a valid layout file'); }
    if (d.format !== 'shoaib-touch-layout') throw new Error('This is not a Shoaib touch layout file');
    const clean = validate(d.layout); let name = String(d.name || 'Imported').slice(0, 26).trim() || 'Imported';
    const taken = new Set(this.list().names); let n = name, i = 1; while (taken.has(n)) n = `${name} (${++i})`;
    this.save(n, clean); return { name: n, ...this.list() };
  }
}
module.exports = { Touch, defaultLayout, validate, MAX_KEYS };
