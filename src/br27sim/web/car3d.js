/* Rough 3D FSAE car built from three.js primitives. Units are metres.
   Axes: +x forward, +y up, +z to the driver's right. */
(function (root) {
  'use strict';

  // Component positions [assumption: until chassis CAD exists]
  const P = {
    frontAxle: 0.80, rearAxle: -0.75, track: 1.22, wheelR: 0.205,
    battery: [-0.10, 0.075, 0.11],
    ecu: [-0.10, 0.065, -0.11],
    dash: [0.42, 0.60, 0],
    // corner nodes at each wheel's inboard suspension pickups [Tanner]
    nodeFL: [0.80, 0.27, -0.27], nodeFR: [0.80, 0.27, 0.27],
    nodeRL: [-0.75, 0.30, -0.29], nodeRR: [-0.75, 0.30, 0.29],
    imu: [0.47, 0.50, -0.07], gps: [0.50, 0.64, 0.06],
    brakeF: [0.86, 0.20, -0.14], brakeR: [-0.62, 0.16, -0.18], brakeLight: [-1.0, 0.62, 0],
    pms: [-0.36, 0.74, 0.31],
    breaker: [-0.30, 0.58, 0.31],
    cms: [0.36, 0.56, 0.16],
    bots: [0.98, 0.22, -0.06],
    inertia: [-0.22, 0.30, -0.22],
    regulator: [-0.55, 0.30, 0.42],
    engine: [-0.66, 0.30, 0]
  };

  // Powertrain bus (classic CAN): EMU Black (end) -> dash MCU (end)
  const PT_ROUTE = [P.ecu, [0.10, 0.06, -0.12], [0.55, 0.12, -0.08], [0.50, 0.45, -0.03], P.dash];
  // Chassis bus (CAN FD): dash MCU (end) -> FL -> FR -> RR -> RL (end)
  const CH_ROUTE = [P.dash, [0.55, 0.40, -0.10], [0.72, 0.24, -0.22], P.nodeFL, [0.82, 0.16, 0], P.nodeFR,
    [0.45, 0.12, 0.27], [-0.35, 0.11, 0.29], P.nodeRR, [-0.80, 0.18, 0], P.nodeRL];
  // Single-bus layout (Tanner 2026-10-31): dash (end) -> electrical box behind the dash ->
  // FR -> FL -> CAN splice beside the EMU under the seat (EMU on a ~0.1 m stub) -> RR -> RL (end)
  const ALL_ROUTE = [P.dash, [0.34, 0.42, 0.04], [0.60, 0.30, 0.12], P.nodeFR, [0.82, 0.16, 0], P.nodeFL, [0.45, 0.12, -0.27],
    [0.05, 0.07, -0.14], P.ecu, [-0.40, 0.08, 0.20], P.nodeRR, [-0.80, 0.18, 0], P.nodeRL];
  const POWER_ROUTE = [P.battery, [-0.22, 0.10, 0.24], [-0.30, 0.40, 0.31], P.breaker, [-0.34, 0.66, 0.31], P.pms];

  const PARTS = [
    { id: 'engine', name: 'CBR600RR engine', color: '#7a818c', sys: 'Powertrain' },
    { id: 'ecu', name: 'EMU Black ECU', color: '#2a78d6', sys: 'Powertrain' },
    { id: 'battery', name: 'NOCO NLP14 battery', color: '#eb6834', sys: '12 V power' },
    { id: 'regulator', name: 'Regulator', color: '#eda100', sys: '12 V power' },
    { id: 'dash', name: 'Dash + dash MCU', color: '#6250d6', sys: 'CAN / DAQ' },
    { id: 'imu', name: 'IMU', color: '#e87ba4', sys: 'CAN / DAQ' },
    { id: 'gps', name: 'GPS', color: '#e87ba4', sys: 'CAN / DAQ' },
    { id: 'brakeF', name: 'Front brake pressure', color: '#eb6834', sys: 'CAN / DAQ' },
    { id: 'brakeR', name: 'Rear brake pressure', color: '#eb6834', sys: 'CAN / DAQ' },
    { id: 'brakeLight', name: 'Brake light', color: '#d03b3b', sys: 'CAN / DAQ' },
    { id: 'nodeFL', name: 'Node FL', color: '#1baf7a', sys: 'CAN / DAQ' },
    { id: 'nodeFR', name: 'Node FR', color: '#1baf7a', sys: 'CAN / DAQ' },
    { id: 'nodeRL', name: 'Node RL', color: '#1baf7a', sys: 'CAN / DAQ' },
    { id: 'nodeRR', name: 'Node RR', color: '#1baf7a', sys: 'CAN / DAQ' },
    { id: 'breaker', name: 'Main breaker', color: '#eda100', sys: '12 V power' },
    { id: 'pms', name: 'Primary Master Switch', color: '#d03b3b', sys: 'Shutdown' },
    { id: 'cms', name: 'Cockpit Main Switch', color: '#d03b3b', sys: 'Shutdown' },
    { id: 'bots', name: 'BOTS', color: '#d03b3b', sys: 'Shutdown' },
    { id: 'inertia', name: 'Inertia switch', color: '#d03b3b', sys: 'Shutdown' }
  ];

  // Once parts are placed from CAD, buses are routed as harness runs along the
  // frame axes (forward/back, then across, then up/down) between the parts.
  let customRoutes = false;
  function ortho(...pts) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = out[out.length - 1], b = pts[i];
      for (const q of [[b[0], a[1], a[2]], [b[0], a[1], b[2]], b]) {
        const l = out[out.length - 1];
        if (Math.hypot(q[0] - l[0], q[1] - l[1], q[2] - l[2]) > 1e-4) out.push(q.slice());
      }
    }
    return out.length > 1 ? out : [pts[0], pts[0].map(v => v + 1e-3)];
  }
  function routes() {
    if (!customRoutes) {
      return { pt: PT_ROUTE, ch: CH_ROUTE, all: ALL_ROUTE, power: POWER_ROUTE,
        extra: [[[P.imu, [0.45, 0.55, -0.02], P.dash], 0xe87ba4, 0.004], [[P.gps, [0.47, 0.62, 0.03], P.dash], 0xe87ba4, 0.004],
          [[P.pms, [-0.40, 0.45, 0.15], [-0.30, 0.10, 0.0], P.ecu], 0xd03b3b, 0.005], [[P.regulator, [-0.48, 0.45, 0.36], [-0.40, 0.70, 0.33], P.pms], 0xeda100, 0.006],
          [[P.brakeF, [0.84, 0.22, -0.22], P.nodeFL], 0xeb6834, 0.004], [[P.brakeR, [-0.70, 0.22, -0.25], P.nodeRL], 0xeb6834, 0.004],
          [[P.nodeRL, [-0.92, 0.40, -0.12], P.brakeLight], 0xd03b3b, 0.004]] };
    }
    return {
      pt: ortho(P.ecu, P.dash),
      ch: ortho(P.dash, P.nodeFL, P.nodeFR, P.nodeRR, P.nodeRL),
      all: ortho(P.dash, P.nodeFR, P.nodeFL, P.ecu, P.nodeRR, P.nodeRL),
      power: ortho(P.battery, P.breaker, P.pms),
      extra: [[ortho(P.imu, P.dash), 0xe87ba4, 0.004], [ortho(P.gps, P.dash), 0xe87ba4, 0.004], [ortho(P.pms, P.ecu), 0xd03b3b, 0.005],
        [ortho(P.regulator, P.pms), 0xeda100, 0.006], [ortho(P.brakeF, P.nodeFL), 0xeb6834, 0.004], [ortho(P.brakeR, P.nodeRL), 0xeb6834, 0.004],
        [ortho(P.nodeRL, P.brakeLight), 0xd03b3b, 0.004]]
    };
  }
  const DEFAULT_P = JSON.parse(JSON.stringify(P));
  const routeM = {};
  function updateRouteM() {
    const r = routes();
    routeM.pt = routeLength(r.pt); routeM.ch = routeLength(r.ch); routeM.all = routeLength(r.all);
  }
  // Part positions from CAD (simulator metres). Parts not listed go back to the placeholders.
  function setPositions(pos) {
    pos = pos || {};
    for (const k of Object.keys(DEFAULT_P)) P[k] = Array.isArray(DEFAULT_P[k]) ? DEFAULT_P[k].slice() : DEFAULT_P[k];
    let any = false;
    for (const [k, v] of Object.entries(pos)) if (Array.isArray(P[k]) && v) { P[k] = v.slice(); any = true; }
    customRoutes = any;
    updateRouteM();
    return routeM;
  }

  // STL (binary or ASCII) to a flat Float32Array, 9 floats per triangle
  function parseStl(buf) {
    const dv = new DataView(buf);
    if (buf.byteLength >= 84) {
      const n = dv.getUint32(80, true);
      if (84 + 50 * n === buf.byteLength) {
        const a = new Float32Array(n * 9);
        for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) a[i * 9 + k] = dv.getFloat32(84 + 50 * i + 12 + 4 * k, true);
        return a;
      }
    }
    const text = new TextDecoder().decode(buf), out = [];
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
    let m;
    while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
    return new Float32Array(out);
  }

  function routeLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      L += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    return L;
  }

  function create(container, labelsEl, onSelect) {
    const THREE = root.THREE;
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 50);
    camera.position.set(2.6, 1.9, 2.9);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.insertBefore(renderer.domElement, container.firstChild);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.35, 0);
    controls.enableDamping = true;
    controls.minDistance = 1.2; controls.maxDistance = 8;
    controls.maxPolarAngle = Math.PI * 0.49;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75);
    sun.position.set(3, 5, 2); scene.add(sun);

    const mat = (color, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0.1 }, extra || {}));
    const box = (w, h, d, m, pos) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(...pos); scene.add(o); return o; };
    const v3 = a => new THREE.Vector3(a[0], a[1], a[2]);

    // ground grid
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), mat(0x888888, { transparent: true, opacity: 0.08 }));
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    const grid = new THREE.GridHelper(6, 24, 0x888888, 0x888888);
    grid.material.transparent = true; grid.material.opacity = 0.18; scene.add(grid);

    // spaceframe from tube segments (everything from here to the engine is the placeholder car)
    const placeholderStart = scene.children.length;
    const tubeMat = mat(0x9aa3ad, { metalness: 0.6, roughness: 0.35 });
    const tube = (a, b, r) => {
      const A = v3(a), B = v3(b), len = A.distanceTo(B);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r || 0.0125, r || 0.0125, len, 8), tubeMat);
      m.position.copy(A).add(B).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
      scene.add(m);
    };
    const fr = [[1.05, 0.12, 0.16], [0.45, 0.10, 0.26], [-0.35, 0.10, 0.30], [-0.98, 0.14, 0.26]];
    const top = [[1.05, 0.42, 0.14], [0.45, 0.48, 0.25], [-0.35, 0.50, 0.30], [-0.98, 0.48, 0.24]];
    for (const s of [1, -1]) {
      for (let i = 0; i < 3; i++) {
        tube([fr[i][0], fr[i][1], s * fr[i][2]], [fr[i + 1][0], fr[i + 1][1], s * fr[i + 1][2]]);
        tube([top[i][0], top[i][1], s * top[i][2]], [top[i + 1][0], top[i + 1][1], s * top[i + 1][2]]);
      }
      for (let i = 0; i < 4; i++) tube([fr[i][0], fr[i][1], s * fr[i][2]], [top[i][0], top[i][1], s * top[i][2]]);
      tube([fr[0][0], fr[0][1], s * fr[0][2]], [top[1][0], top[1][1], s * top[1][2]]);
      tube([fr[2][0], fr[2][1], s * fr[2][2]], [top[3][0], top[3][1], s * top[3][2]]);
    }
    for (let i = 0; i < 4; i++) { tube([fr[i][0], fr[i][1], fr[i][2]], [fr[i][0], fr[i][1], -fr[i][2]]); tube([top[i][0], top[i][1], top[i][2]], [top[i][0], top[i][1], -top[i][2]]); }
    // main hoop and front hoop
    const hoop = (x, z0, y0, yTop, zTop) => { tube([x, y0, z0], [x, yTop, zTop]); tube([x, y0, -z0], [x, yTop, -zTop]); tube([x, yTop, zTop], [x, yTop, -zTop]); };
    hoop(-0.35, 0.30, 0.50, 1.05, 0.16);
    hoop(0.45, 0.25, 0.48, 0.66, 0.16);
    tube([-0.35, 1.05, 0.12], [-0.85, 0.50, 0.20]); tube([-0.35, 1.05, -0.12], [-0.85, 0.50, -0.20]);

    // body shell (translucent) and nose
    const shellMat = mat(0x1f4fa0, { transparent: true, opacity: 0.18, depthWrite: false });
    const shell = new THREE.Group();
    const side = (s) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.34, 0.02), shellMat);
      m.position.set(0.35, 0.30, s * 0.29); shell.add(m);
    };
    side(1); side(-1);
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.27, 0.55, 18, 1, true), shellMat);
    nose.rotation.z = Math.PI / 2; nose.position.set(1.32, 0.27, 0); nose.scale.set(1, 1, 0.9);
    shell.add(nose);
    const pod = (s) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.30, 0.22), shellMat); m.position.set(-0.40, 0.28, s * 0.42); shell.add(m); };
    pod(1); pod(-1);
    scene.add(shell);

    // wheels
    const tyreMat = mat(0x22262b, { roughness: 0.9 });
    const rimMat = mat(0xb9c0c8, { metalness: 0.7, roughness: 0.3 });
    for (const x of [P.frontAxle, P.rearAxle]) for (const s of [1, -1]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(P.wheelR, P.wheelR, 0.19, 28), tyreMat);
      t.rotation.x = Math.PI / 2; t.position.set(x, P.wheelR, s * P.track / 2); scene.add(t);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(P.wheelR * 0.62, P.wheelR * 0.62, 0.195, 18), rimMat);
      r.rotation.x = Math.PI / 2; r.position.copy(t.position); scene.add(r);
      t.userData.wheel = r.userData.wheel = true;
      // wishbones
      tube([x, 0.14, s * 0.24], [x, P.wheelR - 0.04, s * (P.track / 2 - 0.08)], 0.008);
      tube([x, 0.40, s * 0.24], [x, P.wheelR + 0.06, s * (P.track / 2 - 0.08)], 0.008);
    }
    // front and rear wings, low and simple
    box(0.32, 0.02, 1.15, mat(0x30343a), [1.48, 0.10, 0]);
    box(0.30, 0.02, 0.95, mat(0x30343a), [-1.15, 0.95, 0]);
    tube([-1.05, 0.48, 0.22], [-1.12, 0.94, 0.30], 0.008); tube([-1.05, 0.48, -0.22], [-1.12, 0.94, -0.30], 0.008);

    // cockpit: seat, driver ghost, steering wheel, pedals
    const seat = box(0.55, 0.04, 0.42, mat(0x3b3f46), [-0.05, 0.14, 0]);
    seat.rotation.z = 0.12;
    const back = box(0.04, 0.55, 0.40, mat(0x3b3f46), [-0.32, 0.42, 0]); back.rotation.z = 0.32;
    const ghost = mat(0xaab4c0, { transparent: true, opacity: 0.22, depthWrite: false });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), ghost); helmet.position.set(-0.32, 0.92, 0); scene.add(helmet);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.5, 14), ghost); torso.position.set(-0.22, 0.48, 0); torso.rotation.z = 0.35; scene.add(torso);
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.85, 12), ghost); legs.position.set(0.45, 0.26, 0); legs.rotation.z = Math.PI / 2 - 0.12; scene.add(legs);
    const sw = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.014, 8, 28), mat(0x222222));
    sw.position.set(0.30, 0.55, 0); sw.rotation.y = Math.PI / 2; sw.rotation.x = 0; sw.rotateX(0); sw.rotation.z = -0.5; scene.add(sw);
    tube([0.30, 0.55, 0], [0.80, 0.42, 0], 0.01);
    box(0.06, 0.18, 0.24, mat(0x50555c), [0.95, 0.20, 0]);

    // firewall between driver and engine / lithium battery (T.1.8)
    const fw = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.85), mat(0xc0c7cf, { transparent: true, opacity: 0.28, side: THREE.DoubleSide, metalness: 0.8, depthWrite: false }));
    fw.position.set(-0.40, 0.55, 0); fw.rotation.y = Math.PI / 2; fw.rotation.x = 0; scene.add(fw);

    const placeholder = scene.children.slice(placeholderStart).filter(o => !o.userData.wheel);

    // engine: transverse inline-4, crankcase + 4 cylinders + intake with restrictor
    const engGroup = new THREE.Group();
    const engMat = mat(0x7a818c, { metalness: 0.5, roughness: 0.45 });
    const crank = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.44), engMat); crank.position.set(0, 0, 0); engGroup.add(crank);
    const cylMeshes = [];
    for (let i = 0; i < 4; i++) {
      const cm = mat(0x8c939d, { emissive: 0x000000, metalness: 0.4 });
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.22, 14), cm);
      c.position.set(0.05, 0.22, -0.15 + i * 0.1); c.rotation.z = 0.35;
      engGroup.add(c); cylMeshes.push(c);
    }
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.44), engMat); head.position.set(0.10, 0.34, 0); head.rotation.z = 0.35; engGroup.add(head);
    const plenum = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.36, 16), mat(0x5c626b)); plenum.rotation.x = Math.PI / 2; plenum.position.set(0.14, 0.48, 0); engGroup.add(plenum);
    const restr = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.045, 0.22, 14), mat(0x5c626b)); restr.position.set(0.14, 0.64, 0.10); engGroup.add(restr);
    for (let i = 0; i < 4; i++) {
      const ex = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.016, 8, 16, Math.PI / 2), mat(0x9b6a40, { metalness: 0.7 }));
      ex.position.set(-0.04, 0.12, -0.15 + i * 0.1); ex.rotation.z = Math.PI; engGroup.add(ex);
    }
    engGroup.position.set(...P.engine);
    scene.add(engGroup);

    // radiator in right sidepod, fan
    box(0.04, 0.24, 0.20, mat(0x5a6470), [-0.30, 0.28, 0.43]);

    // electrical parts
    const meshes = {};
    const part = (id, size, pos) => {
      const def = PARTS.find(p => p.id === id);
      const m = box(size[0], size[1], size[2], mat(def.color, { emissive: def.color, emissiveIntensity: 0.15 }), pos);
      m.userData.id = id; meshes[id] = m; return m;
    };
    meshes.engine = crank; crank.userData.id = 'engine';
    part('battery', [0.15, 0.09, 0.08], P.battery);
    part('ecu', [0.16, 0.04, 0.11], P.ecu);
    part('dash', [0.03, 0.10, 0.17], P.dash);
    for (const n of ['nodeFL', 'nodeFR', 'nodeRL', 'nodeRR']) part(n, [0.07, 0.03, 0.05], P[n]);
    part('imu', [0.04, 0.02, 0.04], P.imu);
    part('brakeF', [0.025, 0.025, 0.06], P.brakeF);
    part('brakeR', [0.025, 0.025, 0.06], P.brakeR);
    part('brakeLight', [0.02, 0.07, 0.16], P.brakeLight);
    part('gps', [0.06, 0.015, 0.06], P.gps);
    part('regulator', [0.10, 0.03, 0.08], P.regulator);
    part('pms', [0.04, 0.05, 0.03], P.pms);
    part('breaker', [0.05, 0.04, 0.03], P.breaker);
    part('cms', [0.03, 0.04, 0.04], P.cms);
    part('bots', [0.03, 0.04, 0.03], P.bots);
    part('inertia', [0.04, 0.04, 0.04], P.inertia);

    // wiring
    const wire = (pts, color, r) => {
      const curve = new THREE.CatmullRomCurve3(pts.map(v3), false, 'catmullrom', 0.2);
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 14, r, 6, false), mat(color, { emissive: color, emissiveIntensity: 0.35 }));
      scene.add(m); return m;
    };
    let busWires = {}, allWires = [], layoutNow = 'classic';
    function buildWires() {
      for (const m of allWires) { scene.remove(m); m.geometry.dispose(); }
      const r = routes();
      busWires = { pt: wire(r.pt, 0x2a78d6, 0.007), ch: wire(r.ch, 0x1baf7a, 0.007), all: wire(r.all, 0x1baf7a, 0.007) };
      allWires = [busWires.pt, busWires.ch, busWires.all, wire(r.power, 0xd03b3b, 0.008)];
      for (const [pts, color, rad] of r.extra) allWires.push(wire(pts, color, rad));
      busWires.pt.visible = busWires.ch.visible = layoutNow === 'split'; busWires.all.visible = layoutNow !== 'split';
    }
    buildWires();
    // placeholder boxes go where the parts are
    const baseMeshes = Object.assign({}, meshes);
    function movePlaceholders() {
      for (const [id, m] of Object.entries(baseMeshes)) if (id !== 'engine' && P[id]) m.position.set(...P[id]);
      engGroup.position.set(...P.engine);
    }

    // CAD meshes from imported STLs
    const cadGroup = new THREE.Group();
    scene.add(cadGroup);
    const stlCache = {};
    async function setCad(cad) {
      for (const m of cadGroup.children.slice()) { cadGroup.remove(m); m.geometry.dispose(); }
      Object.assign(meshes, baseMeshes);
      for (const m of Object.values(baseMeshes)) m.visible = true;
      engGroup.visible = true;
      const mx = new THREE.Matrix4().set(...cad.matrix.flat());
      for (const f of cad.files) {
        const key = f.name + ':' + f.triangles;
        if (!stlCache[key]) {
          const res = await fetch('/cad-files/' + encodeURIComponent(f.name));
          stlCache[key] = parseStl(await res.arrayBuffer());
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(stlCache[key], 3));
        g.computeVertexNormals();
        const def = PARTS.find(p => p.id === f.role);
        const m = new THREE.Mesh(g, f.role === 'frame'
          ? mat(0x9aa3ad, { metalness: 0.55, roughness: 0.4, side: THREE.DoubleSide })
          : mat(def ? def.color : 0xb0b6be, { side: THREE.DoubleSide, emissive: def ? def.color : 0x000000, emissiveIntensity: 0.12 }));
        m.applyMatrix4(mx);
        m.userData.file = f.name;
        if (def) {
          m.userData.id = def.id;
          meshes[def.id].visible = false;
          if (def.id === 'engine') engGroup.visible = false;
          meshes[def.id] = m;
        }
        cadGroup.add(m);
      }
      for (const o of placeholder) o.visible = !cad.settings.hidePlaceholder;
      movePlaceholders();
      buildWires();
      select(selected);
    }

    // labels
    const labelDivs = {};
    for (const p of PARTS) {
      const d = document.createElement('div');
      d.className = 'lbl'; d.textContent = p.name; d.hidden = true;
      labelsEl.appendChild(d); labelDivs[p.id] = d;
    }
    let selected = null, placing = null;
    const showAlways = new Set(['engine', 'battery', 'dash']);

    function select(id) {
      selected = id;
      for (const p of PARTS) {
        const m = meshes[p.id];
        if (m && m.material && m.material.emissiveIntensity !== undefined && (p.id !== 'engine' || m.parent === cadGroup)) m.material.emissiveIntensity = p.id === id ? 0.9 : m.parent === cadGroup ? 0.12 : 0.15;
        labelDivs[p.id].classList.toggle('sel', p.id === id);
      }
      onSelect && onSelect(id);
    }

    // tap to select
    const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
    let downAt = null;
    renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('pointerup', e => {
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
      const r = renderer.domElement.getBoundingClientRect();
      ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      if (placing) {
        const hit = ray.intersectObjects(cadGroup.children.concat(placeholder), true)[0];
        if (hit) { const cb = placing; placing = null; container.style.cursor = ''; cb([hit.point.x, hit.point.y, hit.point.z]); }
        return;
      }
      const hits = ray.intersectObjects(Object.values(meshes), false);
      if (hits.length && hits[0].object.userData.id) select(hits[0].object.userData.id);
    });

    function setTheme() {
      scene.background = new THREE.Color(css('--scene') || '#e9ecf0');
    }
    setTheme();

    function resize() {
      const w = container.clientWidth, h = container.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
      camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix();
      // back the camera off on portrait screens so the whole car fits
      const dist = camera.aspect < 1 ? 6.2 : 4.3;
      const dir = camera.position.clone().sub(controls.target).normalize();
      camera.position.copy(controls.target).add(dir.multiplyScalar(dist));
    }
    resize();
    window.addEventListener('resize', resize);

    let running = true, enginePhase = 0, engineOn = true, rpmVis = 6000;
    const fireOrder = [0, 1, 3, 2]; // cylinder index for 1-2-4-3
    const tmp = new THREE.Vector3();
    function frame(ts) {
      if (!running) return;
      requestAnimationFrame(frame);
      controls.update();
      // flash the cylinders in firing order, slowed right down
      enginePhase = (ts / 1000) * Math.max(0.6, rpmVis / 4000);
      const k = Math.floor(enginePhase * 4) % 4, f = (enginePhase * 4) % 1;
      cylMeshes.forEach((c, i) => {
        const on = engineOn && fireOrder[k] === i && f < 0.5;
        c.material.emissive.setHex(on ? 0xeb6834 : 0x000000);
        c.material.emissiveIntensity = on ? 1 - f * 2 : 0;
      });
      renderer.render(scene, camera);
      const w = container.clientWidth, h = container.clientHeight;
      for (const p of PARTS) {
        const d = labelDivs[p.id];
        const m = meshes[p.id];
        const show = showAlways.has(p.id) || p.id === selected;
        if (!m || !show) { d.hidden = true; continue; }
        m.getWorldPosition(tmp); tmp.project(camera);
        const x = (tmp.x + 1) / 2 * w, y = (1 - tmp.y) / 2 * h;
        d.hidden = tmp.z > 1 || x < 0 || x > w || y < 0 || y > h;
        d.style.left = x + 'px'; d.style.top = y + 'px';
      }
    }
    requestAnimationFrame(frame);

    return {
      select, setTheme, resize,
      setEngine(on, rpm) { engineOn = on; rpmVis = rpm || rpmVis; },
      toggleShell(v) { shell.visible = v; },
      pause() { running = false; },
      resume() { if (!running) { running = true; requestAnimationFrame(frame); } },
      setLayout(layout) { layoutNow = layout; busWires.pt.visible = busWires.ch.visible = layout === 'split'; busWires.all.visible = layout !== 'split'; },
      setCad,
      // next tap on the CAD (or placeholder car) calls cb with the point hit, in simulator metres
      startPlacing(cb) { placing = cb; container.style.cursor = 'crosshair'; },
      cancelPlacing() { placing = null; container.style.cursor = ''; }
    };
  }

  updateRouteM();
  root.BRCar = { create, PARTS, P, routeM, setPositions, parseStl };
})(window);
