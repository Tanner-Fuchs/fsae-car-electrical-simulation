// BR27 harness in 3D: the CAN node chain, sensor pigtails, battery feed and shutdown loop,
// drawn wire by wire in the team color code. Ported from the "BR27 CAN Node Harness" page.
// Built the first time the Harness 3D tab opens; window.BRHarness3D.mount(el) returns { pause, resume }.
(function () {
  'use strict';
  const C = { H: 0xf4f4f4, L: 0x1d1d1f, V5: 0x2563eb, G: 0x1d1d1f, SIG: 0xeab308, PWR: 0xdc2626 };

  function mount(opts) {
    const stage = opts.stage, labelsEl = opts.labels, table = opts.table;
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    if (!window.THREE || !THREE.OrbitControls) { labelsEl.innerHTML = '<div class="hlb" style="left:50%;top:50%">The 3D library did not load.</div>'; return null; }

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    stage.insertBefore(renderer.domElement, stage.firstChild);
    const cv = renderer.domElement;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 50);
    const controls = new THREE.OrbitControls(camera, cv);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(2, 4, 3); scene.add(sun);
    const sceneBg = () => { scene.background = new THREE.Color(css('--scene') || '#e9ecf0'); };
    sceneBg();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', sceneBg);

    // Authored with +z = car left; three.js puts +z on the driver's right (x forward, y up), so flip z here.
    const V = (x, y, z) => new THREE.Vector3(x, y, -z);
    const W3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.55, metalness: 0.05 }, o));
    const labels = [];
    const addLabel = (text, pos, cls = '', group = 'main', maxDist = 99) => {
      const d = document.createElement('div'); d.className = 'hlb ' + cls; d.textContent = text; labelsEl.appendChild(d);
      labels.push({ d, pos, group, maxDist, below: cls.includes('below'), layer: curLayer }); return d;
    };
    // layers the "Show" buttons switch on and off
    const layers = { can: [], sens: [], power: [], car: [] };
    let curLayer = 'car';
    const add = m => { scene.add(m); layers[curLayer].push(m); return m; };

    // ---- car context: x forward, z left, y up (metres)
    const frameMat = new THREE.LineBasicMaterial({ color: 0x8d98a3 });
    const seg = (a, b) => { add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), frameMat)); };
    [0.38, -0.38].forEach(z => { seg(V(-1.0, 0.05, z), V(1.15, 0.05, z)); seg(V(-1.0, 0.45, z), V(-0.3, 0.75, z)); seg(V(-0.3, 0.75, z), V(1.15, 0.45, z)); });
    [-1.0, -0.3, 0.45, 1.15].forEach(x => seg(V(x, 0.05, 0.38), V(x, 0.05, -0.38)));
    seg(V(-0.3, 0.05, 0.38), V(-0.3, 1.05, 0.0)); seg(V(-0.3, 0.05, -0.38), V(-0.3, 1.05, 0.0));
    seg(V(0.6, 0.05, 0.38), V(0.6, 0.72, 0)); seg(V(0.6, 0.05, -0.38), V(0.6, 0.72, 0));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), mat(0x9aa4ad, { transparent: true, opacity: 0.18 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; scene.add(ground);
    const wheels = { FL: V(0.8, 0.23, 0.62), FR: V(0.8, 0.23, -0.62), RL: V(-0.8, 0.23, 0.62), RR: V(-0.8, 0.23, -0.62) };
    Object.values(wheels).forEach(p => { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.2, 32), mat(0x2b3036, { transparent: true, opacity: 0.14, depthWrite: false })); w.rotation.x = Math.PI / 2; w.position.copy(p); add(w); });
    // firewall: one sheet bent about 135 deg: a vertical back panel, then a lower leg sloping forward and down to the floor.
    // The battery and EMU sit in the wedge under the sloped leg (engine side). Grommets go through the sloped leg.
    const fwMat = mat(0xb8c2cc, { transparent: true, opacity: 0.24, side: THREE.DoubleSide, depthWrite: false });
    const quad = (a, b, c, d) => { const g = new THREE.BufferGeometry().setFromPoints([a, b, c, a, c, d]); g.computeVertexNormals(); add(new THREE.Mesh(g, fwMat)); };
    const BEND = 0.55, FOOT = 0.2;   // bend height, x where the sloped leg meets the floor
    quad(V(-0.3, 0.95, 0.38), V(-0.3, 0.95, -0.38), V(-0.3, BEND, -0.38), V(-0.3, BEND, 0.38));
    quad(V(-0.3, BEND, 0.38), V(-0.3, BEND, -0.38), V(FOOT, 0.05, -0.38), V(FOOT, 0.05, 0.38));
    addLabel('Firewall: one sheet, ~135° bend', V(-0.3, 0.98, 0.3));
    const onSlope = x => BEND - (x + 0.3);
    const SLOPE_N = W3(1, 1, 0).normalize();
    const grommet = (x, z, r, name) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 10, 24), mat(0x111111)); m.position.copy(V(x, onSlope(x), z)); m.quaternion.setFromUnitVectors(W3(0, 0, 1), SLOPE_N); add(m); addLabel(name, V(x, onSlope(x) + 0.04, z), '', 'main', 2.4); };
    grommet(0.1, 0.17, 0.025, 'Grommet (C03)');

    // ---- dash unit: display, dash MCU, fuses, relays and 5 V converters in one enclosure
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.3), mat(0x64748b, { transparent: true, opacity: 0.22, depthWrite: false }));
    box.position.set(0.76, 0.5, 0); add(box);
    const disp = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.24), mat(0x0b1220, { emissive: 0x0b2a4a })); disp.position.set(0.605, 0.52, 0); add(disp);
    const boxEdges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: 0x475569 })); boxEdges.position.copy(box.position); add(boxEdges);
    addLabel('Dash unit (dash + fuse/relay box)', V(0.76, 0.62, 0.0), 'node');
    const blk = (sz, p, c, name) => { const m = new THREE.Mesh(new THREE.BoxGeometry(...sz), mat(c)); m.position.copy(p); add(m); if (name) addLabel(name, p.clone().add(V(0, sz[1] / 2 + 0.01, 0)), '', 'main', 1.3); return m; };
    blk([0.06, 0.03, 0.1], V(0.68, 0.47, 0.0), 0x111827, 'Dash MCU');
    blk([0.07, 0.03, 0.06], V(0.82, 0.44, 0.08), 0x52525b, 'Fuse/relay box');
    blk([0.045, 0.02, 0.03], V(0.85, 0.43, -0.08), 0x334155, '5 V conv (nodes)');
    blk([0.045, 0.02, 0.03], V(0.85, 0.43, 0.0), 0x334155, '5 V conv (dash)');
    // ---- under the sloped firewall leg: battery, EMU and the CAN splice
    blk([0.12, 0.035, 0.1], V(-0.06, 0.1, 0.05), 0x1f2937, '');
    addLabel('EMU Black', V(-0.06, 0.13, 0.05), '', 'main', 99);
    blk([0.03, 0.015, 0.02], V(0.06, 0.1, -0.02), 0x0f766e, '');
    addLabel('CAN splice (EMU tap)', V(0.06, 0.08, -0.02), 'below', 'main', 2.4);
    blk([0.149, 0.093, 0.087], V(-0.16, 0.1, 0.25), 0x166534, '');
    addLabel('Battery NLP14', V(-0.16, 0.16, 0.25), '', 'main', 2.4);
    const port = (p, rotZ, name) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 20), mat(0x9ca3af, { metalness: 0.6, roughness: 0.3 })); m.rotation.z = rotZ; m.position.copy(p); add(m); addLabel(name, p.clone().add(V(0, 0.03, 0)), '', 'main', 2.2); };
    const P1 = V(0.925, 0.45, -0.07);
    port(P1, Math.PI / 2, 'P1 M12 chain');
    grommet(0.14, 0.05, 0.025, 'Grommet (kill bus W040)');

    // ---- nodes
    const nodePos = { FL: V(0.78, 0.2, 0.4), FR: V(0.78, 0.2, -0.4), RL: V(-0.78, 0.2, 0.4), RR: V(-0.78, 0.2, -0.4) };
    Object.entries(nodePos).forEach(([k, p]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.08), mat(0x374151)); m.position.copy(p); add(m);
      addLabel('Node ' + k, p.clone().add(V(0, 0.05, 0)), 'node');
    });
    const term = (p, name) => { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.03, 12), mat(0xd6b98c)); r.rotation.z = Math.PI / 2; r.position.copy(p); add(r); addLabel(name, p.clone().add(V(0, -0.02, 0)), 'term below'); };
    term(V(0.7, 0.5, -0.08), '120 Ω terminator (in dash)');
    term(V(-0.78, 0.235, 0.4), '120 Ω terminator');
    addLabel('EMU terminator OFF', V(-0.12, 0.085, -0.02), 'term below', 'main', 1.3);

    // ---- twisted cable builder
    const wireMeshes = {};
    function strandTube(points, color, r) {
      const curve = new THREE.CatmullRomCurve3(points);
      const g = new THREE.TubeGeometry(curve, Math.max(40, points.length * 2), r, 7, false);
      return add(new THREE.Mesh(g, mat(color, { roughness: 0.4, emissive: 0x000000 })));
    }
    // pairs: [{colors, twist}]; pairs sit side by side along the path binormal.
    function buildCable(id, path, pairs, o = {}) {
      const curve = new THREE.CatmullRomCurve3(path, false, 'centripetal');
      const len = curve.getLength();
      const N = Math.max(80, Math.round(len / 0.004));
      const frames = curve.computeFrenetFrames(N, false);
      const pitch = 0.05, rr = 0.0055, wr = o.wr || 0.0042, sp = 0.018;
      const meshes = [];
      pairs.forEach((pr, pi) => {
        const off = (pi - (pairs.length - 1) / 2) * sp;
        const strands = pr.colors.map(() => []);
        for (let i = 0; i <= N; i++) {
          const t = i / N, p = curve.getPointAt(t), n = frames.normals[i], b = frames.binormals[i];
          const c = p.clone().addScaledVector(b, off);
          pr.colors.forEach((_, si) => {
            if (pr.twist) {
              const th = (t * len / pitch) * Math.PI * 2 + si * Math.PI;
              strands[si].push(c.clone().addScaledVector(n, Math.cos(th) * rr).addScaledVector(b, Math.sin(th) * rr));
            } else strands[si].push(c.clone().addScaledVector(n, (si - (pr.colors.length - 1) / 2) * wr * 2.4));
          });
        }
        pr.colors.forEach((col, si) => meshes.push(strandTube(strands[si], col, wr)));
      });
      // heat-shrink labels 35 mm from each end
      [0.035 / len, 1 - 0.035 / len].forEach(t => {
        t = Math.min(Math.max(t, 0), 1);
        const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.022, 20, 1, true), mat(0xfafafa, { side: THREE.DoubleSide }));
        sl.position.copy(curve.getPointAt(t)); sl.quaternion.setFromUnitVectors(W3(0, 1, 0), curve.getTangentAt(t)); add(sl); meshes.push(sl);
      });
      wireMeshes[id] = meshes;
      addLabel(id + (o.tag ? ' · ' + o.tag : ''), curve.getPointAt(0.5).add(V(0, 0.03, 0)), 'wire', 'wire');
      if (o.ends !== false) {
        addLabel(id + '-1..4', curve.getPointAt(0.035 / len).add(V(0, 0.035, 0)), 'wire', 'wire');
        addLabel(id + '-1..4', curve.getPointAt(1 - 0.035 / len).add(V(0, 0.035, 0)), 'wire', 'wire');
      }
      return len;
    }

    // ---- CAN chain: dash unit (120 Ω) -> FR -> FL -> GR1 -> splice by EMU -> RR -> RL (120 Ω)
    curLayer = 'can';
    const CAN4 = [{ colors: [C.H, C.L], twist: true }, { colors: [C.V5, C.G], twist: true }];
    const SPL = V(0.06, 0.1, -0.02);
    const rows = [];
    const cables = [
      { id: 'C01', run: 'Dash unit P1 → FR IN', path: [P1, V(1.0, 0.36, -0.15), V(0.93, 0.24, -0.33), nodePos.FR.clone().add(V(0.05, 0, 0.02))] },
      { id: 'C02', run: 'FR OUT → FL IN', path: [nodePos.FR.clone().add(V(0.05, -0.01, 0.035)), V(0.92, 0.14, -0.25), V(0.95, 0.12, 0), V(0.92, 0.14, 0.25), nodePos.FL.clone().add(V(0.05, -0.01, -0.035))] },
      { id: 'C03', run: 'FL OUT → CAN splice (firewall grommet)', path: [nodePos.FL.clone().add(V(-0.05, 0, 0)), V(0.5, 0.13, 0.3), V(0.22, 0.17, 0.2), V(0.1, 0.15, 0.17), V(0.04, 0.11, 0.07), SPL] },
      { id: 'C04', run: 'CAN splice → RR IN', path: [SPL, V(-0.1, 0.09, -0.12), V(-0.32, 0.12, -0.26), V(-0.55, 0.14, -0.36), V(-0.72, 0.18, -0.4)] },
      { id: 'C05', run: 'RR OUT → RL', path: [nodePos.RR.clone().add(V(-0.05, 0, 0.02)), V(-0.93, 0.15, -0.2), V(-0.95, 0.14, 0), V(-0.93, 0.15, 0.2), nodePos.RL.clone().add(V(-0.05, 0, -0.02))] },
    ];
    cables.forEach(c => rows.push({ id: c.id, key: c.id, layer: 'can', run: c.run, len: buildCable(c.id, c.path, CAN4), wires: '4', twist: 'CAN pair + 5 V pair' }));
    const stubLen = buildCable('W066/W067', [V(0.0, 0.1, 0.05), V(0.03, 0.115, 0.02), SPL], [{ colors: [C.H, C.L], twist: true }], { tag: 'EMU stub', ends: false, wr: 0.003 });
    rows.push({ id: 'W066/7', key: 'W066/W067', layer: 'can', run: 'EMU B12/B25 → CAN splice', len: stubLen, wires: '2', twist: 'CAN pair' });

    // ---- sensor pigtails (untwisted), node SENS connector to the sensor at the corner
    curLayer = 'sens';
    const pig = (id, from, to, cols, tag) => { const via = from.clone().lerp(to, 0.5).add(V(0, 0.04, 0)); return buildCable(id, [from, via, to], [{ colors: cols, twist: false }], { tag, ends: false, wr: 0.0032 }); };
    const sens = (id, run, from, to, cols, tag) => rows.push({ id, key: id, layer: 'sens', run, len: pig(id, from, to, cols, tag), wires: String(cols.length), twist: 'No' });
    ['FL', 'FR', 'RL', 'RR'].forEach(k => {
      const w = wheels[k], s = Math.sign(w.z), n = nodePos[k];
      sens(k + '-WS', 'Node ' + k + ' → wheel speed (Hall)', n.clone().add(W3(0.02, -0.02, s * 0.045)), W3(w.x + 0.05, 0.2, w.z - s * 0.12), [C.V5, C.G, C.SIG], 'Hall');
    });
    sens('FL-BP', 'Node FL → front brake pressure', nodePos.FL.clone().add(V(-0.03, -0.02, 0.045)), V(0.68, 0.33, 0.52), [C.V5, C.G, C.SIG], 'brake P');
    sens('FL-STR', 'Node FL → steering angle', nodePos.FL.clone().add(V(0.02, 0.02, -0.04)), V(0.86, 0.3, 0.05), [C.V5, C.G, C.SIG], 'steering');
    sens('RL-BP', 'Node RL → rear brake pressure', nodePos.RL.clone().add(V(0.03, -0.02, 0.045)), V(-0.68, 0.33, 0.52), [C.V5, C.G, C.SIG], 'brake P');
    sens('RL-BL', 'Node RL → brake light', nodePos.RL.clone().add(V(-0.02, 0.02, -0.04)), V(-1.02, 0.62, 0.0), [C.PWR, C.G], 'brake light');
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.14), mat(0xb91c1c, { emissive: 0x5a0000 })); bl.position.set(-1.03, 0.64, 0); add(bl);
    addLabel('Brake light', V(-1.03, 0.7, 0));

    // ---- power and shutdown (IC.9): battery -> breaker -> PMS -> dash unit; CMS, inertia switch and BOTS in series with K1's coil
    curLayer = 'power';
    const eng = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.3, 0.36), mat(0x6b7280, { transparent: true, opacity: 0.25, depthWrite: false }));
    eng.position.copy(V(-0.6, 0.3, 0)); layers.car.push(eng); scene.add(eng);
    curLayer = 'car'; addLabel('Engine (CBR600RR)', V(-0.6, 0.47, 0), '', 'main', 99); curLayer = 'power';
    const part = (geo, p, c, name, rot) => { const m = new THREE.Mesh(geo, mat(c)); m.position.copy(p); if (rot) m.rotation.set(...rot); add(m); if (name) addLabel(name, p.clone().add(V(0, 0.045, 0)), 'term'); return m; };
    const PMS = V(-0.34, 0.78, -0.45), BRK = V(-0.34, 0.66, -0.43), CMS = V(0.56, 0.68, -0.15), INR = V(0.95, 0.33, -0.2), BOTS = V(1.0, 0.17, 0.06);
    part(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 24), PMS, 0xdc2626, 'Primary Master Switch ⚡', [Math.PI / 2, 0, 0]);
    part(new THREE.BoxGeometry(0.05, 0.05, 0.035), BRK, 0x374151, '');
    addLabel('Main breaker', BRK.clone().add(V(0, -0.03, 0)), 'below', 'main', 2.4);
    part(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 24), CMS, 0xdc2626, 'Cockpit Main Switch ⚡', [0, 0, Math.PI / 2]);
    part(new THREE.BoxGeometry(0.04, 0.03, 0.03), INR, 0x1e3a8a, 'Inertia switch');
    part(new THREE.BoxGeometry(0.03, 0.03, 0.04), BOTS, 0x7c2d12, 'BOTS');
    addLabel('K1 kill relay', V(0.84, 0.47, 0.12), '', 'main', 1.3);
    const backGr = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 10, 24), mat(0x111111)); backGr.position.copy(V(-0.3, 0.7, -0.3)); backGr.rotation.y = Math.PI / 2; add(backGr);
    addLabel('Grommet (B02)', V(-0.3, 0.74, -0.3), '', 'main', 2.4);
    const run = (id, desc, path, cols, wr, tag) => rows.push({ id, key: id, layer: 'power', run: desc, len: buildCable(id, path, [{ colors: cols, twist: false }], { tag, ends: false, wr }), wires: String(cols.length), twist: 'No' });
    run('B01', 'Battery + → breaker → PMS', [V(-0.16, 0.15, 0.22), V(-0.33, 0.3, 0.0), V(-0.36, 0.5, -0.3), BRK, PMS], [C.PWR], 0.008, 'battery +');
    run('B02', 'PMS → dash unit (switched +12 V)', [PMS.clone().add(V(0.0, 0.0, 0.03)), V(-0.33, 0.7, -0.3), V(-0.25, 0.7, -0.3), V(0.2, 0.62, -0.32), V(0.6, 0.5, -0.2), V(0.78, 0.45, -0.12)], [C.PWR], 0.007, 'switched +12 V');
    run('B03', 'Battery − → engine block ground', [V(-0.16, 0.1, 0.3), V(-0.35, 0.1, 0.22), V(-0.5, 0.18, 0.12)], [C.G], 0.008, 'ground');
    run('SD1', 'Kill relay K1 → CMS', [V(0.84, 0.46, 0.12), V(0.72, 0.6, 0.0), CMS.clone().add(V(0.02, 0, 0))], [C.PWR], 0.0035, 'shutdown loop');
    run('SD2', 'CMS → inertia switch', [CMS.clone().add(V(0.02, -0.01, 0)), V(0.8, 0.5, -0.22), INR], [C.PWR], 0.0035, '');
    run('SD3', 'Inertia switch → BOTS', [INR, V(1.02, 0.25, -0.06), BOTS], [C.PWR], 0.0035, '');
    run('SD4', 'BOTS → K1 coil', [BOTS, V(0.95, 0.32, 0.12), V(0.86, 0.43, 0.13)], [C.PWR], 0.0035, '');
    run('W040', 'K1 contacts → kill bus (injectors, coils, pump relay)', [V(0.84, 0.43, 0.1), V(0.5, 0.25, 0.08), V(0.25, 0.2, 0.06), V(0.14, onSlope(0.14), 0.05), V(0.0, 0.14, 0.03), V(-0.3, 0.2, 0.0), V(-0.45, 0.3, 0.0)], [C.PWR], 0.005, 'kill bus');
    curLayer = 'car';

    // ---- cable table with tap-to-highlight
    const LAYER_NAME = { can: 'CAN chain', sens: 'Sensors', power: 'Power and shutdown' };
    let hiKey = null;
    function highlight(key) {
      hiKey = hiKey === key ? null : key;
      Object.entries(wireMeshes).forEach(([k, ms]) => ms.forEach(m => { m.material.emissive.setHex(hiKey === k ? 0xf97316 : 0x000000); m.material.emissiveIntensity = hiKey === k ? 0.55 : 1; }));
      table.querySelectorAll('tr.pick').forEach(r => r.classList.toggle('on', r.dataset.key === hiKey));
      if (hiKey) stage.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    }
    const tot = {};
    table.innerHTML = '<thead><tr><th>ID</th><th>Group</th><th>Run</th><th>Wires</th><th>Twist</th><th class="num">Est. m</th></tr></thead><tbody>' +
      rows.map(r => { tot[r.layer] = (tot[r.layer] || 0) + r.len; return `<tr class="pick" tabindex="0" data-key="${r.key}"><td>${r.id}</td><td>${LAYER_NAME[r.layer]}</td><td>${r.run}</td><td>${r.wires}</td><td>${r.twist}</td><td class="num">${r.len.toFixed(2)}</td></tr>`; }).join('') +
      '</tbody><tfoot>' + Object.entries(tot).map(([k, v]) => `<tr><td></td><td>${LAYER_NAME[k]}</td><td>Total cable length</td><td></td><td></td><td class="num">${v.toFixed(2)}</td></tr>`).join('') + '</tfoot>';
    table.querySelectorAll('tr.pick').forEach(tr => {
      tr.addEventListener('click', () => highlight(tr.dataset.key));
      tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); highlight(tr.dataset.key); } });
    });

    // ---- views, labels and layer toggles
    const views = { iso: [V(1.9, 1.5, 1.9), V(0, 0.2, 0)], top: [V(0.049, 4.2, 0), V(0.05, 0.1, 0)], fl: [V(1.15, 0.5, 0.75), V(0.78, 0.2, 0.4)], dash: [V(1.3, 0.85, 0.5), V(0.76, 0.46, 0)], seat: [V(0.55, 0.6, 0.75), V(-0.03, 0.12, 0.08)] };
    const setView = k => { camera.position.copy(views[k][0]); controls.target.copy(views[k][1]); controls.update(); };
    setView('iso');
    const show = { main: true, wire: false, can: true, sens: true, power: true, car: true };
    stage.parentElement.querySelectorAll('[data-hview]').forEach(b => b.addEventListener('click', () => setView(b.dataset.hview)));
    stage.parentElement.querySelectorAll('[data-hshow]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.hshow, on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', on); show[k] = on;
      if (layers[k]) layers[k].forEach(m => { m.visible = on; });
    }));

    function resize() { const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cv.style.width = '100%'; cv.style.height = '100%'; camera.aspect = w / h; camera.updateProjectionMatrix(); }
    new ResizeObserver(resize).observe(stage); resize();
    const v = new THREE.Vector3();
    let running = true, raf = 0;
    function frame() {
      if (!running) return;
      controls.update(); renderer.render(scene, camera);
      const w = stage.clientWidth, h = stage.clientHeight;
      labels.forEach(l => {
        const vis = (l.group === 'wire' ? show.wire : show.main) && show[l.layer] !== false;
        v.copy(l.pos).project(camera);
        const off = v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1 || camera.position.distanceTo(l.pos) > l.maxDist;
        l.d.classList.toggle('hide', !vis || off);
        if (vis && !off) l.d.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, ${l.below ? '0%' : '-100%'})`;
      });
      raf = requestAnimationFrame(frame);
    }
    frame();
    return {
      pause() { running = false; cancelAnimationFrame(raf); },
      resume() { if (!running) { running = true; resize(); frame(); } },
      rows
    };
  }
  window.BRHarness3D = { mount };
})();
