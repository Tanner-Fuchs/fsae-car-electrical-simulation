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
  const box = document.createElement('div');
  box.id = 'pyLoading';
  box.style.cssText = 'position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:var(--bg,#f3f4f6);color:var(--ink,#12161d);font:15px/1.5 system-ui,sans-serif;text-align:center;padding:24px';
  box.innerHTML = '<div><b style="font-size:18px">BR27 Electrical Simulator</b><br><span id="pyLoadMsg">Starting Python…</span><br><small style="opacity:.7">The first visit downloads about 12 MB. After that it opens from the cache.</small></div>';
  document.body.appendChild(box);
  const say = t => { document.getElementById('pyLoadMsg').textContent = t; };
  const loadScript = src => new Promise((ok, fail) => {
    const s = document.createElement('script'); s.src = src; s.async = false;
    s.onload = ok; s.onerror = () => fail(new Error('could not load ' + src));
    document.body.appendChild(s);
  });

  try {
    await loadScript(BOOT.pyodide + 'pyodide.js');
    const py = await loadPyodide({ indexURL: BOOT.pyodide });
    say('Loading the car model…');
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

    say('Opening…');
    for (const src of BOOT.scripts) await loadScript(src);
    box.remove();
  } catch (e) {
    console.error(e);
    say('Could not start: ' + (e && e.message || e) + '. Check the connection and reload.');
    if (window.BRShowError) window.BRShowError('starting Python', e);
  }
})();
