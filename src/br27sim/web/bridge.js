/*
 * Connects the page to the Python model. The page was written against the
 * JavaScript model (window.BR27Sim, window.BRWiring); this file provides the
 * same objects, but every call runs in Python through the local server
 * started by `br27sim serve`. Calls are synchronous so app.js works unchanged.
 * In the web version (iPad/iPhone) there is no server: pyboot.js runs the same
 * Python in the browser with Pyodide and sets window.BR27_LOCAL to answer requests.
 */
(function () {
  'use strict';
  function request(method, url, body) {
    if (window.BR27_LOCAL) {
      const r = window.BR27_LOCAL(method, url, body === undefined ? undefined : JSON.stringify(body));
      if (r.status !== 200) throw new Error('Python model: ' + r.text);
      return JSON.parse(r.text);
    }
    const x = new XMLHttpRequest();
    x.open(method, url, false);
    if (body !== undefined) x.setRequestHeader('Content-Type', 'application/json');
    x.send(body === undefined ? null : JSON.stringify(body));
    if (x.status !== 200) throw new Error('Python model: ' + (x.responseText || ('HTTP ' + x.status + ', is `br27sim serve` still running?')));
    return JSON.parse(x.responseText);
  }

  const S = request('GET', '/api/constants');
  // The page shows each fault's measured value at t = 3 s; Python sends it precomputed.
  S.FAULTS.forEach(f => { const v = f.scenarioAt3; f.scenario = () => v; });

  // A lap result is large; send its parameters and let Python reuse its cached lap.
  const pack = a => (a && typeof a === 'object' && a.series && a.p && a.lapLen != null ? { __lap__: a.p } : a);
  const call = name => (...args) => request('POST', '/api/call/' + name, { args: args.map(pack) });
  for (const name of S.FUNCTIONS) S[name] = call(name);

  // Keep object identity the page relies on, and values JSON cannot carry.
  const fault = S.simulateFault;
  S.simulateFault = (...a) => { const r = fault(...a); r.f = S.FAULTS.find(f => f.code === r.f.code) || r.f; return r; };
  const phys = S.canPhysical;
  S.canPhysical = (...a) => { const r = phys(...a); if (r.rTotal === null) r.rTotal = Infinity; return r; };
  window.BR27Sim = S;

  // Wiring: data and drawings come from br27sim/wiring.py; the page calls them as functions.
  const W = request('GET', '/api/wiring');
  const wiring = {};
  for (const [k, v] of Object.entries(W)) wiring[k] = W.FUNCTIONS.includes(k) ? () => v : v;
  window.BRWiring = wiring;
})();
