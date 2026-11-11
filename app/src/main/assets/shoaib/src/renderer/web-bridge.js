'use strict';
// Browser/WebView implementation of window.shoaib (used when the page is served by src/server.js; Electron's preload defines it otherwise).
(function () {
  if (window.shoaib) return;
  const q = new URLSearchParams(location.search);
  const store = { get() { try { return localStorage.getItem('shoaib-token') || ''; } catch { return ''; } }, set(v) { try { localStorage.setItem('shoaib-token', v); } catch { /* storage blocked: kept in memory */ } } };
  let token = q.get('t') || store.get();
  if (q.get('t')) { store.set(token); try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ } }
  const headers = () => ({ 'content-type': 'application/json', 'x-shoaib-token': token });
  let eventCb = null; let es = null;
  function connect() { if (!eventCb) return; if (es) es.close(); es = new EventSource('/api/events?t=' + encodeURIComponent(token)); es.onmessage = (e) => { try { const m = JSON.parse(e.data); eventCb(m.name, m.payload); } catch { /* ignore */ } }; }
  function askToken() {
    const v = prompt('The access token is missing or changed. Paste the full link shown in Termux (it looks like http://127.0.0.1:8787/?t=...):') || '';
    const m = /[?&]t=([a-f0-9]{48})/.exec(v) || /^\s*([a-f0-9]{48})\s*$/.exec(v);
    if (!m) return false; token = m[1]; store.set(token); connect(); return true;
  }
  async function call(method, ...args) {
    for (let attempt = 0; ; attempt++) {
      let r; try { r = await fetch('/api/call', { method: 'POST', headers: headers(), body: JSON.stringify({ method, args }) }); } catch { throw new Error('Cannot reach the launcher. Is it still running in Termux/terminal?'); }
      if (r.status === 401 && attempt === 0 && askToken()) continue;
      let j; try { j = await r.json(); } catch { throw new Error('Unexpected answer from the launcher'); }
      if (!j.ok) throw new Error(j.error || 'Request failed'); return j.data;
    }
  }
  try { if (navigator.serviceWorker) navigator.serviceWorker.register('/sw.js').catch(() => {}); } catch { /* not supported */ }
  function chooser(accept) {
    return new Promise((resolve) => {
      const i = document.createElement('input'); i.type = 'file'; if (accept) i.accept = accept;
      i.addEventListener('change', async () => {
        const f = i.files && i.files[0]; if (!f) return resolve(null);
        try { const r = await fetch('/api/upload?name=' + encodeURIComponent(f.name), { method: 'POST', headers: { 'x-shoaib-token': token }, body: f }); const j = await r.json(); if (!j.ok) throw new Error(j.error); resolve(j.path); }
        catch (e) { alert('Upload failed: ' + e.message); resolve(null); }
      });
      i.addEventListener('cancel', () => resolve(null)); i.click();
    });
  }
  const accept = (o) => ((o && o.filters) || []).flatMap((f) => f.extensions || []).filter((x) => x !== '*').map((x) => '.' + x).join(',');
  window.shoaib = {
    call,
    onEvent(cb) { eventCb = cb; connect(); },
    pickFile: (o) => chooser(accept(o)),
    pickSave: async (o) => call('exportPath', (o && o.defaultPath) || 'export'),
    afterSave: async (p) => { const a = document.createElement('a'); a.href = '/api/download?t=' + encodeURIComponent(token) + '&path=' + encodeURIComponent(p); a.download = ''; document.body.appendChild(a); a.click(); a.remove(); },
    pickFolder: async () => { const v = prompt('Folder path on this device (for example /storage/emulated/0/ShoaibLauncher):'); return v && v.trim() ? v.trim() : null; },
    pickJava: async () => { const v = prompt('Full path of the java executable:'); return v && v.trim() ? v.trim() : null; },
    openExternal: async (u) => { window.open(u, '_blank', 'noopener'); return true; },
    openInstanceFolder: async (id, sub) => { alert('Folder on this device:\n' + (await call('instanceFolder', id, sub))); },
    openLauncherFolder: async () => { alert('Launcher data folder:\n' + (await call('getStorage')).root); },
    relaunch: async () => { alert('Stop the launcher (Ctrl+C in Termux) and start it again to apply the change.'); },
  };
})();
