// IR array sensor around the tire in 3D: the tire (tread colored by its true temperature),
// the sensor at its pose with roll / pitch / yaw arrows, and one ray per pixel colored by
// what that pixel reads. window.BRIrArray3D.mount(stage, labels) returns { update(r, o), pause, resume, view(k) }.
(function () {
  'use strict';
  // model frame: x forward, y outward, z up  ->  three.js: x forward, y up, z = -outward
  const M = p => new THREE.Vector3(p[0], p[2], -p[1]);

  function heat(t, lo, hi) {
    const u = Math.max(0, Math.min(1, (t - lo) / ((hi - lo) || 1)));
    return new THREE.Color().setHSL(0.66 * (1 - u), 0.85, 0.5);
  }

  function mount(stage, labelsEl) {
    if (!window.THREE || !THREE.OrbitControls) return null;
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    stage.insertBefore(renderer.domElement, stage.firstChild);
    const cv = renderer.domElement;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.005, 20);
    const controls = new THREE.OrbitControls(camera, cv);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6); sun.position.set(1, 2, 1.5); scene.add(sun);
    const bg = () => { scene.background = new THREE.Color(css('--scene') || '#e9ecf0'); };
    bg();
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.6 }, o));

    const labels = [];
    const label = (text, cls) => { const d = document.createElement('div'); d.className = 'hlb ' + (cls || ''); d.textContent = text; labelsEl.appendChild(d); const l = { d, pos: new THREE.Vector3() }; labels.push(l); return l; };

    // world axes at the wheel centre
    const axes = new THREE.Group(); scene.add(axes);
    const arrow = (dir, col, len) => { const a = new THREE.ArrowHelper(dir, new THREE.Vector3(), len, col, 0.03, 0.018); axes.add(a); return a; };
    arrow(new THREE.Vector3(1, 0, 0), 0xd03b3b, 0.42); arrow(new THREE.Vector3(0, 0, -1), 0x1baf7a, 0.24); arrow(new THREE.Vector3(0, 1, 0), 0x2a78d6, 0.36);
    const lx = label('X forward (distance)', 'axis x'), ly = label('Y outward (sideways)', 'axis y'), lz = label('Z up (height)', 'axis z');
    lx.pos.set(0.44, 0, 0); ly.pos.set(0, 0, -0.27); lz.pos.set(0, 0.38, 0);

    const tireGroup = new THREE.Group(); scene.add(tireGroup);
    const sensorGroup = new THREE.Group(); scene.add(sensorGroup);
    const rayGroup = new THREE.Group(); scene.add(rayGroup);
    const ground = new THREE.GridHelper(1.2, 24, 0x9aa4ad, 0xc4ccd3); scene.add(ground);
    const lSensor = label('Sensor', 'node'), lRoll = label('roll', 'term'), lPitch = label('pitch', 'term'), lYaw = label('yaw', 'term');

    let tex = null, tireKey = '';
    function buildTire(r, o) {
      const key = [r.tireR, r.halfW, o.profile, o.tempC, o.gradC].join();
      if (key === tireKey) return;
      tireKey = key;
      tireGroup.clear();
      const c = document.createElement('canvas'); c.width = 64; c.height = 4;
      const g = c.getContext('2d');
      const lo = Math.min(...r.truth.map(p => p.T), o.bgC), hi = Math.max(...r.truth.map(p => p.T));
      for (let i = 0; i < 64; i++) {
        const T = r.truth[Math.round(i / 63 * (r.truth.length - 1))].T;
        g.fillStyle = '#' + heat(T, lo, hi).getHexString(); g.fillRect(i, 0, 1, 4);
      }
      if (tex) tex.dispose();
      tex = new THREE.CanvasTexture(c);
      // CylinderGeometry runs along its own y; after turning it, its v coordinate runs across the tread
      tex.wrapS = THREE.RepeatWrapping;
      const cyl = new THREE.CylinderGeometry(r.tireR, r.tireR, r.halfW * 2, 72, 1, true);
      const uv = cyl.attributes.uv;
      for (let i = 0; i < uv.count; i++) { const v = uv.getY(i); uv.setXY(i, 1 - v, 0.5); }   // v = 1 is local +y, which ends up at the inner edge
      const tread = new THREE.Mesh(cyl, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide }));
      tread.rotation.x = Math.PI / 2;           // cylinder axis along three z = model y
      tireGroup.add(tread);
      const sideG = new THREE.RingGeometry(r.rimR, r.tireR, 72);
      [1, -1].forEach(s => { const m = new THREE.Mesh(sideG, mat(0x2b3036, { side: THREE.DoubleSide, transparent: true, opacity: 0.85 })); m.position.z = s * r.halfW; tireGroup.add(m); });
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(r.rimR, r.rimR, r.halfW * 2 * 1.02, 48, 1, true), mat(0x9ca3af, { metalness: 0.5, side: THREE.DoubleSide }));
      rim.rotation.x = Math.PI / 2; tireGroup.add(rim);
      ground.position.y = -r.tireR;
    }

    function arc(axis, center, radius, col, angle) {
      // a 270 degree arrowed ring around an axis, showing which way + turns
      const g = new THREE.TorusGeometry(radius, 0.003, 6, 40, Math.PI * 1.5);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col }));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis.clone().normalize());
      m.position.copy(center);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.02, 10), new THREE.MeshBasicMaterial({ color: col }));
      const end = new THREE.Vector3(0, radius, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI * 1.5 - Math.PI / 2);
      tip.position.copy(end); tip.rotation.z = Math.PI;
      m.add(tip);
      return m;
    }

    function update(r, o) {
      buildTire(r, o);
      tireGroup.rotation.y = (r.o.steerDeg * Math.PI) / 180;   // front of the tire swings outward for + steer
      sensorGroup.clear(); rayGroup.clear();
      const S = M(r.sensor), look = M(r.axes[0]), across = M(r.axes[1]), up = M(r.axes[2]);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.04), mat(0x111827));
      const basis = new THREE.Matrix4().makeBasis(look.clone().negate(), up, across.clone().negate());
      box.quaternion.setFromRotationMatrix(basis); box.position.copy(S); sensorGroup.add(box);
      const ax = (v, col, len) => sensorGroup.add(new THREE.ArrowHelper(v.clone().normalize(), S, len, col, 0.015, 0.01));
      ax(look, 0xd03b3b, 0.07); ax(across, 0x1baf7a, 0.06); ax(up, 0x2a78d6, 0.06);
      sensorGroup.add(arc(look, S.clone().addScaledVector(look, 0.075), 0.022, 0xd03b3b));
      sensorGroup.add(arc(across, S.clone().addScaledVector(across, 0.065), 0.018, 0x1baf7a));
      sensorGroup.add(arc(up, S.clone().addScaledVector(up, 0.065), 0.018, 0x2a78d6));
      lSensor.pos.copy(S).add(new THREE.Vector3(0, 0.05, 0));
      lRoll.pos.copy(S).addScaledVector(look, 0.11); lRoll.d.textContent = `roll ${o.rollDeg}°`;
      lPitch.pos.copy(S).addScaledVector(across, 0.1); lPitch.d.textContent = `pitch ${o.pitchDeg}°`;
      lYaw.pos.copy(S).addScaledVector(up, 0.1); lYaw.d.textContent = `yaw ${o.yawDeg}°`;
      const lo = Math.min(o.bgC, ...r.truth.map(p => p.T)), hi = Math.max(...r.truth.map(p => p.T));
      r.pixels.forEach(p => {
        const end = M(p.end), col = heat(p.meas, lo, hi);
        const g = new THREE.BufferGeometry().setFromPoints([S, end]);
        rayGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: p.hit === 'tread' ? 0.95 : 0.4 })));
        if (p.hit === 'tread' || p.hit === 'side') {
          const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 8, 6), new THREE.MeshBasicMaterial({ color: col }));
          dot.position.copy(end); rayGroup.add(dot);
        }
      });
    }

    const views = {
      iso: [new THREE.Vector3(0.75, 0.35, -0.75), new THREE.Vector3(0.12, 0, 0)],
      side: [new THREE.Vector3(0.15, 0.02, -1.2), new THREE.Vector3(0.15, 0, 0)],
      front: [new THREE.Vector3(1.3, 0.02, 0.001), new THREE.Vector3(0, 0, 0)],
      top: [new THREE.Vector3(0.15, 1.3, 0.001), new THREE.Vector3(0.15, 0, 0)]
    };
    const view = k => { camera.position.copy(views[k][0]); controls.target.copy(views[k][1]); controls.update(); };
    view('iso');

    function resize() { const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cv.style.width = '100%'; cv.style.height = '100%'; camera.aspect = w / h; camera.updateProjectionMatrix(); }
    new ResizeObserver(resize).observe(stage); resize();
    const v = new THREE.Vector3();
    let running = true, raf = 0;
    function frame() {
      if (!running) return;
      controls.update(); renderer.render(scene, camera);
      const w = stage.clientWidth, h = stage.clientHeight;
      labels.forEach(l => {
        v.copy(l.pos).project(camera);
        const off = v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05;
        l.d.classList.toggle('hide', off);
        if (!off) l.d.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
      });
      raf = requestAnimationFrame(frame);
    }
    frame();
    return {
      update, view,
      pause() { running = false; cancelAnimationFrame(raf); },
      resume() { if (!running) { running = true; resize(); frame(); } }
    };
  }
  window.BRIrArray3D = { mount, heat };
})();
