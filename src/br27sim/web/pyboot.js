/*
 * Web version only (iPad, iPhone, any browser, no install). There is no local server:
 * this file starts Python in the browser with Pyodide, loads the br27sim package and
 * answers the page's requests by calling br27sim.server.handle(), the same function
 * the local server uses. Then it loads the page scripts in order.
 * Settings and imported CAD files are kept in the browser (IndexedDB).
 * tools/build_web.py writes window.BR27_BOOT before this file.
 */
(async function () {
  'use strict';
  const BOOT = window.BR27_BOOT;
  // a cached copy of the page from before the last update: reload once, bypassing the cache
  try {
    const live = await (await fetch('version.json', { cache: 'no-store' })).json();
    const u = new URL(location.href);
    if (BOOT.version && live.version && live.version !== BOOT.version && u.searchParams.get('v') !== live.version) {
      u.searchParams.set('v', live.version);
      location.replace(u.toString());
      return;
    }
  } catch (e) { /* offline or local build: carry on with this copy */ }
  const box = document.createElement('div');
  box.id = 'pyLoading';
  // the same Bobcat Racing boot screen as the dash computer (splash.js), while Python loads
  box.style.cssText = 'position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:#050404;color:#9aa4b1;font:13px/1.5 system-ui,sans-serif;text-align:center;padding:16px;transition:opacity .35s';
  box.innerHTML = '<div style="width:min(100%,960px)"><svg id="pySplash" viewBox="0 0 800 480" style="width:100%;height:auto;display:block;border-radius:6px" role="img" aria-label="Bobcat Racing, starting up"></svg>' +
    '<p id="pyLoadMsg" style="margin:10px 0 0">Starting Python…</p><small style="opacity:.7">The first visit downloads about 12 MB. After that it opens from the cache.</small></div>';
  document.body.appendChild(box);
  const log = [], t0 = performance.now();
  let prog = 0.04, shown = 0, anim = 0;
  const say = (t, p) => { document.getElementById('pyLoadMsg').textContent = t; if (p != null) prog = p; log.push(t.replace(/…$/, '')); };
  const paint = now => {
    shown += (prog - shown) * 0.08;
    if (window.BRSplash) document.getElementById('pySplash').innerHTML = window.BRSplash.frame(shown, (now - t0) / 1000, log, 'BR27 Electrical Simulator');
    anim = requestAnimationFrame(paint);
  };
  const loadScript = src => new Promise((ok, fail) => {
    const s = document.createElement('script'); s.src = src; s.async = false;
    s.onload = ok; s.onerror = () => fail(new Error('could not load ' + src));
    document.body.appendChild(s);
  });

  try {
    const splashSrc = BOOT.scripts.find(x => x.startsWith('splash.js'));
    if (splashSrc) { try { await loadScript(splashSrc); } catch (e) { /* plain text loading screen */ } }
    say('Starting Python…', 0.1);
    anim = requestAnimationFrame(paint);
    await loadScript(BOOT.pyodide + 'pyodide.js');
    const py = await loadPyodide({ indexURL: BOOT.pyodide });
    say('Loading the car model…', 0.55);
    const DATA = '/home/pyodide/.br27sim';
    let persist = () => Promise.resolve();
    try {
      py.FS.mkdirTree(DATA);
      py.FS.mount(py.FS.filesystems.IDBFS, {}, DATA);
      await new Promise(ok => py.FS.syncfs(true, () => ok()));
      persist = () => new Promise(ok => py.FS.syncfs(false, () => ok()));
    } catch (e) { console.warn('CAD files will not be kept after closing the page', e); }

    const zip = await (await fetch(BOOT.pkg, { cache: 'no-cache' })).arrayBuffer();
    py.unpackArchive(zip, 'zip', { extractDir: '/home/pyodide/lib' });
    const pyHandle = py.runPython(`
import sys
sys.path.insert(0, '/home/pyodide/lib')
from br27sim.server import handle

def js_handle(method, path, query, body):
    if body is not None and not isinstance(body, (str, bytes)):
        body = bytes(body.to_py())
    code, out, ctype = handle(method, path, query, body if body is not None else b"")
    if isinstance(out, str):
        return [code, ctype, out, None]
    return [code, ctype, None, out]
js_handle`);

    const run = (method, url, body) => {
      const u = new URL(url, 'http://local');
      const r = pyHandle(method, u.pathname, u.search.slice(1), body == null ? undefined : body);
      const [status, ctype, text, bytes] = r.toJs();
      r.destroy();
      return { status, ctype, text, bytes };
    };
    // bridge.js calls this synchronously for every model call
    window.BR27_LOCAL = (method, url, body) => { const r = run(method, url, body); return { status: r.status, text: r.text }; };
    // CAD import and STL files go through fetch(); answer those from Python too
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!url.startsWith('/api/') && !url.startsWith('/cad-files/')) return realFetch(input, init);
      const method = (init && init.method) || 'GET';
      let body = init && init.body;
      if (body instanceof ArrayBuffer) body = new Uint8Array(body);
      const r = run(method, url, body);
      if (method === 'POST' && r.status === 200) await persist();
      return new Response(r.bytes || r.text, { status: r.status, headers: { 'Content-Type': r.ctype } });
    };

    say('Starting dash…', 0.8);
    for (const src of BOOT.scripts) { if (src !== splashSrc) await loadScript(src); }
    prog = 1;
    await new Promise(ok => setTimeout(ok, 450));
    box.style.opacity = '0';
    await new Promise(ok => setTimeout(ok, 350));
    cancelAnimationFrame(anim);
    box.remove();
  } catch (e) {
    console.error(e);
    say('Could not start: ' + (e && e.message || e) + '. Check the connection and reload.');
    if (window.BRShowError) window.BRShowError('starting Python', e);
  }
})();
