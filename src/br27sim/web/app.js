/* Page logic: inputs, routing, running the model and drawing every view. */
(function () {
  'use strict';
  const S = window.BR27Sim, C = window.BRCharts;
  const $ = id => document.getElementById(id);
  function hexA(hex, a) {
    const h = hex.replace('#', '');
    if (h.length < 6) return hex;
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
  }
  const fmt = (x, d) => (x == null || !isFinite(x) ? '–' : Number(x).toFixed(d == null ? 1 : d));
  // Units: the model works in SI (km/h, mm, m, °C); the page shows imperial or metric
  let UNITSYS = 'imperial';
  try { UNITSYS = localStorage.getItem('br27.units') || (localStorage.getItem('br27.speedUnit') === 'kmh' ? 'metric' : 'imperial'); } catch (e) { /* storage blocked */ }
  let SPD = UNITSYS === 'metric' ? 'kmh' : 'mph';
  const IMP = () => UNITSYS === 'imperial';
  const LU = () => (IMP() ? 'in' : 'mm');                                     // short lengths
  const lnv = mm => (mm == null ? mm : IMP() ? mm / 25.4 : mm);
  const ln = (mm, d) => `${fmt(lnv(mm), IMP() ? (d == null ? 2 : d) : 0)} ${LU()}`;
  const ML = () => (IMP() ? 'ft' : 'm');                                      // harness lengths
  const mlv = m => (IMP() ? m * 3.28084 : m);
  const TU = () => (IMP() ? '°F' : '°C');
  const tv = c => (c == null ? c : IMP() ? c * 1.8 + 32 : c);                // temperatures
  const tdv = c => (c == null ? c : IMP() ? c * 1.8 : c);                    // temperature differences
  const tp = (c, d) => `${fmt(tv(c), d == null ? 0 : d)} ${TU()}`;
  const tdp = (c, d) => `${fmt(tdv(c), d == null ? 0 : d)} ${TU()}`;
  const PU = () => (IMP() ? 'psi' : 'bar');                                  // pressures (model in psi)
  const prv = psi => (psi == null ? psi : IMP() ? psi : psi / 14.5038);
  const pr = (psi, d) => `${fmt(prv(psi), d == null ? (IMP() ? 0 : 1) : IMP() ? d : d + 1)} ${PU()}`;
  const FU = () => (IMP() ? 'lbf' : 'N');                                    // forces (model in N)
  const fv = n => (IMP() ? n / 4.44822 : n);
  const frc = (n, d) => `${fmt(fv(n), d == null ? 0 : d)} ${FU()}`;
  window.BRUnits = { IMP, lnv, LU, mlv, ML, tv, TU, PU, prv };
  const spK = () => (SPD === 'mph' ? 1 / 1.609344 : 1);
  const SU = () => (SPD === 'mph' ? 'mph' : 'km/h');
  const spv = kmh => (kmh == null ? kmh : kmh * spK());          // number in the shown unit
  const sp = (kmh, d) => `${fmt(spv(kmh), d)} ${SU()}`;           // text with unit
  const params = S.withDefaults({});
  const ROUTE_ALLOWANCE = 1.25; // harness routing on top of the 3D path [assumption]
  const RM = window.BRCar.routeM;
  params.trunkPtM = +(RM.pt * ROUTE_ALLOWANCE).toFixed(1);
  params.trunkChM = +(RM.ch * ROUTE_ALLOWANCE).toFixed(1);
  params.trunkAllM = +(RM.all * ROUTE_ALLOWANCE).toFixed(1);
  let canBus = null; // bus shown on the CAN tab

  // ------------------------------------------------------------ inputs
  const UNITS = {
    shiftRpm: v => `${v} rpm`, finalDrive: v => (+v).toFixed(2), injFlowCc: v => `${v}`, vehicleV: v => `${(+v).toFixed(1)} V`,
    ambientC: v => tp(+v), soc0: v => `${v} %`, cableMOhm: v => `${v}`, starterA: v => `${v}`, regSet: v => `${(+v).toFixed(1)} V`,
    regFaultMin: v => `${v} min`, mainBreakerA: v => `${v} A`, stagingMin: v => `${v}`, emuFrames: v => `${v}`, extraFrames: v => `${v}`, dashFwdFrames: v => `${v}`, dashFwdHz: v => `${v} Hz`, stubM: v => `${(+v).toFixed(2)}`
  };
  const batSel = $('p_battery');
  batSel.innerHTML = Object.entries(S.BATTERIES).map(([k, b]) => `<option value="${k}">${b.label}</option>`).join('');

  // Tap (or Tab + Enter) on a slider's value to type a number. The number is in the units shown;
  // every display format is a straight-line function of the model value, so two points invert it.
  const FMT = {};
  const numIn = t => { const m = String(t).replace(/[−–]/g, '-').replace(/,/g, '').match(/-?\d+(\.\d+)?|-?\.\d+/); return m ? +m[0] : NaN; };
  function editOutput(out) {
    const el = $(out.id.slice(2));
    if (!el || el.type !== 'range' || out.querySelector('input') || out.dataset.editing) return;
    const f = FMT[el.id] || (v => `${v}`);
    // far-apart reference points so the display rounding doesn't matter
    const mn = +el.min, mx = +el.max, X1 = 1e6, d0 = numIn(f(0)), d1 = numIn(f(X1));
    const ok2 = isFinite(d0) && isFinite(d1) && d1 !== d0;
    const slope = ok2 ? (d1 - d0) / X1 : 1, icpt = ok2 ? d0 : 0;
    const toModel = x => (x - icpt) / slope;
    const shown = numIn(out.textContent);
    const box = document.createElement('input');
    box.type = 'number'; box.step = 'any'; box.className = 'oedit'; box.setAttribute('inputmode', 'decimal');
    box.value = isFinite(shown) ? shown : el.value;
    box.setAttribute('aria-label', 'Type a value');
    const keep = out.textContent;
    out.dataset.editing = '1'; out.textContent = ''; out.appendChild(box);
    const unit = keep.replace(/^[±+]?[−–-]?[\d.,]+\s*/, '');
    if (unit) { const u = document.createElement('span'); u.className = 'ounit'; u.textContent = unit; out.appendChild(u); }
    box.focus(); box.select();
    let done = false;
    const finish = ok => {
      if (done) return; done = true;
      delete out.dataset.editing;
      out.textContent = keep;
      const x = parseFloat(box.value);
      if (!ok || !isFinite(x)) return;
      let v = +toModel(x).toPrecision(6);
      // let a typed value go past the slider's end: widen the slider to hold it
      if (v < mn) el.min = v;
      if (v > mx) el.max = v;
      const st = +el.step || 1, base = +el.min;
      const snap = Math.round((v - base) / st) * st + base;
      if (f(+snap.toFixed(10)) === f(v)) v = +snap.toFixed(10); else el.step = 'any';
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    box.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finish(true); out.focus(); } else if (e.key === 'Escape') { finish(false); out.focus(); } });
    box.addEventListener('blur', () => finish(true));
  }
  function makeEditable() {
    document.querySelectorAll('output[id^="o_"]').forEach(out => {
      const el = $(out.id.slice(2));
      if (!el || el.type !== 'range' || out.dataset.tap) return;
      out.dataset.tap = '1'; out.classList.add('tap'); out.tabIndex = 0; out.setAttribute('role', 'button');
      out.title = 'Tap to type a value';
    });
  }
  document.addEventListener('click', e => { const out = e.target.closest && e.target.closest('output.tap'); if (out && !e.target.matches('input')) { e.preventDefault(); editOutput(out); } });
  document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('output.tap')) { e.preventDefault(); editOutput(e.target); } });

  function bindInputs() {
    document.querySelectorAll('[id^="p_"]').forEach(el => {
      let key = el.id.slice(2);
      if (key === 'ambientC2') key = 'ambientC';
      const v = params[key];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
      const out = $('o_' + el.id);
      FMT[el.id] = v => (UNITS[key] || (x => `${x}`))(v);
      const show = () => { if (out) out.textContent = (UNITS[key] || (x => x))(el.value); };
      show();
      el.addEventListener('input', () => {
        let val = el.type === 'checkbox' ? el.checked : el.value;
        if (el.type === 'range' || /^(bitrate|fdDataRate|emuRate|ber)$/.test(key)) val = +val;
        params[key] = val;
        if (key === 'ambientC') { $('p_ambientC').value = val; $('p_ambientC2').value = val; $('o_p_ambientC').textContent = tp(+val); $('o_p_ambientC2').textContent = tp(+val); }
        show();
        schedule();
      });
    });
  }

  // ------------------------------------------------------------ model run
  let R = {};
  let timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(runModel, 120); }
  function runModel() {
    try { runModelInner(); } catch (e) { console.error(e); window.BRShowError && window.BRShowError('the model', e); }
  }
  function runModelInner() {
    const lap = S.simulateLap(params);
    const power = S.simulatePower(params, lap);
    const buses = S.CAN_LAYOUTS[params.canLayout].buses;
    if (!buses.includes(canBus)) canBus = buses.includes('ch') ? 'ch' : buses[0];
    const cans = S.simulateCanAll(params);
    // terminations on the tab apply to the bus shown; the other bus is assumed correctly terminated
    const phys = buses.map(b => S.canPhysical(b === canBus ? params : Object.assign({}, params, { termEnd1: true, termEnd2: true, termExtra: false }), b));
    R = { lap, power, cans, phys, can: cans[buses.indexOf(canBus)], phy: phys[buses.indexOf(canBus)] };
    try { renderChips(); } catch (e) { window.BRShowError && window.BRShowError('the status chips', e); }
    renderView(currentView);
  }

  // ------------------------------------------------------------ status chips
  const sdOpen = { breaker: false, pms: false, cms: false, bots: false, inertia: false };
  function chip(label, value, level, href) {
    return `<a class="chip ${level}" href="#${href}" style="color:inherit;text-decoration:none"><span class="dot"></span>${label} <b>${value}</b></a>`;
  }
  function renderChips() {
    const { lap, power } = R;
    const maxLoad = Math.max(...R.cans.map(c => c.stats.load));
    const issues = R.phys.reduce((n, p) => n + p.issues.length, 0) + (R.cans.some(c => c.emuOnFd) ? 1 : 0);
    const crankMin = Math.min(...power.minCrankV.map(c => c.v));
    const sd = S.shutdownState(sdOpen);
    const out = [
      chip('Crank min', `${fmt(crankMin)} V`, power.stats.startFails ? 'crit' : crankMin < 9 ? 'warn' : 'good', 'power'),
      chip('Battery at finish', `${fmt(power.stats.endSoc, 0)} %`, !power.stats.alive || power.stats.endSoc < 30 ? 'crit' : power.stats.endSoc < 60 ? 'warn' : 'good', 'power'),
      chip('Charging', `${fmt(power.stats.runVavg)} V`, power.stats.overchargeS > 0 || power.stats.highVwarnS > 0 ? 'crit' : power.stats.lowVwarnS > 30 ? 'warn' : 'good', 'power'),
      chip('Coolant max', tp(power.stats.maxCoolant), power.stats.maxCoolant > 110 ? 'crit' : power.stats.maxCoolant > 102 ? 'warn' : 'good', 'power'),
      chip('Injector duty', `${fmt(lap.stats.maxDuty, 0)} %`, lap.stats.maxDuty > 85 ? 'crit' : lap.stats.maxDuty > 75 ? 'warn' : 'good', 'engine'),
      chip(R.cans.length > 1 ? 'Busiest CAN bus' : 'CAN load', `${fmt(maxLoad, 1)} %`, maxLoad > 70 ? 'crit' : maxLoad > 50 ? 'warn' : 'good', 'can'),
      chip('CAN setup', issues ? `${issues} issue${issues > 1 ? 's' : ''}` : 'OK', issues ? 'crit' : 'good', 'can'),
      chip('Shutdown', sd.engineRuns ? 'closed' : 'open', sd.engineRuns ? 'good' : 'warn', 'shutdown')
    ];
    $('chips').innerHTML = out.join('');
  }

  // ------------------------------------------------------------ routing
  const VIEWS = ['live', 'car', 'engine', 'power', 'shutdown', 'can', 'faults', 'wiring', 'harness', 'components', 'dash', 'inputs'];
  let currentView = 'live';
  function route() {
    const h = location.hash.replace('#', '');
    currentView = VIEWS.includes(h) ? h : 'live';            // the plain dash opens first
    for (const v of VIEWS) $('v-' + v).hidden = v !== currentView;
    document.querySelectorAll('nav.tabs a').forEach(a => a.setAttribute('aria-current', a.getAttribute('href') === '#' + currentView ? 'page' : 'false'));
    if (currentView === 'engine') startEngineAnim(); else stopEngineAnim();
    if (car) { if (currentView === 'car') car.resume(); else car.pause(); }
    if (harness3d) { if (currentView === 'harness') harness3d.resume(); else harness3d.pause(); }
    if (ring && currentView !== 'components') ring.stop();
    if (dashOS && currentView !== 'dash') dashOS.stop();
    if (liveOS && currentView !== 'live') liveOS.stop();
    renderView(currentView);
  }
  function renderView(v) {
    if (!R.lap) return;
    try { renderViewInner(v); } catch (e) { console.error(e); window.BRShowError && window.BRShowError('the ' + v + ' tab', e); }
  }
  function renderViewInner(v) {
    ({ live: renderLive, car: renderCar, engine: renderEngine, power: renderPower, shutdown: renderShutdown, can: renderCan, faults: renderFaults, wiring: renderWiring, harness: renderHarness, components: renderComponents, dash: renderDash, inputs: renderInputs })[v]();
  }

  const kv = (id, items) => { $(id).innerHTML = items.map(([k, v, cls]) => `<div><span>${k}</span><b class="${cls || ''}">${v}</b></div>`).join(''); };
  const flags = (id, items) => { $(id).innerHTML = items.map(([lvl, t]) => `<li class="${lvl}">${t}</li>`).join(''); };
  const xy = (xs, ys, step) => { const o = []; step = step || 1; for (let i = 0; i < xs.length; i += step) o.push({ x: xs[i], y: ys[i] }); return o; };

  // ------------------------------------------------------------ harness 3D view (built the first time it opens)
  let harness3d = null;
  function renderHarness() {
    if (harness3d || !window.BRHarness3D) return;
    harness3d = window.BRHarness3D.mount({ stage: $('hscene'), labels: $('hlabels'), table: $('hTable') });
  }

  // ------------------------------------------------------------ car view
  let car = null, selectedPart = 'battery';
  function partText(id) {
    const { lap, power, can } = R;
    const crank = power.crank;
    const T = {
      engine: `Mock 2012 Honda CBR600RR, 599 cc inline-four, firing order 1-2-4-3, on a 20 mm restrictor (IC.1.6). Model makes about ${fmt(lap.stats.peakHp, 0)} hp at ${lap.stats.peakRpm} rpm and burns ${fmt(lap.stats.fuelPerLapL * 1000, 0)} mL per lap. Open the Engine tab to watch it fire.`,
      ecu: `EMU Black under the seat. It drives 4 injectors (peak duty ${fmt(lap.stats.maxDuty, 0)} %) and 4 coils, reads the stock 12-tooth crank wheel and a cam sync tooth at up to ${fmt(lap.stats.toothHzMax / 1000, 1)} kHz, and sits mid-bus on a ~0.1 m stub to a CAN splice beside it under the seat, with its built-in 120 Ω switched off. It is fed after the master switch but ahead of the kill relay, so it keeps logging when the shutdown circuit opens.`,
      battery: `${power.bat.label}. Cranking pulls it to ${fmt(crank.minV, 1)} V at the inrush peak. It ends the endurance run at ${fmt(power.stats.endSoc, 0)} % charge. With the regulator dead it would run the car for about ${fmt(power.stats.noChargeMin, 0)} minutes.`,
      breaker: `Manual-reset ${params.mainBreakerA} A main breaker between the battery and the master switch. All battery current goes through it. Cranking heats it to ${fmt(power.stats.breakerPeakPct, 0)} % of its trip point.`,
      regulator: `Series MOSFET regulator in the sidepod airflow, set to ${fmt(params.regSet, 1)} V. Its output goes through the second pole of the master switch onto the switched bus. Average heat is about ${fmt(power.stats.regHeatW, 0)} W. Stator gives about 10 A at idle and 26 A at 5000 rpm (charging form, verify).`,
      dash: `Custom dash and dash MCU at the front. The MCU terminates the front end of the CAN 2.0 bus (120 Ω) and is the logger. It reads the IMU and GPS directly and stores them without putting them on CAN (a LoRa link to the pit would also hang off the MCU, not the bus). As logger it records every frame on the bus and sends shared values the nodes need (fused speed, gear, rpm, lap and logging state) back out on IDs 0x140+. It also shows the charging warnings (below 12.8 V above 3000 rpm, above 15.0 V any time).`,
      imu: `IMU next to the dash, wired to the dash MCU. It is about ${fmt(window.BRCar.P.imu[0] + 0.15, 2)} m ahead of the CG, so yaw rate adds false lateral and longitudinal g: at 1.1 rad/s in a tight corner that is about ${fmt(1.1 * 1.1 * (window.BRCar.P.imu[0] + 0.15) / 9.81, 2)} g. Log the offset and correct it in post, or mount the IMU near the CG.`,
      gps: `GPS antenna by the dash with a clear view of the sky, wired to the dash MCU, logged at 20 Hz.`,
      nodeFL: `Corner node FL at the front-left suspension pickup: wheel speed, front brake pressure, steering angle (no suspension pots on this car). MCU (final part not chosen) with an LT8609S 5 V supply, on the CAN 2.0 bus.`,
      nodeFR: `Corner node FR: wheel speed, plus spare channels.`,
      brakeF: `Front brake pressure sensor (0–100 bar, 0.5–4.5 V) in the front circuit, read by node FL at 200 Hz. Peak about ${fmt(R.lap.stats.maxBrakeF, 0)} bar on this lap.`,
      brakeR: `Rear brake pressure sensor in the rear circuit, read by node RL at 200 Hz. Peak about ${fmt(R.lap.stats.maxBrakeR, 0)} bar on this lap.`,
      brakeLight: `Brake light on the rear centerline between wheel centre and shoulder height (T.3.4.2). Driven by node RL from brake pressure, on for ${fmt(R.lap.stats.brakeLightPct, 0)} % of the lap. Its state goes out on CAN as frame 0x0A0.`,
      nodeRL: `Corner node RL: wheel speed, rear brake pressure, and it drives the brake light. It is the rear end of the CAN 2.0 bus and carries a 120 Ω terminator (also the far end in the CAN FD what-if).`,
      nodeRR: `Corner node RR: wheel speed, kept away from the exhaust (150 mm team guideline).`,
      pms: `Primary Master Switch on the right side of the main hoop at shoulder height (T.9.3). 2-pole rotary: pole 1 carries every amp of battery current, pole 2 breaks the regulator output so the alternator is disconnected too. Direct acting, no relay (IC.9.3.2).`,
      cms: `Cockpit Main Switch next to the steering wheel, push-pull, 24 mm minimum (IC.9.4). Works through the kill relay.`,
      bots: `Brake Over Travel Switch behind the brake pedal (T.3.3). Mechanical, latches off, driver cannot reset it.`,
      inertia: `Inertia switch, trips at 8 to 11 g and latches (T.9.4). Optional for IC cars but recommended.`
    };
    return T[id] || '';
  }
  function renderCar() {
    if (!car && window.THREE && window.THREE.OrbitControls) {
      try {
        car = window.BRCar.create($('scene3d'), $('labels3d'), id => {
          selectedPart = id;
          document.querySelectorAll('#parts button').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === id ? 'true' : 'false'));
          $('partInfo').textContent = partText(id);
        });
        $('parts').innerHTML = window.BRCar.PARTS.map(p => `<button type="button" data-id="${p.id}" aria-pressed="false"><i style="background:${p.color}"></i>${p.name}</button>`).join('') +
          `<button type="button" id="shellBtn" aria-pressed="true">Body shell</button>`;
        $('parts').addEventListener('click', e => {
          const b = e.target.closest('button'); if (!b) return;
          if (b.id === 'shellBtn') { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on); car.toggleShell(on); return; }
          car.select(b.dataset.id);
        });
        car.select(selectedPart);
        if (CAD) car.setCad(CAD).catch(e => window.BRShowError && window.BRShowError('the CAD view', e));
      } catch (err) {
        $('scene3d').innerHTML = `<p class="lede" style="padding:16px">The 3D view needs WebGL, which this browser did not provide (${err.message}).</p>`;
      }
    } else if (!window.THREE) {
      $('scene3d').querySelector('.hint').textContent = 'The 3D library did not load. Check the connection and reload.';
    }
    if (car) { car.setEngine(S.shutdownState(sdOpen).engineRuns, 6000); $('partInfo').textContent = partText(selectedPart); }
    if (car) car.setLayout(params.canLayout);
    if (params.canLayout === 'split') {
      $('routeText').textContent = 'Blue: the classic powertrain bus runs straight from the EMU Black under the seat to the dash MCU, with a terminator at each. Green: the CAN FD chassis bus starts at the dash MCU and visits FL, FR, RR and ends at RL, which carries its second terminator.';
    } else {
      $('routeText').textContent = 'One chain: dash unit (dash MCU + fuse/relay box, 120 Ω) → FR → FL → through firewall grommet GR1 → CAN splice beside the EMU under the sloped firewall leg (EMU on a ~0.1 m stub, terminator off) → RR → RL (120 Ω).';
    }
    const buses = S.CAN_LAYOUTS[params.canLayout].buses;
    const items = [];
    buses.forEach((b, i) => {
      const ph = R.phys[i];
      items.push([`${b === 'pt' ? 'EMU bus' : b === 'ch' ? 'FD bus' : 'Bus'} length`, `${fmt(ph.trunk, 1)} m`, ph.trunk > ph.maxLen ? 'bad' : 'ok']);
      items.push([`${b === 'pt' ? 'EMU bus' : b === 'ch' ? 'FD bus' : 'Bus'} load`, `${fmt(R.cans[i].stats.load, 0)} %`, R.cans[i].stats.load > 50 ? 'meh' : 'ok']);
    });
    items.push(['Length basis', CAD && Object.keys(CAD.positions).length ? 'CAD positions × 1.25' : '3D path × 1.25']);
    kv('routeKv', items);
    const bat = R.power.bat;
    const f = [];
    if (bat.chem !== 'agm') f.push(['info', 'The lithium battery sits in the wedge under the sloped lower leg of the bent firewall, on the engine side, so the firewall is between it and the driver (T.1.8.1). T.1.8.4 needs the face toward the driver to be grounded aluminum.']);
    f.push(['info', 'Battery must sit below the shoulder belt mount height and be mounted to structure strong enough for suspension loads (T.9.2.1). Under the seat meets the height part.']);
    f.push(['info', 'The EMU Black sits under the sloped firewall leg on the engine side, close to the CG, so its wires to the engine never cross the firewall. The fuse/relay box is part of the dash unit at the front, so its feeds (F1, kill bus, pump and fan +12 V), the relay drive wires and the CAN chain cross at grommet GR1 (T.1.8).']);
    f.push(['warn', 'The IMU by the dash sits well ahead of the CG. The sensor mounting form wanted it within 150 mm of the CG. Either mount it near the CG on its own wire or correct the lever arm in post-processing.']);
    f.push(['info', 'Corner nodes sit inboard of each wheel, so sensor leads to the wheel speed sensor stay under 1 m (sensor mounting form guideline).']);
    const placed = CAD ? Object.keys(CAD.positions).length : 0;
    f.push(['info', placed ? `${placed} part${placed > 1 ? 's' : ''} placed from CAD; the rest are rough placeholders. With CAD positions, bus lengths follow the frame axes between the parts.` : 'Component positions are rough placeholders until chassis CAD is imported (CAD models card above).']);
    flags('carFlags', f);
  }

  // ------------------------------------------------------------ engine view
  let anim = null, theta = 0, paused = false, lastTs = 0;
  function engineState() { return S.firingEvents(params, +$('e_rpm').value, +$('e_tps').value / 100); }
  function startEngineAnim() {
    if (anim) return;
    lastTs = 0;
    const step = ts => {
      anim = requestAnimationFrame(step);
      const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
      lastTs = ts;
      const ev = engineCache || (engineCache = engineState());
      const running = S.shutdownState(sdOpen).engineRuns && !(ev.cut && ev.rpm > params.revLimit);
      if (!paused && running) theta = (theta + ev.rpm * 6 / +$('e_slow').value * dt) % 720;
      BREngine.drawEngine($('engCanvas'), running ? ev : Object.assign({}, ev, { cut: true, injDeg: 0 }), theta);
      BREngine.drawTiming($('timingCanvas'), running ? ev : Object.assign({}, ev, { cut: true, injDeg: 0 }), theta);
    };
    anim = requestAnimationFrame(step);
  }
  function stopEngineAnim() { if (anim) cancelAnimationFrame(anim); anim = null; }
  let engineCache = null;
  function renderEngineKv() {
    engineCache = engineState();
    const ev = engineCache;
    $('o_e_rpm').textContent = `${ev.rpm} rpm`;
    $('o_e_tps').textContent = `${Math.round(ev.tps * 100)} %`;
    $('o_e_slow').textContent = `${$('e_slow').value}×`;
    const sd = S.shutdownState(sdOpen);
    $('engNote').textContent = !sd.engineRuns ? 'Shutdown circuit is open, so the engine is stopped' : ev.cut ? 'Fuel cut (closed throttle above 3000 rpm)' : `One cycle takes ${fmt(ev.cycleMs, 1)} ms in real time`;
    kv('engKv', [
      ['Manifold pressure', `${fmt(ev.map, 0)} kPa`], ['Lambda target', fmt(ev.lambda, 2)],
      ['Injector pulse', `${fmt(ev.pw, 2)} ms`], ['Injector duty', `${fmt(ev.duty, 0)} %`, ev.duty > 85 ? 'bad' : ''],
      ['Spark advance', `${fmt(ev.advance, 0)}° BTDC`], ['Coil dwell', `${fmt(ev.dwellMs, 1)} ms = ${fmt(ev.dwellDeg, 0)}°`],
      ['Crank tooth rate', `${fmt(ev.rpm * 24 / 60, 0)} Hz`], ['Power', `${fmt(ev.powerKW, 1)} kW`]
    ]);
  }
  ['e_rpm', 'e_tps', 'e_slow'].forEach(id => $(id).addEventListener('input', renderEngineKv));
  $('e_pause').addEventListener('click', () => { paused = !paused; $('e_pause').textContent = paused ? 'Play' : 'Pause'; });

  function renderEngine() {
    renderEngineKv();
    const { lap } = R, s = lap.series, st = lap.stats;
    $('lapNote').textContent = `${fmt(st.lapLen, 0)} m generic lap · ${fmt(st.lapTime, 1)} s · not the competition track`;
    kv('lapKv', [
      ['Lap time', `${fmt(st.lapTime, 1)} s`], ['Average speed', sp(st.avgKmh, 0)], ['Top speed', sp(st.maxKmh, 0)],
      ['Peak power', `${fmt(st.peakHp, 0)} hp @ ${st.peakRpm}`], ['Full throttle', `${fmt(st.wotPct, 0)} % of lap`],
      ['Fuel per lap', `${fmt(st.fuelPerLapL * 1000, 0)} mL`], ['Max injector duty', `${fmt(st.maxDuty, 0)} %`, st.maxDuty > 85 ? 'bad' : 'ok'],
      ['Max tooth rate', `${fmt(st.toothHzMax / 1000, 2)} kHz`]
    ]);
    const step = 5;
    const o = { xTitle: 'Time (s)', xMin: 0, xMax: st.lapTime };
    C.draw('c_speed', [{ label: 'Speed', data: xy(s.t, s.v.map(spv), step), color: '--s1' }], o);
    C.draw('c_rpm', [{ label: 'RPM', data: xy(s.t, s.rpm, step), color: '--s2' }], Object.assign({ refs: [{ y: params.shiftRpm, label: 'shift' }] }, o));
    C.draw('c_tps', [{ label: 'TPS', data: xy(s.t, s.tps, step), color: '--s3' }], Object.assign({ yMin: 0, yMax: 100 }, o));
    C.draw('c_map', [{ label: 'MAP', data: xy(s.t, s.map, step), color: '--s7' }], Object.assign({ yMin: 0, yMax: 105 }, o));
    C.draw('c_duty', [{ label: 'Duty', data: xy(s.t, s.duty, step), color: '--s1' }], Object.assign({ yMin: 0, ySugMax: 100, refs: [{ y: 85, label: '85 % limit' }] }, o));
    C.draw('c_pw', [{ label: 'Pulse', data: xy(s.t, s.pw, step), color: '--s5' }], Object.assign({ yMin: 0 }, o));
    $('chokeTxt').textContent = fmt(lap.chokeGs, 0);
    C.draw('c_wot', [{ label: 'Power kW', data: lap.wotSweep.map(r => ({ x: r.rpm, y: r.kW })), color: '--s2' }], { xTitle: 'Engine speed (rpm)', yMin: 0 });
    C.draw('c_dead', [{ label: 'Pulse ms', data: lap.deadSweep.map(r => ({ x: r.v, y: r.pw })), color: '--s1' }], { xTitle: 'Battery voltage (V)', yMin: 0, vrefs: [{ x: params.regSet, label: 'reg set' }] });
  }

  // ------------------------------------------------------------ power view
  function renderPower() {
    const { power } = R, s = power.series, st = power.stats;
    $('batNote').textContent = power.bat.note;
    const bands = power.events.filter(e => !e.bad).map((e, i, a) => ({ x0: e.t / 60, x1: (a[i + 1] ? a[i + 1].t : st.totalMin * 60) / 60, label: e.name }));
    $('pwrNote').textContent = `${power.laps} laps of ${fmt(R.lap.lapLen, 0)} m for ${params.endurKm} km · ${fmt(st.totalMin, 0)} min total`;
    const crankMin = Math.min(...power.minCrankV.map(c => c.v));
    kv('pwrKv', [
      ['Lowest crank voltage', `${fmt(crankMin)} V`, power.stats.startFails ? 'bad' : crankMin < 9 ? 'meh' : 'ok'],
      ['Hot restart', power.minCrankV[1] && power.minCrankV[1].ok ? 'Starts' : 'Fails', power.minCrankV[1] && power.minCrankV[1].ok ? 'ok' : 'bad'],
      ['Charge at finish', `${fmt(st.endSoc, 0)} %`, st.endSoc < 30 ? 'bad' : st.endSoc < 60 ? 'meh' : 'ok'],
      ['Lowest charge', `${fmt(st.minSoc, 0)} %`],
      ['Voltage while racing', `${fmt(st.runVavg, 2)} V avg`],
      ['Average load', `${fmt(st.avgLoadA, 1)} A`],
      ['Fan duty racing', `${fmt(st.fanDuty, 0)} %`],
      ['Regulator heat', `${fmt(st.regHeatW, 0)} W`],
      ['Fuel used', `${fmt(st.fuelL, 2)} L`],
      ['Run time, no charging', `${fmt(st.noChargeMin, 0)} min`, st.noChargeMin < 15 ? 'meh' : 'ok'],
      ['Main breaker peak', `${fmt(st.breakerPeakPct, 0)} % of trip`, st.breakerPeakPct > 80 ? 'bad' : st.breakerPeakPct > 50 ? 'meh' : 'ok']
    ]);
    const f = [];
    if (power.bmsTrip) f.push(['crit', `${power.bmsTrip}. The car loses all power.`]);
    if (st.startFails) f.push(['crit', 'The engine does not restart: the ECU browns out during cranking or the battery cut out. This is a DNF at the driver change (D.12.9).']);
    if (st.overchargeS > 0) f.push(['crit', power.bat.chem === 'lipo'
      ? `A 3S LiPo is full at 12.6 V, but the regulator holds ${fmt(params.regSet, 1)} V, so the pack sits above its limit for ${fmt(st.overchargeS / 60, 0)} min. A LiPo can't go on this charging system. Use a 4S LiFePO4 "12 V lithium" battery.`
      : `Battery held above its safe voltage for ${fmt(st.overchargeS / 60, 0)} min.`]);
    if (st.highVwarnS > 0) f.push(['crit', `Bus above 15.0 V for ${fmt(st.highVwarnS, 0)} s. The dash over-voltage warning fires.`]);
    if (st.lowVwarnS > 0) f.push(['warn', `Below 12.8 V above 3000 rpm for ${fmt(st.lowVwarnS, 0)} s. The dash not-charging warning fires.`]);
    if (power.crank.bmsTrip) f.push(['crit', 'Starter inrush exceeds what the battery BMS allows, so it cuts out on the first crank.']);
    if (power.crank.mcuReset) f.push(['warn', 'Node MCUs reset during the crank inrush (3.3 V rail dips). They reboot and rejoin the bus within ms but will log a reset count.']);
    if (power.bat.capAh <= 4) f.push(['warn', `With a ${power.bat.capAh} Ah battery, a dead regulator leaves about ${fmt(st.noChargeMin, 0)} min of running. That is less than one endurance stint, so the dash warning matters.`]);
    if (!f.length) f.push(['good', 'No faults: the engine starts both times, the battery finishes charged and voltages stay inside limits.']);
    flags('pwrFlags', f);

    const o = { xTitle: 'Time (min)', xMin: 0, xMax: st.totalMin, bands };
    C.draw('c_v', [{ label: 'Bus V', data: xy(s.t, s.v), color: '--s1' }], Object.assign({ ySugMin: 9, ySugMax: 15, refs: [{ y: 12.8, label: '12.8 V not charging' }, { y: 15, label: '15 V over-voltage' }] }, o));
    C.draw('c_soc', [{ label: 'SOC', data: xy(s.t, s.soc), color: '--s3', fill: true }], Object.assign({ yMin: 0, yMax: 100 }, o, { bands: [] }));
    C.draw('c_cool', [{ label: 'Coolant', data: xy(s.t, s.cool.map(tv)), color: '--s2' }], Object.assign({ refs: [{ y: tv(params.fanOnC), label: 'fan on' }] }, o, { bands: [] }));
    C.legend('curLegend', [['Loads', '--s2'], ['Regulator output', '--s3'], ['Battery (+ = discharge)', '--s1']]);
    const clip = a => a.map(p => ({ x: p.x, y: Math.max(-40, Math.min(60, p.y)) }));
    C.draw('c_cur', [
      { label: 'Loads', data: clip(xy(s.t, s.iload)), color: '--s2', width: 1.5 },
      { label: 'Regulator', data: xy(s.t, s.ireg), color: '--s3', width: 1.5 },
      { label: 'Battery', data: clip(xy(s.t, s.ibat)), color: '--s1', width: 1.5 }
    ], Object.assign({ ySugMin: -20, ySugMax: 40, refs: [{ y: 0 }] }, o, { bands: [] }));

    const cr = power.crank, cs = cr.series;
    C.legend('crankLegend', [['Battery bus', '--s1'], ['Node 5 V rail', '--s3'], ['Node 3.3 V', '--s7'], ['ECU brown-out', '--ink-3', true]]);
    C.draw('c_crank', [
      { label: 'Bus', data: xy(cs.t, cs.v, 4), color: '--s1' },
      { label: '5 V', data: xy(cs.t, cs.v5, 4), color: '--s3' },
      { label: '3.3 V', data: xy(cs.t, cs.v33, 4), color: '--s7' }
    ], { xTitle: 'Time from starter engage (ms)', yMin: 0, ySugMax: 14, refs: [{ y: params.ecuMinV, label: 'ECU min (assumed)' }] });
    kv('crankKv', [
      ['Open circuit', `${fmt(cr.ocv, 2)} V`], ['Lowest bus', `${fmt(cr.minV, 2)} V`, cr.ecuReset ? 'bad' : 'ok'],
      ['Peak current', `${fmt(cr.peakA, 0)} A`], ['5 V rail low', `${fmt(cr.min5, 2)} V`, cr.min5 < 4.75 ? 'meh' : 'ok'],
      ['ECU', cr.ecuReset ? 'Resets' : 'Stays up', cr.ecuReset ? 'bad' : 'ok'], ['Nodes', cr.mcuReset ? 'Reset' : 'Stay up', cr.mcuReset ? 'meh' : 'ok']
    ]);
  }

  // ------------------------------------------------------------ shutdown view
  let sdLast = 'cms';
  function renderShutdown() {
    const st = S.shutdownState(sdOpen);
    const css = C.css;
    const live = css('--accent'), dead = css('--ink-3'), bad = css('--crit'), ok = css('--good');
    const W = (pts, on) => `<polyline points="${pts}" fill="none" stroke="${on ? live : dead}" stroke-width="${on ? 3 : 2}" ${on ? '' : 'stroke-dasharray="6 5"'}/>`;
    const sw = (id, x, y, label, rule) => {
      const open = sdOpen[id];
      return `<g class="sw" data-sw="${id}" tabindex="0" role="button" aria-pressed="${open}">
        <rect x="${x - 58}" y="${y - 22}" width="116" height="44" rx="5" fill="${css('--panel')}" stroke="${open ? bad : ok}" stroke-width="2"/>
        <text x="${x}" y="${y - 4}" text-anchor="middle" font-size="12" font-weight="600">${label}</text>
        <text x="${x}" y="${y + 12}" text-anchor="middle" font-size="11" fill="${open ? bad : css('--ink-2')}" style="fill:${open ? bad : css('--ink-2')}">${open ? 'OPEN · tap to close' : 'closed · ' + rule}</text></g>`;
    };
    const load = (x, y, label, on) => `<g><rect x="${x - 46}" y="${y - 15}" width="92" height="30" rx="4" fill="${on ? css('--bg') : 'transparent'}" stroke="${on ? live : dead}" stroke-width="1.5"/>
      <text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11.5" style="fill:${on ? css('--ink') : css('--ink-3')}">${label}</text></g>`;
    const bat = st.battery;
    const loop = st.killRelay;
    let s = '';
    // battery and master switch, main bus
    s += `<rect x="12" y="40" width="70" height="40" rx="4" fill="${css('--panel')}" stroke="${css('--s2')}" stroke-width="2"/><text x="47" y="58" text-anchor="middle" font-size="12" font-weight="600">Battery</text><text x="47" y="72" text-anchor="middle" font-size="10.5" style="fill:${css('--ink-2')}">NOCO NLP14</text>`;
    s += W('82,60 92,60', true);
    s += sw('breaker', 150, 60, `Main breaker`, `${params.mainBreakerA} A`);
    s += W('208,60 222,60', !sdOpen.breaker);
    s += sw('pms', 280, 60, 'Primary Master', '2-pole');
    s += W(`338,60 880,60`, bat);
    s += `<text x="880" y="50" text-anchor="end" font-size="11" style="fill:${css('--ink-3')}">fuse box</text>`;
    // regulator charges through the second PMS pole onto the switched bus
    s += W('280,82 280,124', bat && st.engineRuns) + load(280, 139, 'Regulator', bat && st.engineRuns);
    s += `<text x="286" y="104" font-size="10" style="fill:${css('--ink-3')}">pole 2</text>`;
    // loads on the switched bus
    [[412, 'Starter relay'], [508, 'EMU Black'], [604, 'Dash, nodes'], [700, 'IMU, GPS, fan'], [796, 'Brake light']].forEach(([x, l]) => { s += W(`${x},60 ${x},98`, bat) + load(x, 113, l, bat); });
    // kill loop
    s += W('360,60 360,170 340,170 340,178', bat);
    const after = (ids) => bat && ids.every(i => !sdOpen[i]);
    s += sw('cms', 340, 200, 'Cockpit Main', 'IC.9.4');
    s += W('398,200 422,200', after(['cms']));
    s += sw('bots', 480, 200, 'BOTS', 'T.3.3');
    s += W('538,200 562,200', after(['cms', 'bots']));
    s += sw('inertia', 620, 200, 'Inertia switch', 'T.9.4');
    s += W('678,200 712,200', loop);
    s += `<rect x="712" y="184" width="66" height="32" rx="3" fill="${loop ? css('--bg') : 'transparent'}" stroke="${loop ? live : dead}" stroke-width="2"/><text x="745" y="204" text-anchor="middle" font-size="11">Kill relay</text>`;
    s += W('778,200 800,200 800,214', loop) + `<text x="800" y="228" text-anchor="middle" font-size="10" style="fill:${css('--ink-3')}">gnd</text>`;
    // relay contacts and switched loads
    s += W('880,60 880,290 800,290', bat);
    s += `<line x1="745" y1="216" x2="745" y2="278" stroke="${css('--ink-3')}" stroke-dasharray="3 3"/>`;
    s += `<line x1="800" y1="290" x2="${loop ? 760 : 764}" y2="${loop ? 290 : 274}" stroke="${loop ? live : dead}" stroke-width="3"/><circle cx="800" cy="290" r="3" fill="${css('--ink')}"/><circle cx="756" cy="290" r="3" fill="${css('--ink')}"/>`;
    s += W('756,290 140,290', loop);
    [[640, 'Fuel pump'], [480, 'Ignition coils ×4'], [320, 'Injectors ×4']].forEach(([x, l]) => { s += load(x, 290, l, loop); });
    s += `<text x="140" y="318" font-size="11" style="fill:${css('--ink-3')}">Switched by the kill relay: opening any switch above stops the engine in hardware (IC.9.2.2)</text>`;
    $('sdSvg').innerHTML = s;

    const feeds = [
      ['EMU Black', st.feeds.ecu, 'keeps logging'], ['Dash', st.feeds.dash], ['Corner nodes, IMU, GPS', st.feeds.nodes],
      ['Injectors', st.feeds.injectors], ['Ignition coils', st.feeds.coils], ['Fuel pump', st.feeds.fuelPump],
      ['Charging circuit', st.feeds.charging, 'through PMS pole 2'], ['Brake light', st.feeds.nodes, 'via node RL'], ['Engine', st.engineRuns, '', 'Running', 'Stopped'], ['CAN bus', st.feeds.ecu, '', 'Live', 'Dead']
    ];
    $('sdFeeds').innerHTML = feeds.map(([n, on, note, a, b]) => `<div><span>${n}</span><b class="${on ? 'ok' : 'bad'}">${on ? (a || 'Powered') : (b || 'No power')}${on && note ? ' · ' + note : ''}</b></div>`).join('');

    const which = ['breaker', 'pms', 'cms', 'bots', 'inertia'].find(k => sdOpen[k]) || sdLast;
    const r = S.simulateShutdown(params, which === 'breaker' ? 'pms' : which, 6000);
    const names = { breaker: 'main breaker', pms: 'Primary Master Switch', cms: 'Cockpit Main Switch', bots: 'BOTS', inertia: 'Inertia switch' };
    C.legend('sdLegend', [[`Engine rpm after the ${names[which]} opens`, '--s2']]);
    C.draw('c_sd', [{ label: 'rpm', data: xy(r.series.t, r.series.rpm), color: '--s2' }], { xTitle: 'Time after opening (ms)', yMin: 0, vrefs: [{ x: r.cutMs, label: 'ignition + fuel off' }] });
    kv('sdKv', [
      ['Fuel and spark cut', `${fmt(r.cutMs, 1)} ms`], ['Engine stopped', r.stopMs != null ? `${fmt(r.stopMs / 1000, 2)} s` : '> 2.5 s'],
      ['ECU logging', r.ecuLogs ? 'Continues' : 'Lost', r.ecuLogs ? 'ok' : 'meh'], ['CAN after event', r.ecuLogs ? 'Live' : 'Dead']
    ]);
    flags('sdFlags', [
      ['good', 'Primary Master Switch is a 2-pole rotary switch. Pole 1 carries all battery current, charge and discharge. Pole 2 is in the regulator output, so opening the switch disconnects the alternator as well and it cannot keep the loads alive (IC.9.3.2).'],
      ['good', `A manual-reset ${params.mainBreakerA} A breaker sits between the battery and the master switch, so the whole car is protected (T.9.2.2). Its rating must be at or below the NLP14's maximum discharge current (check NOCO's datasheet) and high enough to pass cranking.`],
      ['good', 'Cockpit Main Switch, BOTS and inertia switch act through one kill relay (IC.9.4.3 allows a relay). Fuel pump and ignition lose power when it drops (IC.9.2.2).'],
      ['info', 'BOTS must be a mechanical SPST switch with analog wiring only, and the driver must not be able to reset it (T.3.3.2 to T.3.3.5).'],
      ['info', 'Inertia switch must trip between 8 and 11 g and latch until reset (T.9.4.3). It is a "should" for IC cars, but cheap insurance.'],
      ['info', 'No BSPD needed: with a cable throttle, IC.4.8 and the ETC parts of IC.9 do not apply.'],
      ['warn', `Relay drop-out time (${fmt(8, 0)} ms here) is an assumption. Measure it on the bench and test every switch at each build, as IC.9.1.2 requires a demo at tech.`]
    ]);
  }
  $('sdSvg').addEventListener('click', e => {
    const g = e.target.closest('[data-sw]'); if (!g) return;
    const id = g.dataset.sw; sdOpen[id] = !sdOpen[id]; if (sdOpen[id]) sdLast = id;
    renderShutdown(); renderChips(); if (car) car.setEngine(S.shutdownState(sdOpen).engineRuns);
  });
  $('sdSvg').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-sw]')) { e.preventDefault(); e.target.closest('[data-sw]').dispatchEvent(new MouseEvent('click', { bubbles: true })); } });

  // ------------------------------------------------------------ CAN view
  const NODE_NAME = { EMU: 'EMU Black', FL: 'Node FL', FR: 'Node FR', RL: 'Node RL', RR: 'Node RR', Dash: 'Dash MCU', X: 'Extra' };
  function renderCan() {
    const { can, phy } = R, st = can.stats;
    const buses = S.CAN_LAYOUTS[params.canLayout].buses;
    $('v_bus').innerHTML = buses.map(b => `<option value="${b}" ${b === canBus ? 'selected' : ''}>${S.BUS_INFO[b].name}</option>`).join('');
    $('lblEnd1').textContent = `120 Ω at ${phy.ends[0]}`;
    $('lblEnd2').textContent = `120 Ω at ${phy.ends[1]}`;
    $('canNote').textContent = `${can.info.name} · ${can.msgs.length} frame types · ${can.fd ? `${params.bitrate / 1e6} Mbps arbitration, ${params.fdDataRate / 1e6} Mbps data` : `${params.bitrate / 1000} kbps`}`;
    const lvl = st.load > 70 ? 'bad' : st.load > 50 ? 'meh' : 'ok';
    kv('canKv', [
      ['Frames per second', fmt(st.fps, 0)], ['Bus load', `${fmt(st.load, 1)} %`, lvl], ['Busiest 10 ms', `${fmt(st.peakWin, 0)} %`],
      ['Worst latency seen', `${fmt(st.maxLatency, 2)} ms`], ['Worst case (analysis)', `${fmt(st.wcrtMax, 2)} ms`],
      ['Missed deadlines', String(st.unschedulable), st.unschedulable ? 'bad' : 'ok'], ['Overwritten frames', String(st.overruns), st.overruns ? 'bad' : 'ok'],
      ['Error frames', String(st.errFrames), st.errFrames ? 'meh' : ''], ['Logging rate', `${fmt(st.logKBs, 0)} kB/s`], ['30 min run', `${fmt(st.logMB30, 0)} MB`]
    ]);
    const f = [];
    if (can.emuOnFd) f.push(['crit', 'The EMU Black is a classic CAN device. On a CAN FD bus it cannot read FD frames and answers every one with an error frame, so the bus keeps failing. Keep the EMU on its own classic bus (the two-bus layout).']);
    if (params.canLayout === 'split') {
      const other = R.cans.find(c => c !== can);
      f.push(['info', `Two buses: the dash MCU bridges them. The other bus (${other.info.name}) runs at ${fmt(other.stats.load, 0)} % load.`]);
      f.push(['info', 'Every node on the chassis bus needs a CAN FD controller and an FD-rated transceiver (the STM32G474 has FDCAN built in). A USB-CAN adapter for the laptop must also support FD.']);
    }
    if (st.load > 70) f.push(['crit', `Bus load ${fmt(st.load, 0)} % is over the DAQ form's 70 % limit.`]);
    else if (st.load > 50) f.push(['warn', `Bus load ${fmt(st.load, 0)} % is over the 50 % target.`]);
    else f.push(['good', `Bus load ${fmt(st.load, 0)} % is under the 50 % target, with room for about ${Math.max(0, Math.floor((50 - st.load) / st.frame200Pct))} more 200 Hz frames.`]);
    if (st.unschedulable) f.push(['crit', `${st.unschedulable} frame types can miss their period in the worst case. The lowest-priority IDs get starved.`]);
    if (params.nodeOffline !== 'none') f.push(['warn', `Node ${params.nodeOffline} is offline. Its heartbeat stops, so the dash and logger should flag it within 0.5 s (MCU form R9). The rest of the bus is unaffected.`]);
    if (st.errFrames) f.push(['warn', `${st.errFrames} error frames per second. Each one costs a retransmit. Shielded twisted pair and a single ground point fix most of this.`]);
    for (const i of phy.issues) f.push(['crit', i]);
    flags('canFlags', f);

    // brakes
    const ls = R.lap.series, lst = R.lap.stats;
    C.legend('brakeLegend', [['Front pressure (FL node)', '--s2'], ['Rear pressure (RL node)', '--s1'], ['Brake light on', '--crit']]);
    const lbands = [];
    let on0 = null;
    for (let i = 0; i <= ls.t.length; i++) {
      const on = i < ls.t.length && ls.brakeLight[i];
      if (on && on0 === null) on0 = i;
      if (!on && on0 !== null) { lbands.push({ x0: ls.t[on0], x1: ls.t[i - 1], color: hexA(C.css('--crit'), 0.13) }); on0 = null; }
    }
    C.draw('c_brake', [
      { label: 'Front bar', data: xy(ls.t, ls.brakeF, 5), color: '--s2' },
      { label: 'Rear bar', data: xy(ls.t, ls.brakeR, 5), color: '--s1' }
    ], { xTitle: 'Time (s)', xMin: 0, xMax: lst.lapTime, yMin: 0, bands: lbands, refs: [{ y: params.brakeOnBar, label: `light on > ${params.brakeOnBar} bar` }] });
    const bl = can.rta.find(r => r.id === 0x0A0);
    kv('brakeKv', [
      ['Peak front', `${fmt(lst.maxBrakeF, 0)} bar`], ['Peak rear', `${fmt(lst.maxBrakeR, 0)} bar`], ['Brake applications', `${lst.brakeApps} per lap`],
      ['Light on', `${fmt(lst.brakeLightPct, 0)} % of lap`], ['State frame', '0x0A0 · 50 Hz + on change'],
      ['Frame worst case', bl ? `${fmt(bl.wcrt, 2)} ms` : 'not on this bus']
    ]);
    flags('brakeFlags', [
      ['info', `Front pressure is read by node FL, rear by node RL. The light turns on above ${params.brakeOnBar} bar on either circuit and off below ${params.brakeOffBar} bar, so it does not flicker at light pedal pressure.`],
      ['good', 'Node RL drives the brake light from its own rear sensor directly, and uses the front pressure from CAN as a second input. If the bus or the front node drops out, the light still works from the rear circuit.'],
      ['warn', 'Consider a hydraulic brake light pressure switch wired in parallel as a no-software backup. T.3.4 only says the light must be clearly visible, but tech will press the pedal and look. Codes BR-W08 and BR-W09 cover a dead light and a failed sensor.']
    ]);

    C.draw('c_load', [{ label: 'Load', data: can.loadWin.map((y, i) => ({ x: i * can.winMs, y })), color: '--s1', stepped: true, width: 1.5 }],
      { xTitle: 'Time (ms)', yMin: 0, ySugMax: 100, refs: [{ y: 50, label: '50 % target' }, { y: 70, label: '70 % limit' }] });
    const nodes = Object.entries(can.byNode).sort((a, b) => b[1] - a[1]);
    C.draw('c_nodes', [{ label: 'Load %', data: nodes.map(n => n[1]), color: '--s1' }], { bar: true, labels: nodes.map(n => NODE_NAME[n[0]] || n[0]), yMin: 0 });
    $('sweepTitle').textContent = can.fd ? 'Same traffic at other FD rates (%)' : 'Same traffic at each bitrate (%)';
    C.draw('c_sweep', [{ label: 'Load %', data: can.sweep.map(s => s.load), colors: can.sweep.map(s => s.load > 70 ? '--crit' : s.load > 50 ? '--warn' : '--s1') }],
      { bar: true, labels: can.sweep.map(s => s.label), yMin: 0, ySugMax: 100, refs: [{ y: 50, label: '50 %' }, { y: 70, label: '70 %' }] });
    const rta = new Map(can.rta.map(r => [r.id, r]));
    $('msgTable').innerHTML = `<thead><tr><th>ID</th><th>Frame</th><th>From</th><th class="num">Bytes</th><th class="num">Rate</th><th class="num">Mean latency</th><th class="num">Max seen</th><th class="num">Worst case</th><th class="num">Period</th></tr></thead><tbody>` +
      can.per.map(m => { const r = rta.get(m.id); return `<tr><td class="mono">0x${m.id.toString(16).toUpperCase()}</td><td>${m.name}</td><td>${NODE_NAME[m.node] || m.node}</td><td class="num">${m.bytes}</td><td class="num">${m.hz} Hz</td><td class="num">${fmt(m.mean, 3)} ms</td><td class="num">${fmt(m.max, 3)} ms</td><td class="num" style="color:${r && !r.ok ? 'var(--crit-ink)' : 'inherit'}">${fmt(r && r.wcrt, 3)} ms</td><td class="num">${fmt(m.period, 1)} ms</td></tr>`; }).join('') + '</tbody>';

    $('phyNote').textContent = `${phy.ends[0]} to ${phy.ends[1]} · ${fmt(phy.trunk, 1)} m${can.fd ? ' · data-phase bit' : ''}`;
    C.draw('c_phy', [{ label: 'Level', data: phy.wave.t.map((t, i) => ({ x: t, y: phy.wave.v[i] })), color: '--s3' }],
      { xTitle: 'Time into one bit (ns)', ySugMin: -0.2, ySugMax: 1.2, vrefs: [{ x: phy.samplePointNs, label: 'sample point' }], refs: [{ y: 0.5, label: 'threshold' }] });
    kv('phyKv', [
      ['Bus resistance', phy.rTotal === Infinity ? 'open' : `${fmt(phy.rTotal, 0)} Ω`, phy.terms === 2 ? 'ok' : 'bad'],
      ['One-way delay', `${fmt(phy.propNs, 0)} ns`], ['Max trunk', `${fmt(phy.maxLen, 0)} m`], ['Max stub', `${fmt(phy.maxStub, 2)} m`, params.stubM > phy.maxStub ? 'bad' : 'ok']
    ]);

    const rate = +$('a_rate').value, filt = $('a_filt').checked, rpm = +$('a_rpm').value;
    $('o_a_rpm').textContent = `${rpm} rpm`;
    const a = S.aliasDemo(rate, filt, rpm, 0.5);
    C.legend('aliasLegend', [['True signal', '--ink-3'], ['Logged', '--s2']]);
    C.draw('c_alias', [
      { label: 'True', data: a.out.truth.filter((_, i) => i % 2 === 0), color: '--ink-3', width: 1.5 },
      { label: 'Logged', data: a.out.logged, color: '--s2', points: a.out.logged.length < 120, width: 1.5 }
    ], { xTitle: 'Time (ms)', xMin: 0, xMax: 500 });
    $('aliasNote').textContent = `Engine vibration at ${fmt(a.fv, 0)} Hz aliases to a fake ${fmt(a.aliasHz, 0)} Hz signal when sampled at ${rate} Hz. RMS error vs the true signal: ${fmt(a.rms, 2)}. ` +
      (filt ? 'With the anti-alias chain the error left is mostly filter lag.' : 'Turn the filter chain on to see the fix from the sample-rate form.');
  }
  ['a_rate', 'a_filt', 'a_rpm'].forEach(id => $(id).addEventListener('input', () => renderCan()));
  $('v_bus').addEventListener('input', () => { canBus = $('v_bus').value; runModel(); });

  // ------------------------------------------------------------ faults view
  let faultCode = 'BR-C01';
  const SEV_COLOR = { critical: '--crit', warning: '--warn', info: '--accent' };
  const hex3 = id => '0x' + id.toString(16).toUpperCase().padStart(3, '0');
  const catColor = n => n === 'Fault' ? '--crit' : n === 'EMU' ? '--s1' : /^(FL|FR|RL|RR)$/.test(n) ? '--s3' : n === 'Dash' ? '--s7' : '--ink-3';

  function renderFaults() {
    const sel = $('f_code');
    if (!sel.options.length) {
      sel.innerHTML = S.FAULTS.map(f => `<option value="${f.code}">${f.code} · ${f.name}</option>`).join('');
      sel.addEventListener('input', () => { faultCode = sel.value; renderFaults(); });
    }
    sel.value = faultCode;
    const bus = R.can.bus;
    const r = S.simulateFault(params, faultCode, bus);
    const f = r.f, band = r.band, lg = r.logic;
    const css = C.css;

    $('faultCard').innerHTML = `<span class="sev" style="--c:var(${SEV_COLOR[f.sev]})">${band.label}</span> · CAN ID <b class="mono">${hex3(f.id)}</b><br>${f.cond}.<br>Debounce ${f.debounceMs} ms, clear after ${f.clearMs} ms${f.latch ? ', latching' : ''}.<br>${f.action}`;

    // logic chart with state bands
    $('logicTitle').textContent = `${f.code} logic: ${f.name}`;
    C.legend('logicLegend', [['Signal', '--s1'], ['Pending', '--warn'], ['Active', '--crit'], ['Clearing', '--accent']]);
    const s = lg.series, bands = [];
    const colors = { PENDING: hexA(css('--warn'), 0.22), ACTIVE: hexA(css('--crit'), 0.2), CLEARING: hexA(css('--accent'), 0.18) };
    let start = null, cur = 'OK';
    for (let i = 0; i <= s.t.length; i++) {
      const st = i < s.t.length ? s.state[i] : 'END';
      if (st !== cur) {
        if (cur !== 'OK' && start !== null) bands.push({ x0: s.t[start], x1: s.t[Math.min(i, s.t.length - 1)], label: cur.toLowerCase(), color: colors[cur] });
        cur = st; start = i;
      }
    }
    C.draw('c_fault', [{ label: f.unit, data: xy(s.t, s.v), color: '--s1' }],
      { xTitle: 'Time (s)', xMin: 0, xMax: lg.dur, bands, refs: [{ y: f.thr, label: `threshold ${f.thr} ${f.unit}` }] });
    kv('logicKv', [
      ['Condition starts', lg.firstTrue != null ? `${fmt(lg.firstTrue, 2)} s` : '–'],
      ['Code active', lg.setAt != null ? `${fmt(lg.setAt, 2)} s` : 'never', lg.setAt != null ? 'bad' : 'ok'],
      ['Code cleared', f.latch ? 'Latched until reset' : lg.clearAt != null ? `${fmt(lg.clearAt, 2)} s` : '–'],
      ['Signal unit', f.unit], ['Source', f.src]
    ]);

    // priority map
    const PRIO = [
      [0x080, 0x08F, 'Critical faults', '--crit'], [0x090, 0x09F, 'Warning faults', '--warn'], [0x0A0, 0x0A0, 'Brake light state (node RL)', '--s2'],
      [0x100, 0x103, 'Corner nodes, 200 Hz data', '--s3'], [0x10C, 0x10F, 'Corner temperatures, 10 Hz', '--s3'],
      [0x120, 0x129, 'IMU and GPS via dash MCU', '--s7'], [0x130, 0x13B, 'Extra channels', '--ink-3'],
      [0x600, 0x60F, 'EMU Black stream (base 0x600, verify)', '--s1'], [0x650, 0x650, 'Dash buttons, shift light', '--s7'],
      [0x701, 0x705, 'Node and dash heartbeats', '--ink-3'], [0x7E0, 0x7EF, 'Info faults', '--accent'], [0x7F0, 0x7F0, 'Logger time sync', '--s7']
    ];
    const X0 = 40, X1 = 400, rowH = 24, top = 30;
    const px = id => X0 + id / 0x7FF * (X1 - X0);
    let ps = `<text x="${X0}" y="16" font-size="11" style="fill:${css('--ink-3')}">highest priority</text><text x="${X1}" y="16" text-anchor="end" font-size="11" style="fill:${css('--ink-3')}">lowest</text>`;
    for (let id = 0; id <= 0x700; id += 0x100) ps += `<line x1="${px(id)}" y1="22" x2="${px(id)}" y2="${top + PRIO.length * rowH}" stroke="${css('--grid')}"/><text x="${px(id)}" y="${top + PRIO.length * rowH + 14}" text-anchor="middle" font-size="10.5" style="fill:${css('--ink-3')}">${hex3(id)}</text>`;
    PRIO.forEach(([a, b, label, col], i) => {
      const y = top + i * rowH;
      const hit = f.id >= a && f.id <= b;
      ps += `<rect x="${px(a) - 2}" y="${y + 3}" width="${Math.max(5, px(b) - px(a) + 4)}" height="${rowH - 7}" rx="2" fill="${css(col)}"/>`;
      ps += `<text x="${X1 + 16}" y="${y + rowH / 2 + 4}" font-size="14" style="fill:${css('--ink')};font-weight:${hit ? 700 : 400}">${hex3(a)}${b !== a ? '–' + hex3(b) : ''}  ${label}${hit ? '  ← ' + f.code : ''}</text>`;
    });
    const H = top + PRIO.length * rowH + 22;
    $('prioSvg').setAttribute('viewBox', `0 0 900 ${H}`);
    $('prioSvg').innerHTML = ps;

    // Gantt of the bus around the injection
    const t0 = r.injectMs / 1000, tA = -0.45e-3, tB = 2.4e-3;
    const gx = t => 120 + (t - t0 - tA) / (tB - tA) * 770;
    const lane = (trace, y, label, faultId) => {
      let g = `<text x="8" y="${y + 22}" font-size="12" style="fill:${css('--ink')}">${label}</text>`;
      for (const fr of trace) {
        const x0 = Math.max(120, gx(fr.start)), x1 = Math.min(890, gx(fr.end));
        if (x1 <= 120 || x0 >= 890) continue;
        const isF = fr.id === faultId;
        const col = isF ? css(SEV_COLOR[f.sev]) : css(catColor(fr.node));
        g += `<rect x="${x0}" y="${y + 6}" width="${Math.max(1, x1 - x0 - 2)}" height="26" rx="3" fill="${col}" ${isF ? '' : 'fill-opacity="0.75"'}><title>${hex3(fr.id)} ${fr.name}</title></rect>`;
        if (x1 - x0 > 34) g += `<text x="${(x0 + x1) / 2 - 1}" y="${y + 23}" text-anchor="middle" font-size="10.5" font-weight="${isF ? 700 : 500}" style="fill:#fff">${fr.id.toString(16).toUpperCase()}</text>`;
      }
      return g;
    };
    let gs = '';
    gs += lane(r.hi.trace, 10, `${f.code} at ${hex3(f.id)}`, f.id);
    gs += lane(r.lo.trace, 60, `Same frame at 0x7FF`, 0x7FF);
    gs += `<line x1="${gx(t0)}" y1="4" x2="${gx(t0)}" y2="104" stroke="${css('--ink')}" stroke-dasharray="4 3"/><text x="${gx(t0) + 4}" y="116" font-size="11" style="fill:${css('--ink-2')}">fault detected</text>`;
    for (let ms = 0; ms <= 2; ms += 0.5) gs += `<text x="${gx(t0 + ms / 1000)}" y="132" text-anchor="middle" font-size="10.5" style="fill:${css('--ink-3')}">+${ms} ms</text>`;
    const legendItems = [['Fault frame', SEV_COLOR[f.sev]], ['Corner nodes', '--s3'], ['EMU Black', '--s1'], ['Dash MCU', '--s7'], ['Heartbeats', '--ink-3']];
    let lx = 120;
    for (const [l, c] of legendItems) { gs += `<rect x="${lx}" y="140" width="10" height="10" rx="2" fill="${css(c)}"/><text x="${lx + 14}" y="149" font-size="11" style="fill:${css('--ink-2')}">${l}</text>`; lx += 30 + l.length * 6.2; }
    $('ganttSvg').setAttribute('viewBox', '0 0 900 156');
    $('ganttSvg').innerHTML = gs;
    $('ganttNote').textContent = `${R.can.info.name} at ${fmt(R.can.stats.load, 0)} % load · ${r.queue.length} frames queued when the fault fires`;
    kv('faultKv', [
      ['On the bus after', `${fmt(r.latencyMs, 3)} ms`, 'ok'], ['At lowest priority', `${fmt(r.latencyLoMs, 3)} ms`, r.latencyLoMs > r.latencyMs ? 'meh' : ''],
      ['Worst case at its ID', `${fmt(r.rta.wcrt, 2)} ms`], ['Worst case at 0x7FF', `${fmt(r.rtaLo.wcrt, 2)} ms`],
      ['Debounce', `${f.debounceMs} ms`], ['Fault to dash, worst', `${fmt(r.toDashMs, 0)} ms`], ['Repeat while active', `${band.repeatHz} Hz`]
    ]);

    // bitwise arbitration against the best competing data frame
    const rival = (r.queue.find(q => q.id !== f.id) || { id: 0x100, name: 'Corner FL fast' });
    const ar = S.arbitrate(f.id, rival.id);
    const cell = (v, b) => `<td class="num" style="${ar.decided && ar.decided.bit === b ? `background:${hexA(css('--accent'), 0.18)};font-weight:700` : ''}">${v}</td>`;
    $('arbTable').innerHTML = `<thead><tr><th>ID bit</th>${ar.bits.map(x => `<th class="num">${x.bit}</th>`).join('')}</tr></thead><tbody>` +
      `<tr><td>${f.code} ${hex3(f.id)}</td>${ar.bits.map(x => cell(x.a, x.bit)).join('')}</tr>` +
      `<tr><td>${rival.name} ${hex3(rival.id)}</td>${ar.bits.map(x => cell(x.b, x.bit)).join('')}</tr>` +
      `<tr><td>Bus level</td>${ar.bits.map(x => cell(x.bus, x.bit)).join('')}</tr></tbody>`;
    $('arbNote').textContent = ar.decided
      ? `Both start sending their IDs at the same time. At bit ${ar.decided.bit} ${ar.decided.winner === f.id ? f.code : rival.name} sends a dominant 0 while the other sends a recessive 1, reads back 0, and stops. ${ar.decided.winner === f.id ? 'The fault frame wins and nothing is lost: the other frame simply goes next.' : 'The data frame wins here because the fault sits in a low-priority band.'}`
      : 'Same ID: two nodes must never send the same ID.';

    $('frameTable').innerHTML = `<thead><tr><th>Byte</th><th>Content</th><th>Example</th></tr></thead><tbody>` + [
      ['0–1', 'Fault number (code)', `${f.code} → ${hex3(S.FAULTS.indexOf(f) + 1)}`],
      ['2', 'Source node', f.src.split(' ')[0] + ' ' + (f.src.split(' ')[1] || '')],
      ['3', 'Severity (bits 7–6), state (bits 1–0)', `${band.label}, active`],
      ['4', 'Occurrence count since power-up', '1'],
      ['5–6', 'Measured value × 100', `${fmt(f.scenario(3), 2)} ${f.unit}`],
      ['7', 'Rolling counter (detects stale frames)', '0–255']
    ].map(row => `<tr><td class="mono">${row[0]}</td><td>${row[1]}</td><td>${row[2]}</td></tr>`).join('') + '</tbody>';

    $('faultTable').innerHTML = `<thead><tr><th>Code</th><th>Fault</th><th>Severity</th><th>CAN ID</th><th>Detected by</th><th>Sets when</th><th class="num">Debounce</th><th class="num">Clear</th><th>Latch</th><th>Driver sees</th></tr></thead><tbody>` +
      S.FAULTS.map(x => `<tr data-code="${x.code}" aria-selected="${x.code === faultCode}"><td class="mono">${x.code}</td><td>${x.name}</td><td><span class="sev" style="--c:var(${SEV_COLOR[x.sev]})">${S.FAULT_BANDS[x.sev].label}</span></td><td class="mono">${hex3(x.id)}</td><td>${x.src}</td><td class="wrap">${x.cond}</td><td class="num">${x.debounceMs} ms</td><td class="num">${x.clearMs} ms</td><td>${x.latch ? 'Yes' : 'No'}</td><td>${S.FAULT_BANDS[x.sev].dash}</td></tr>`).join('') + '</tbody>';
  }
  $('faultTable').addEventListener('click', e => { const tr = e.target.closest('tr[data-code]'); if (tr) { faultCode = tr.dataset.code; renderFaults(); window.scrollTo({ top: 0, behavior: 'smooth' }); } });


  // ------------------------------------------------------------ components view
  const W = Object.assign({}, S.WHEEL_DEFAULTS);
  const W_UNITS = {
    teeth: v => `${v}`, ringMM: v => ln(+v, 1), gapMM: v => ln(+v, 3), rateHz: v => `${v} Hz`, needKmh: v => sp(+v, SPD === 'mph' ? 0 : 1),
    timeoutMs: v => `${v} ms`, pitchErrPct: v => `${(+v).toFixed(1)} %`, vrThreshMV: v => `${v} mV`, vrNoiseMV: v => `${v} mV`
  };
  const IR = Object.assign({}, S.IR_DEFAULTS), ST = Object.assign({}, S.STEER_DEFAULTS);
  const I_UNITS = {
    widthMM: v => ln(+v, 1), tempC: v => tp(+v), gradC: v => tdp(+v), bgC: v => tp(+v), emis: v => (+v).toFixed(2),
    fovDeg: v => `${v}°`, distMM: v => ln(+v, 1), offsetMM: v => ln(+v, 2), emisSet: v => (+v).toFixed(2),
    steerDeg: v => `${v}°`, aimFwdMM: v => ln(+v, 1)
  };
  const S_UNITS = {
    lockDeg: v => `±${v}°`, potDeg: v => `${v}°`, gear: v => (+v).toFixed(2), cFactorMM: v => ln(+v, 2), potMM: v => ln(+v, 2),
    linPct: v => `${(+v).toFixed(2)} %`, backlashDeg: v => `${(+v).toFixed(1)}°`, adcBits: v => `${v} bit`, noiseLsb: v => `${v} counts`, supplyPct: v => `${v} %`
  };
  const AR = Object.assign({}, S.IR_ARRAY_DEFAULTS);
  const A_UNITS = {
    pixels: v => `${v}`, hFovDeg: v => `${v}°`, vFovDeg: v => `${(+v).toFixed(1)}°`, widthMM: v => ln(+v, 1),
    tempC: v => tp(+v), gradC: v => tdp(+v), bgC: v => tp(+v),
    distMM: v => ln(+v, 1), xMM: v => ln(+v, 2), yMM: v => ln(+v, 2), zMM: v => ln(+v, 2), steerDeg: v => `${v}°`
  };
  const BK = Object.assign({}, S.BRAKE_DEFAULTS);
  const B_UNITS = {
    pedalPct: v => `${v} %`, freePct: v => `${v} %`, maxPedalN: v => frc(+v), pedalRatio: v => `${(+v).toFixed(1)} : 1`,
    biasTurns: v => `${+v > 0 ? '+' : ''}${(+v).toFixed(1)} turns`, pctPerTurn: v => `${(+v).toFixed(1)} % / turn`,
    lightOnPsi: v => pr(+v, 1), lightOffPsi: v => pr(+v, 1), hardPsi: v => pr(+v), tireMu: v => (+v).toFixed(2), cgHeightMM: v => ln(+v, 1)
  };
  const AR_DOFS = [['distMM', 'Distance'], ['xMM', 'X shift'], ['yMM', 'Y shift'], ['zMM', 'Z shift'], ['steerDeg', 'Front wheel steer']];
  function setTarget(t) { const d = S.IR_TARGETS[t]; IR.target = t; for (const k of ['widthMM', 'emis', 'tempC', 'gradC', 'bgC']) IR[k] = d[k]; IR.emisSet = d.emis; }
  setTarget(IR.target);
  let wTimer = null;
  const syncers = [];
  function bindGroup(prefix, obj, units, reset, view) {
    view = view || 'components';
    const els = [...document.querySelectorAll(`[id^="${prefix}_"]`)].filter(el => el.id.slice(2) in obj);
    els.forEach(el => { if (units[el.id.slice(2)]) FMT[el.id] = units[el.id.slice(2)]; });
    const sync = () => els.forEach(el => {
      const key = el.id.slice(2), out = $('o_' + el.id);
      if (el.type === 'checkbox') el.checked = !!obj[key]; else el.value = obj[key];
      if (out) out.textContent = units[key](el.value);
    });
    els.forEach(el => {
      const key = el.id.slice(2);
      el.addEventListener('input', () => {
        obj[key] = el.type === 'checkbox' ? el.checked : el.type === 'range' || typeof obj[key] === 'number' ? +el.value : el.value;
        if (prefix === 'i' && key === 'target') sync();
        const out = $('o_' + el.id); if (out) out.textContent = units[key] ? units[key](el.value) : '';
        clearTimeout(wTimer); wTimer = setTimeout(() => renderView(view), 120);
      });
    });
    $(prefix + '_reset').addEventListener('click', () => { reset(); sync(); renderView(view); });
    sync();
    syncers.push(sync);
    return sync;
  }
  function bindComponents() {
    bindGroup('w', W, W_UNITS, () => Object.assign(W, S.WHEEL_DEFAULTS));
    const syncIr = bindGroup('i', IR, I_UNITS, () => { Object.assign(IR, S.IR_DEFAULTS); setTarget(IR.target); });
    $('i_target').addEventListener('input', () => { setTarget($('i_target').value); syncIr(); });
    bindGroup('s', ST, S_UNITS, () => Object.assign(ST, S.STEER_DEFAULTS));
    bindGroup('b', BK, B_UNITS, () => Object.assign(BK, S.BRAKE_DEFAULTS));
    const presetOpts = () => { $('a_preset').innerHTML = Object.entries(S.IR_ARRAY_PRESETS).filter(([, p]) => p.kind === AR.kind).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join(''); $('a_preset').value = AR.preset; };
    presetOpts();
    $('a_profile').innerHTML = Object.entries(S.IR_ARRAY_PROFILES).map(([k, t]) => `<option value="${k}">${t}</option>`).join('');
    const syncAr = bindGroup('a', AR, A_UNITS, () => Object.assign(AR, S.IR_ARRAY_DEFAULTS));
    // Single IR uses the original IR screen (target, field of view, top view while steering);
    // the array uses the 3D mount view. One "Sensor type" select on each switches between them.
    const setKind = k => {
      irKind = k; AR.kind = 'array';
      try { localStorage.setItem('br27.irKind', k); } catch (e) { /* storage blocked */ }
      $('a_kind').value = 'array'; $('i_kind').value = 'single';
      renderView('components');
    };
    $('a_kind').addEventListener('input', () => setKind($('a_kind').value));
    $('i_kind').addEventListener('input', () => setKind($('i_kind').value));
    AR.kind = 'array'; $('a_kind').value = 'array'; $('i_kind').value = 'single'; presetOpts();
    $('a_reset').addEventListener('click', presetOpts);
    $('a_preset').addEventListener('input', () => { const p = S.IR_ARRAY_PRESETS[AR.preset]; if (AR.preset !== 'custom') Object.assign(AR, { pixels: p.pixels, hFovDeg: p.hFovDeg, vFovDeg: p.vFovDeg }); syncAr(); });
    $('arDof').innerHTML = AR_DOFS.map(([k, t]) => `<option value="${k}">${t}</option>`).join('');
    $('arDof').addEventListener('input', () => { if (arLast) drawArSweep(arLast); });
    document.querySelectorAll('#compTabs button').forEach(b => b.addEventListener('click', () => {
      compSel = b.dataset.comp;
      try { localStorage.setItem('br27.component', compSel); } catch (e) { /* storage blocked */ }
      renderView('components');
    }));
  }
  let compSel = 'wheel';
  try { compSel = localStorage.getItem('br27.component') || 'wheel'; } catch (e) { /* storage blocked */ }
  let irKind = 'array';
  try { irKind = localStorage.getItem('br27.irKind') || 'array'; } catch (e) { /* storage blocked */ }
  if (compSel === 'ir') { compSel = 'irarray'; irKind = 'single'; }   // single IR lives in the tire temperature tab
  function renderComponents() {
    const c = ({ wheel: 1, irarray: 1, steer: 1, brake: 1 })[compSel] ? compSel : 'wheel';
    document.querySelectorAll('#compTabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.comp === c));
    const grp = c === 'irarray' && irKind === 'single' ? 'ir' : c;
    document.querySelectorAll('#v-components .cgroup').forEach(g => { g.hidden = g.dataset.comp !== grp; });
    if (ring && c !== 'wheel') ring.stop();
    if (brk && c !== 'brake') brk.stop();
    ({ wheel: renderWheel, ir: renderIr, irarray: renderIrArray, steer: renderSteer, brake: renderBrake })[grp]();
  }
  const kmhTxt = v => (v == null || !isFinite(v) ? 'never' : sp(v, 1));
  // tone ring animation (geometry only)
  let ring = null, ringPlay = true, ringKmh = 48.28;
  function renderRing(r) {
    const w = r.w;
    if (!ring && window.BRRing) {
      ring = window.BRRing.mount($('ringSvg'), { len: (mm, d) => ln(mm, d), imp: IMP });
      $('rSpeed').addEventListener('input', () => { ringKmh = IMP() ? +$('rSpeed').value * 1.609344 : +$('rSpeed').value; renderRing(S.simulateWheelSpeed(params, W, R.lap)); });
      $('rSlow').addEventListener('input', () => renderRing(S.simulateWheelSpeed(params, W, R.lap)));
      $('rPlay').addEventListener('click', () => { ringPlay = !ringPlay; $('rPlay').textContent = ringPlay ? 'Pause' : 'Play'; ringGo(); });
    }
    if (!ring) return;
    $('rSpeed').max = IMP() ? 100 : 160;
    $('rSpeed').value = Math.round(IMP() ? ringKmh / 1.609344 : ringKmh);
    $('o_rSpeed').textContent = sp(ringKmh, 0);
    const n = ring.set({ teeth: w.teeth, ringMM: w.ringMM, gapMM: w.gapMM, sensor: w.sensor, tireD: r.tireD, kmh: ringKmh, slow: +$('rSlow').value, units: UNITSYS });
    $('rConv').innerHTML = '<thead><tr><th>Step</th><th>What the node does</th><th class="num">Now</th></tr></thead><tbody>' +
      n.rows.map(([k, t, v]) => `<tr><td>${k}</td><td>${t}</td><td class="num">${v}</td></tr>`).join('') + '</tbody>';
    const ringSurf = IMP() ? `${fmt(n.ringSurf * 2.23694, 1)} mph` : `${fmt(n.ringSurf * 3.6, 1)} km/h`;
    kv('rKv', [['Wheel', `${fmt(n.rpm, 0)} rpm`], ['Teeth pass at', `${fmt(n.rpm * w.teeth / 60, 0)} Hz`], ['Tooth tips move at', ringSurf], ['Tire', n.tireTxt]]);
    $('rFoot').textContent = `Car speed comes from the wheel rpm and the tire size, not the ring: the ring and the tire turn together, so the ring size only sets how big each tooth is and how fast the teeth sweep past the sensor (${ringSurf} here). One tooth every ${fmt(360 / w.teeth, 1)}° of wheel rotation.`;
    $('rNote').textContent = `${w.teeth} teeth · ${ln(w.ringMM, 1)} ring · ${w.sensor === 'hall' ? 'Hall' : 'VR'}`;
    ringGo();
  }
  // Run the ring only while it is on screen and the page is not scrolling: repainting it during
  // a touch scroll made the page bounce on the iPad.
  let ringVisible = true, ringScrolling = false, ringScrollT = null;
  function ringGo() {
    if (!ring) return;
    if (ringPlay && ringVisible && !ringScrolling && compSel === 'wheel' && currentView === 'components') ring.start(); else ring.stop();
  }
  if (window.IntersectionObserver) new IntersectionObserver(es => { ringVisible = es[0].isIntersecting; ringGo(); }).observe($('ringSvg'));
  window.addEventListener('scroll', () => {
    if (!ringScrolling) { ringScrolling = true; ringGo(); }
    clearTimeout(ringScrollT);
    ringScrollT = setTimeout(() => { ringScrolling = false; ringGo(); }, 250);
  }, { passive: true });
  function renderWheel() {
    const r = S.simulateWheelSpeed(params, W, R.lap), w = r.w;
    try { renderRing(r); } catch (e) { console.error(e); }
    const pick = w.sensor === 'hall' ? 'Hall effect' : 'VR';
    $('wsNote').textContent = `${w.teeth} teeth · ${ln(r.toothMM, 2)} wide · ${ln(r.tireD * 1000, 1)} tire`;
    const row = (k, h, v, hb, vb) => `<tr><td>${k}</td><td class="${hb || ''}">${h}</td><td class="${vb || ''}">${v}</td></tr>`;
    const hallDead = !!r.hallProblem;
    $('wsCompare').innerHTML = `<thead><tr><th></th><th>Hall effect</th><th>VR</th></tr></thead><tbody>` +
      row('Reads down to', hallDead ? 'does not read' : kmhTxt(r.minHall), kmhTxt(r.minVr), hallDead || r.minHall > w.needKmh ? 'bad' : 'ok', r.minVr > w.needKmh ? 'bad' : 'ok') +
      row('Signal', hallDead ? r.hallProblem : '0–5 V square wave at any speed', `${fmt(r.vrMvAt5, 0)} mV at ${sp(5, 0)}, ${fmt(r.vrMvTop / 1000, 2)} V at ${sp(r.topKmh, 0)} (needs ${fmt(r.detectMv, 0)} mV)`) +
      row('Wires', '3: 5 V, ground, signal', '2, twisted and shielded') +
      row('Power', `about ${w.hallMA} mA from the node's 5 V`, 'none') +
      row('Extra parts on the node', 'pull-up resistor', 'VR conditioning chip (MAX9926 class) or the input clamps') +
      row('Air gap it tolerates', `up to about ${ln(w.hallMaxGapMM, 3)}`, 'larger, but signal drops fast with gap') +
      row('Tooth width it needs', `at least ${ln(w.hallMinToothMM, 2)}`, `about the ${ln(w.vrPoleMM, 2)} pole size (${fmt(r.vrGeo * 100, 0)} % signal now)`) +
      '</tbody>';
    const f = [];
    if (hallDead) f.push(['crit', `A Hall sensor can't read this ring: ${r.hallProblem}.`]);
    if (r.minVr > w.needKmh) f.push([w.sensor === 'vr' ? 'crit' : 'warn', `VR: the car reads 0 below ${kmhTxt(r.minVr)}, so launch, pit lane and a stopped wheel locking under braking are lost. The best tooth count for VR here is ${r.bestVr.teeth} (${kmhTxt(r.bestVr.kmh)}). A smaller gap or a quieter harness helps more than teeth.`]);
    if (w.method === 'count') f.push(['crit', `Counting teeth per ${fmt(1000 / w.rateHz, 0)} ms CAN sample gives steps of ${sp(r.resCount, 1)}. Time the period between teeth instead: the node's timer capture gives ${sp(r.resPeriod20, 3)} steps at ${sp(20, 0)}.`]);
    if (r.fullRateKmh > r.cornerMinKmh) f.push(['warn', `Below ${kmhTxt(r.fullRateKmh)} fewer than one tooth passes per CAN sample, so the value updates slower than ${w.rateHz} Hz. The slowest corner on the test lap is ${kmhTxt(r.cornerMinKmh)}. More teeth fix this.`]);
    if (r.rec) f.push(['good', `For a ${pick} sensor, ${r.rec.lo} to ${r.rec.hi} teeth on a ${ln(w.ringMM, 1)} ring read down to ${sp(w.needKmh, 0)} and update at the full CAN rate through every corner. Pick the low end for wider, sturdier teeth that tolerate more gap.`]);
    else f.push(['warn', `No tooth count on a ${ln(w.ringMM, 1)} ring meets both goals for a ${pick} sensor. Change the ring size, the gap, or the sensor.`]);
    flags('wsFlags', f);

    const ro = r.rollout;
    C.legend('wsRollLegend', [['True speed', '--ink-3', true], ['Hall effect', '--s1'], ['VR', '--s2']]);
    C.draw('c_wsRoll', [
      { label: 'True', data: xy(ro.truthT, ro.truthV.map(spv)), color: '--ink-3', width: 1.5, dash: [5, 4] },
      { label: 'Hall', data: xy(ro.hall.t, ro.hall.v.map(spv)), color: '--s1', stepped: true, width: 1.75 },
      { label: 'VR', data: xy(ro.vr.t, ro.vr.v.map(spv)), color: '--s2', stepped: true, width: 1.75 }
    ], { xTitle: 'Time (s)', yTitle: SU(), xMin: 0, xMax: ro.truthT[ro.truthT.length - 1], yMin: 0, refs: [{ y: spv(w.needKmh), label: `must read ${sp(w.needKmh, 0)}` }] });

    const T = r.byTeeth, at = { vrefs: [{ x: w.teeth, label: `${w.teeth} teeth` }], xTitle: 'Teeth on the ring' };
    $('wsTeethNote').textContent = r.rec ? `${pick}: ${r.rec.lo} to ${r.rec.hi} teeth meet both goals` : `${pick}: no tooth count meets both goals`;
    kv('wsTeethKv', [
      ['Reads down to', w.sensor === 'hall' ? (hallDead ? 'does not read' : kmhTxt(r.minHall)) : kmhTxt(r.minVr), (w.sensor === 'hall' ? hallDead || r.minHall > w.needKmh : r.minVr > w.needKmh) ? 'bad' : 'ok'],
      ['Full-rate updates above', kmhTxt(r.fullRateKmh), r.fullRateKmh > r.cornerMinKmh ? 'meh' : 'ok'],
      ['Tooth width', ln(r.toothMM, 2), w.sensor === 'hall' && r.toothMM < w.hallMinToothMM ? 'bad' : ''],
      ['Tooth rate at top speed', `${fmt(r.hzTop, 0)} Hz`],
      [`Noise at ${sp(20, 0)}`, `±${sp(r.noise20, 2)}`], ['Noise at top speed', `±${sp(r.noiseTop, 2)}`]
    ]);
    const lim = v => spv(isFinite(v) ? Math.min(v, 60) : 60);
    C.draw('c_wsMin', [
      { label: 'Hall', data: T.map(t => ({ x: t.teeth, y: t.hallOk ? lim(t.minHall) : null })), color: '--s1' },
      { label: 'VR', data: T.map(t => ({ x: t.teeth, y: lim(t.minVr) })), color: '--s2' }
    ], Object.assign({ yMin: 0, refs: [{ y: spv(w.needKmh), label: 'must read' }] }, at));
    C.draw('c_wsFull', [{ label: SU(), data: T.map(t => ({ x: t.teeth, y: spv(Math.min(t.fullRateKmh, 150)) })), color: '--s3' }],
      Object.assign({ yMin: 0, refs: [{ y: spv(r.cornerMinKmh), label: 'slowest corner' }] }, at));
    C.draw('c_wsTooth', [{ label: LU(), data: T.map(t => ({ x: t.teeth, y: lnv(t.toothMM) })), color: '--s5' }],
      Object.assign({ yMin: 0, ySugMax: 20, yMax: Math.max(20, r.toothMM * 1.2), refs: [{ y: w.hallMinToothMM, label: 'Hall minimum' }, { y: w.vrPoleMM, label: 'VR pole' }] }, at));
    C.draw('c_wsHz', [{ label: 'Hz', data: T.map(t => ({ x: t.teeth, y: t.hzTop })), color: '--s7' }], Object.assign({ yMin: 0 }, at));

    const sw = r.sweep;
    C.draw('c_wsVr', [{ label: 'VR mV', data: sw.map(s => ({ x: spv(s.kmh), y: Math.min(s.vrMv, 1500) })), color: '--s2' }],
      { xTitle: `Speed (${SU()})`, yMin: 0, refs: [{ y: w.vrThreshMV }, { y: r.detectMv, label: `threshold + noise ${fmt(r.detectMv, 0)} mV` }] });
    C.draw('c_wsNoise', [{ label: 'noise', data: sw.filter(s => s.noise != null && s.kmh >= 4).map(s => ({ x: spv(s.kmh), y: spv(s.noise) })), color: '--s1' }],
      { xTitle: `Speed (${SU()})`, yMin: 0 });
    $('wsNoiseFoot').textContent = `With ±${fmt(w.pitchErrPct, 1)} % uneven tooth spacing, timing the period between teeth. More teeth per CAN sample average it out. Timer resolution adds only ${sp(r.resPeriod20, 3)} at ${sp(20, 0)}.`;
  }
  function renderIr() {
    const r = S.simulateIr(IR), o = r.o;
    $('i_targetNote').textContent = r.target.note;
    $('irNote').textContent = `${o.fovDeg}° field of view at ${ln(o.distMM, 1)} · spot ${ln(r.spotMM, 1)}`;
    // top view of the target with each sensor's spot
    const span = Math.max(o.widthMM * 1.5, ...r.spots.map(p => Math.abs(p.centre) * 2 + r.spotMM * 1.15));
    const k = Math.min(820 / span, 225 / r.spotMM), cx = 450, cy = 120, H = 170;
    const X = mm => cx + mm * k;
    const ink2 = 'var(--ink-2)';
    let g = `<defs><linearGradient id="irGrad" x1="0" x2="1"><stop offset="0" stop-color="var(--s2)" stop-opacity="${o.gradC ? 0.75 : 0.5}"/><stop offset="1" stop-color="var(--s2)" stop-opacity="0.35"/></linearGradient></defs>`;
    g += `<rect x="0" y="${cy - H / 2}" width="900" height="${H}" fill="var(--bg)"/>`;
    g += `<rect x="${X(-o.widthMM / 2)}" y="${cy - H / 2}" width="${o.widthMM * k}" height="${H}" fill="url(#irGrad)" stroke="var(--s2)"/>`;
    g += `<text x="${X(-o.widthMM / 2) + 6}" y="${cy - H / 2 + 16}" font-size="12" fill="${ink2}">${o.target === 'tire' ? 'inner edge' : 'inner'}</text>`;
    g += `<text x="${X(o.widthMM / 2) - 6}" y="${cy - H / 2 + 16}" font-size="12" text-anchor="end" fill="${ink2}">${o.target === 'tire' ? 'outer edge' : 'outer'}</text>`;
    g += `<text x="12" y="${cy - H / 2 + 16}" font-size="12" fill="${ink2}">background ${tp(o.bgC)}</text>`;
    r.spots.forEach((p, n) => {
      const bad = p.fill < 0.98;
      g += `<circle cx="${X(p.centre)}" cy="${cy}" r="${(r.spotMM / 2) * k}" fill="var(--panel)" fill-opacity="0.25" stroke="${bad ? 'var(--crit-ink)' : 'var(--s1)'}" stroke-width="2" ${n ? '' : ''}/>`;
      g += `<circle cx="${X(p.centre)}" cy="${cy}" r="3" fill="var(--ink)"/>`;
      const lx = cx + (n - (r.spots.length - 1) / 2) * 280, ly = cy + H / 2 + 62;
      g += `<line x1="${X(p.centre)}" y1="${cy}" x2="${lx}" y2="${ly - 16}" stroke="var(--ink-3)" stroke-dasharray="3 3"/>`;
      g += `<text x="${lx}" y="${ly}" font-size="14" text-anchor="middle" fill="var(--ink)" font-family="var(--f-mono)">${r.spots.length > 1 ? ['inner', 'middle', 'outer'][n] + ' ' : ''}${tp(p.meas, 1)}</text>`;
      g += `<text x="${lx}" y="${ly + 16}" font-size="11.5" text-anchor="middle" fill="var(--ink-2)">true ${tp(p.true, 1)} · ${fmt(p.fill * 100, 0)} % on target</text>`;
    });
    g += `<line x1="${X(-o.widthMM / 2)}" x2="${X(o.widthMM / 2)}" y1="${cy + H / 2 + 12}" y2="${cy + H / 2 + 12}" stroke="${ink2}"/><text x="${X(o.widthMM / 2) + 6}" y="${cy + H / 2 + 16}" font-size="12" fill="${ink2}">${ln(o.widthMM, 1)} ${o.target === 'tire' ? 'tread' : 'friction band'}</text>`;
    $('irSvg').innerHTML = g;
    const worst = r.spots.reduce((a, p) => Math.max(a, Math.abs(p.meas - p.true)), 0);
    kv('irKv', [
      ['Spot diameter', ln(r.spotMM, 1), r.spotMM > r.zoneMM ? 'bad' : 'ok'],
      ['Width per sensor', ln(r.zoneMM, 1)],
      ['Farthest distance that fits', ln(r.fitDistMM, 1)],
      ['Worst reading error', tdp(worst, 1), worst > 5 ? 'bad' : worst > 2 ? 'meh' : 'ok']
    ]);
    const f = [];
    if (r.spotMM > r.zoneMM) f.push(['crit', `The ${ln(r.spotMM, 1)} spot is wider than the ${ln(r.zoneMM, 1)} each sensor should cover, so it reads part ${r.spots.length > 1 ? 'of the next zone or ' : ''}the background. Move it within ${ln(r.fitDistMM, 1)} or use a narrower field of view.`]);
    if (Math.abs(o.emisSet - o.emis) > 0.02) f.push(['warn', `The sensor is set to emissivity ${o.emisSet.toFixed(2)} but the target is ${o.emis.toFixed(2)}, so even a perfect aim reads wrong. ${o.target === 'rotor' ? 'Bare rotors change emissivity as they wear and blue; a strip of high-temperature paint on the band gives a known value.' : ''}`]);
    if (r.spots.length === 1 && o.gradC > 5) f.push(['warn', `One sensor gives one average. The ${tdp(o.gradC)} inner to outer difference that shows camber needs three sensors (or a multi-zone sensor).`]);
    if (o.mount === 'chassis' && o.target === 'tire' && r.loseDeg < 25) f.push(['warn', `On the chassis, the spot runs off the tread past about ${fmt(r.loseDeg, 0)}° of front wheel steer, so hairpin readings (about 25°) mix in the track. Mount it on the upright, or aim it nearer the top of the tire.`]);
    if (r.fitDistMM < 30) f.push(['warn', `It has to sit within ${ln(r.fitDistMM, 1)}, very close to the ${o.target === 'tire' ? 'tire (stones, tire growth at speed)' : 'rotor (heat)'}. A narrower field of view lets it sit farther back.`]);
    if (!f.length) f.push(['good', `Each spot stays on its target with ${ln(r.fitDistMM - o.distMM, 1)} of distance to spare, and the readings are within ${tdp(worst, 1)}.`]);
    flags('irFlags', f);
    const cols = { 5: '--s1', 10: '--s3', 35: '--s2', 90: '--s7' };
    const fovs = r.fovs, col = fv => cols[fv] || '--s5';
    C.legend('irDistLegend', fovs.map(fv => [`${fv}°`, col(fv)]));
    const atD = { xTitle: `Distance (${LU()})`, vrefs: [{ x: lnv(o.distMM), label: 'now' }] };
    C.draw('c_irDist', fovs.map(fv => ({ label: `${fv}°`, data: r.byDist[fv].map(p => ({ x: lnv(p.d), y: tv(p.meas) })), color: col(fv), width: fv === o.fovDeg ? 3 : 1.5 })),
      Object.assign({ refs: [{ y: tv(r.spots[Math.floor(r.spots.length / 2)].true), label: 'true' }] }, atD));
    C.draw('c_irSpot', fovs.map(fv => ({ label: `${fv}°`, data: r.byDist[fv].map(p => ({ x: lnv(p.d), y: lnv(p.spot) })), color: col(fv), width: fv === o.fovDeg ? 3 : 1.5 })),
      Object.assign({ yMin: 0, yMax: lnv(Math.max(r.zoneMM * 2.5, 60)), refs: [{ y: lnv(r.zoneMM), label: 'width per sensor' }] }, atD));
    irLast = { r };
    if (!irAnim) drawIrTop(o, r, o.steerDeg);
    C.legend('irSteerLegend', [['On the chassis', '--s2'], ['On the upright', '--s1'], ['True (middle)', '--ink-3', true]]);
    C.draw('c_irSteer', [
      { label: 'Chassis', data: r.bySteer.map(p => ({ x: p.deg, y: tv(p.chassis) })), color: '--s2', width: o.mount === 'chassis' ? 3 : 1.5 },
      { label: 'Upright', data: r.bySteer.map(p => ({ x: p.deg, y: tv(p.upright) })), color: '--s1', width: o.mount === 'upright' ? 3 : 1.5 }
    ], { xTitle: 'Front wheel steer (°, + = spot moves outward)', vrefs: [{ x: o.steerDeg, label: 'now' }], refs: [{ y: tv(r.spots[Math.floor(r.spots.length / 2)].true), label: 'true' }] });
    $('irSteerFoot').textContent = o.mount === 'chassis'
      ? `A chassis-mounted sensor aimed ${ln(o.aimFwdMM, 1)} ahead of the steering axis sees the tread slide ${ln(r.steerShiftMM, 1)} sideways at ${o.steerDeg}° of steer${r.loseDeg < 30 ? `, and its spot starts to run off the tread past about ${fmt(r.loseDeg, 0)}°` : ''}. Aiming at the top of the tire (close to the steering axis) or mounting on the upright fixes it.`
      : 'Mounted on the upright, the sensor turns with the wheel, so steering does not move its aim. Only camber and tire deflection do.';
    C.draw('c_irOff', [{ label: TU(), data: r.byOff.map(p => ({ x: lnv(p.off), y: tv(p.meas) })), color: '--s2' }],
      { xTitle: `Aim off centre (${LU()})`, vrefs: [{ x: lnv(o.offsetMM), label: 'now' }] });
  }

  // ------------------------------------------------------------ IR array on the tire
  let arLast = null;
  const heatCss = (t, lo, hi) => { const u = Math.max(0, Math.min(1, (t - lo) / ((hi - lo) || 1))); return `hsl(${Math.round(240 * (1 - u))} 85% 50%)`; };
  const AR_DOF_TEXT = {
    distMM: 'Moving the sensor away widens its footprint on the tread. For an array: too close and the end pixels miss the edges, too far and they see the track and air beside the tire.',
    xMM: 'An X shift (forward or back) moves the sensor along the car. In front of the tire it changes the distance; above or beside the tire it moves where the view lands around the tread.',
    yMM: 'A Y shift (sideways) slides the view across the tread. Pixels at one end fall off the edge and read the background, and the inner to outer difference you read is no longer edge to edge.',
    zMM: 'A Z shift (up or down) moves where the view lands around the tire. The tread curves away from the sensor, so the footprint grows and the outer pixels start to graze the sidewall or miss the tire.',
    steerDeg: 'With the sensor on the chassis the front tire turns under it, so the row slides across the tread and the far edge pixels read the track. On the upright the sensor turns with the tire and the data does not change.'
  };
  function renderIrArray() {
    const r = S.simulateIrArray(AR), o = r.o, single = o.kind === 'single';
    arLast = r;
    $('a_presetNote').textContent = r.preset.note;
    $('a_positionNote').textContent = ({ front: 'Looks straight back at the front of the tread', above: 'Looks straight down at the top of the tread', beside: 'Sits inboard and ahead, looking 45° outward and back at the front of the tread [assumption]' })[o.position];
    $('arCoverTitle').textContent = single ? 'Share of the spot on the tread (%)' : 'Share of the tread width the array sees (%)';
    document.querySelectorAll('[data-custom]').forEach(el => { el.hidden = o.preset !== 'custom'; });
    $('arNote').textContent = single ? `one ${o.hFovDeg}° spot · ${ln(o.distMM, 1)} from the tread · ${ln(r.spotMM, 1)} spot` : `${o.pixels} pixels across ${o.hFovDeg}° · ${ln(o.distMM, 1)} from the tread`;
    drawArLook(r, o);
    drawArTop(r, o);
    drawArRow(r, o);
    $('arZoneCard').hidden = single;
    if (!single) { drawArZones(r); drawArZoneChart(r); }
    const lo = Math.min(o.bgC, ...r.truth.map(p => p.T)), hi = Math.max(...r.truth.map(p => p.T));
    $('arStrip').innerHTML = r.pixels.map(p => `<i style="background:${heatCss(p.meas, lo, hi)}" title="pixel ${p.i + 1}: ${tp(p.meas, 1)}"></i>`).join('');
    $('arStripScale').textContent = `blue ${tp(lo)} · red ${tp(hi)}`;
    C.legend('arLegend', [['Array reading', '--s2'], ['True tread at that pixel', '--ink-3', true]]);
    const truthAt = p => (p.yMM == null ? null : tv(r.truth[Math.round((p.yMM / 1000 + r.halfW) / (2 * r.halfW) * (r.truth.length - 1))].T));
    C.draw('c_arRead', [
      { label: 'Reading', data: r.pixels.map(p => ({ x: p.i + 1, y: tv(p.meas) })), color: '--s2', points: true, width: 2 },
      { label: 'True', data: r.pixels.map(p => ({ x: p.i + 1, y: p.treadFrac > 0.5 ? truthAt(p) : null })), color: '--ink-3', dash: [5, 4], width: 1.5 }
    ], { xTitle: 'Pixel (1 = inner edge side)', yTitle: TU(), xMin: 0.5, xMax: o.pixels + 0.5 });
    if (single) {
      const p0 = r.pixels[0], err = p0.meas - r.trueAvg;
      fillArKv(r, o, single);
      const f = [];
      if (p0.treadFrac < 0.98) f.push(['crit', `Only ${fmt(p0.treadFrac * 100, 0)} % of the spot lands on the tread; the rest sees ${p0.hit === 'tread' ? 'the sidewall, track or air' : 'the track, air or sidewall'}, so it reads ${tdp(Math.abs(err), 1)} ${err < 0 ? 'low' : 'high'}. Move it closer, use a narrower field of view, or fix the aim.`]);
      if (o.gradC > 4) f.push(['warn', `One spot gives one average. The ${tdp(o.gradC)} difference across the tread (camber or pressure) needs an array, or three single sensors.`]);
      if (o.mount === 'chassis' && Math.abs(o.steerDeg) > 5) f.push(['info', `On the chassis, the tire has turned ${o.steerDeg}° under the sensor; on the upright it would turn with the tire.`]);
      if (!f.length) f.push(['good', `The spot sits fully on the tread and reads within ${tdp(Math.abs(err), 1)} of the tread average.`]);
      flags('arFlags', f);
      drawArSweep(r);
      return;
    }
    fillArKv(r, o, single);
    const f = [];
    if (r.coverPct < 95 && r.needXMM && o.distMM < r.needXMM && Math.abs(o.rollDeg) < 10 && Math.abs(o.yawDeg) < 5 && Math.abs(o.steerDeg) < 5) f.push(['warn', `The row covers only ${fmt(r.coverPct, 0)} % of the tread. At this field of view it needs about ${ln(r.needXMM, 1)} of distance to reach both edges.`]);
    else if (r.coverPct < 95) f.push(['warn', `The array sees only ${fmt(r.coverPct, 0)} % of the tread width, so one edge is missing from the data.`]);
    const off = o.pixels - r.onTread - r.mixed;
    if (off > 0) f.push([off > o.pixels / 4 ? 'crit' : 'info', `${off} pixel${off > 1 ? 's' : ''} read the track, air or sidewall instead of the tread, and ${r.mixed} more see part of each. Drop those pixels in the logger (use only pixels that read near the tread) or move the sensor so the row fits the tread with a little margin.`]);
    if (o.mount === 'chassis' && Math.abs(o.steerDeg) > 5) f.push(['info', `On the chassis, the tire has turned ${o.steerDeg}° under the sensor; on the upright it would turn with the tire and the data would not change.`]);
    if (!f.some(x => x[0] === 'warn' || x[0] === 'crit')) f.push(['good', `The row spans ${fmt(r.coverPct, 0)} % of the tread with ${r.onTread} clean pixels about ${ln(r.mmPerPx, 2)} apart, enough to see camber and pressure in the profile.`]);
    flags('arFlags', f);
    drawArSweep(r);
  }
  // inner / centre / outer zone averages: the fixed pixel map against the one looked up from the steering angle
  const ZCOL = ['--s1', '--s3', '--s2'], ZNAME = ['INNER', 'CENTRE', 'OUTER'];
  function drawArZones(r) {
    const o = r.o, mode = $('arZoneMode').value, z = r.zones, tru = r.zoneTrue;
    const rows = mode === 'both' ? [['fixed', 'Fixed map'], ['steer', 'Steering corrected']] : mode === 'fixed' ? [['fixed', 'Fixed map']] : [['steer', 'Steering corrected']];
    const lo = Math.min(o.bgC, ...r.truth.map(p => p.T)), hi = Math.max(...r.truth.map(p => p.T));
    const x0 = 150, W = 730, n = o.pixels, pw = W / n;
    const H = 34 + rows.length * 24 + rows.length * 86;
    let g = '';
    rows.forEach(([m, lab], k) => {
      const y = 22 + k * 24, map = m === 'fixed' ? z.fixedMap : z.steerMap;
      g += `<text x="10" y="${y + 13}" font-size="12" fill="var(--ink-2)">${lab}: pixels</text>`;
      map.forEach((q, i) => { g += `<rect x="${(x0 + i * pw + 1).toFixed(1)}" y="${y}" width="${Math.max(1, pw - 2).toFixed(1)}" height="16" rx="2" fill="${q == null ? 'var(--rule)' : `var(${ZCOL[q]})`}"/>`; });
    });
    rows.forEach(([m, lab], k) => {
      const y = 34 + rows.length * 24 + k * 86, vals = z[m], cnt = z[m + 'N'];
      g += `<text x="10" y="${y + 32}" font-size="13" font-weight="600" fill="var(--ink)">${lab}</text>`;
      g += `<text x="10" y="${y + 50}" font-size="11" fill="var(--ink-3)">${m === 'fixed' ? 'set with wheels straight' : `map for ${Math.round(o.steerDeg)}° steer`}</text>`;
      for (let q = 0; q < 3; q++) {
        const bx = x0 + q * (W / 3), v = vals[q], err = v == null ? null : v - tru[q];
        const bad = err == null || Math.abs(err) > 5, meh = !bad && Math.abs(err) > 2;
        g += `<rect x="${bx + 3}" y="${y}" width="${W / 3 - 6}" height="76" rx="6" fill="${v == null ? 'var(--bg)' : heatCss(v, lo, hi)}" fill-opacity="0.85" stroke="${bad ? 'var(--crit)' : `var(${ZCOL[q]})`}" stroke-width="${bad ? 3 : 2}"/>`;
        g += `<text x="${bx + 14}" y="${y + 18}" font-size="11.5" font-weight="700" fill="#111" letter-spacing="1">${ZNAME[q]} · ${cnt[q]} px</text>`;
        g += `<text x="${bx + W / 6}" y="${y + 47}" font-size="24" font-weight="700" text-anchor="middle" fill="#111" font-family="var(--f-mono)">${v == null ? 'no data' : tp(v, 1)}</text>`;
        g += `<text x="${bx + W / 6}" y="${y + 67}" font-size="11.5" text-anchor="middle" fill="#111" font-family="var(--f-mono)">true ${tp(tru[q], 1)}${err == null ? '' : ` · ${err >= 0 ? '+' : '−'}${tdp(Math.abs(err), 1)}`}</text>`;
      }
    });
    g = `<text x="${x0}" y="12" font-size="11" fill="var(--ink-3)">inner edge</text><text x="${x0 + W}" y="12" font-size="11" text-anchor="end" fill="var(--ink-3)">outer edge · steer ${o.steerDeg >= 0 ? '+' : ''}${Math.round(o.steerDeg)}°</text>` + g;
    const svg = $('arZoneSvg');
    if (svg.getAttribute('viewBox') !== `0 0 900 ${H}`) svg.setAttribute('viewBox', `0 0 900 ${H}`);
    svg.innerHTML = g;
  }
  function drawArZoneChart(r) {
    const mode = $('arZoneMode').value, sw = r.zoneSweep, tru = r.zoneTrue;
    const ms = mode === 'both' ? ['steer', 'fixed'] : [mode];
    const ds = [], leg = [];
    for (let q = 0; q < 3; q++) {
      ms.forEach(m => ds.push({ label: `${ZNAME[q].toLowerCase()} ${m === 'fixed' ? 'fixed' : 'corrected'}`, data: sw.map(p => ({ x: p.deg, y: p[m][q] == null ? null : tv(p[m][q]) })), color: ZCOL[q], width: m === 'steer' ? 2.5 : 1.5, dash: m === 'fixed' && mode === 'both' ? [6, 3] : undefined }));
      ds.push({ label: `${ZNAME[q].toLowerCase()} true`, data: [{ x: -25, y: tv(tru[q]) }, { x: 25, y: tv(tru[q]) }], color: ZCOL[q], width: 1, dash: [2, 3] });
      leg.push([ZNAME[q].toLowerCase(), ZCOL[q]]);
    }
    if (mode === 'both') leg.push(['corrected (solid)', '--ink'], ['fixed map', '--ink', true]);
    leg.push(['true (dotted)', '--ink-3', true]);
    C.legend('arZoneLegend', leg);
    C.draw('c_arZone', ds, { xTitle: 'Front wheel steer (°)', yTitle: TU(), xMin: -25, xMax: 25, vrefs: [{ x: r.o.steerDeg, label: 'now' }] });
    const worst = m => { let e = 0, at = 0; sw.forEach(p => p[m].forEach((v, q) => { if (v != null && Math.abs(v - tru[q]) > e) { e = Math.abs(v - tru[q]); at = p.deg; } })); return [e, at]; };
    const lost = sw.filter(p => p.steer.some(v => v == null)).map(p => Math.abs(p.deg));
    const [ef, af] = worst('fixed'), [es] = worst('steer');
    $('arZoneFoot').textContent = r.o.mount === 'upright'
      ? `On the upright the sensor turns with the tire, so both maps are the same and steering changes nothing (worst zone error ${tdp(ef, 1)}).`
      : `On the chassis, the fixed map is off by up to ${tdp(ef, 1)} (at ${af > 0 ? '+' : ''}${af}°) because the tire turns under the row. Using the steering angle keeps every zone within ${tdp(es, 1)}${lost.length ? `, until a zone has no pixels left on the tread past ±${Math.min(...lost)}°` : ' across ±25°'}.`;
  }
  $('arZoneMode').addEventListener('input', () => { if (arLast) { drawArZones(arAnim && arFrames ? arFrame(AR.steerDeg) : arLast); drawArZoneChart(arLast); } });
  function fillArKv(r, o, single) {
    if (single) {
      const p0 = r.pixels[0], err = p0.meas - r.trueAvg;
        kv('arKv', [
          ['Reading', tp(p0.meas, 1)], ['True tread average', tp(r.trueAvg, 1)],
          ['Error', tdp(err, 1), Math.abs(err) > 5 ? 'bad' : Math.abs(err) > 2 ? 'meh' : 'ok'],
          ['Spot on the tread', `${fmt(p0.treadFrac * 100, 0)} %`, p0.treadFrac < 0.98 ? 'bad' : 'ok'],
          ['Spot size (straight on)', ln(r.spotMM, 1)], ['Tread width', ln(o.widthMM, 1)]
        ]);
      return;
    }
    const ioErr = r.estIO == null ? null : Math.abs(r.estIO - r.trueIO);
    kv('arKv', [
      ['Tread width seen', `${fmt(r.coverPct, 0)} %`, r.coverPct > 95 ? 'ok' : r.coverPct > 80 ? 'meh' : 'bad'],
      ['Pixels on the tread', `${r.onTread} of ${o.pixels}`],
      ['Across the tread per pixel', r.mmPerPx == null ? '–' : ln(r.mmPerPx, 2)],
      ['Inner minus outer, read', r.estIO == null ? '–' : tdp(r.estIO, 1), ioErr != null && ioErr > 3 ? 'bad' : ''],
      ['Inner minus outer, true edges', tdp(r.trueIO, 1)],
      ['Distance to just span the tread', r.needXMM == null ? '–' : ln(r.needXMM, 1)]
    ]);
  }
  // steering sweep for the array: frames come from the model once, then only the drawings update (no charts, no flags) so the page holds still
  let arAnim = null, arFrames = null, arFramesKey = '';
  function arFrame(deg) {
    const f = arFrames[Math.max(0, Math.min(arFrames.length - 1, Math.round(deg) + 30))];
    return Object.assign({}, arLast, f, { o: Object.assign({}, arLast.o, { steerDeg: f.deg }) });
  }
  function drawArFrame(r) {
    const o = r.o, single = o.kind === 'single';
    drawArLook(r, o); drawArTop(r, o);
    if (!single) drawArZones(r);
    const lo = Math.min(o.bgC, ...r.truth.map(p => p.T)), hi = Math.max(...r.truth.map(p => p.T));
    $('arStrip').innerHTML = r.pixels.map(p => `<i style="background:${heatCss(p.meas, lo, hi)}" title="pixel ${p.i + 1}: ${tp(p.meas, 1)}"></i>`).join('');
    fillArKv(r, o, single);
  }
  function stopArAnim() {
    if (!arAnim) return;
    cancelAnimationFrame(arAnim); arAnim = null; $('arFlags').style.opacity = '';
    $('a_play').textContent = 'Play steering sweep';
    keepScroll(() => renderView('components'));
  }
  $('a_play').addEventListener('click', () => {
    if (arAnim) return stopArAnim();
    if (!arLast) return;
    const key = JSON.stringify(AR);
    if (key !== arFramesKey) { arFrames = S.irArrayFrames(AR); arFramesKey = key; }
    $('a_play').textContent = 'Stop'; $('arFlags').style.opacity = '0.4';
    const t0 = performance.now();
    let shown = null;
    const step = now => {
      const deg = Math.round(25 * Math.sin((now - t0) / 1000 * Math.PI / 2));   // ±25° every 4 s
      if (deg !== shown) {
        shown = deg; AR.steerDeg = deg;
        $('a_steerDeg').value = deg; $('o_a_steerDeg').textContent = `${deg}°`;
        keepScroll(() => drawArFrame(arFrame(deg)));
      }
      arAnim = requestAnimationFrame(step);
    };
    arAnim = requestAnimationFrame(step);
  });
  $('v-components').addEventListener('input', e => {
    if (!arAnim || !e.isTrusted || e.target.id === 'arZoneMode' || e.target.id === 'arDof') return;
    cancelAnimationFrame(arAnim); arAnim = null; $('arFlags').style.opacity = ''; $('a_play').textContent = 'Play steering sweep';
  }, true);
  // the sticky header's height, so each input rail can fill the rest of the screen and scroll on its own
  const setHdr = () => { const h = document.querySelector('header.top'); if (h) document.documentElement.style.setProperty('--hdr', `${h.offsetHeight}px`); };
  setHdr(); window.addEventListener('resize', setHdr);
  if (window.ResizeObserver && document.querySelector('header.top')) new ResizeObserver(setHdr).observe(document.querySelector('header.top'));
  function keepScroll(fn) { const y = window.scrollY; fn(); if (window.scrollY !== y) window.scrollTo(0, y); }
  function drawArSweep(r) {
    const key = $('arDof').value || 'distMM', sw = r.sweeps[key], isLen = /MM$/.test(key);
    const cols = ['--s1', '--s3', '--ink', '--s4', '--s2'];
    const valTxt = v => (isLen ? ln(v, 1) : `${fmt(v, 0)}°`);
    C.legend('arProfLegend', sw.profiles.map((p, n) => [valTxt(p.v), cols[n]]));
    C.draw('c_arProf', sw.profiles.map((p, n) => ({ label: valTxt(p.v), data: p.meas.map((m, i) => ({ x: i + 1, y: tv(m) })), color: cols[n], width: n === 2 ? 3 : 1.5, points: r.o.pixels === 1 })),
      { xTitle: 'Pixel', yTitle: TU(), xMin: 0.5, xMax: r.o.pixels + 0.5 });
    const single = r.o.kind === 'single';
    C.draw('c_arCover', [{ label: single ? 'On tread %' : 'Tread seen %', data: sw.line.map(p => ({ x: isLen ? lnv(p.v) : p.v, y: single ? p.onTreadPct : p.coverPct })), color: '--s2' }],
      { xTitle: `${sw.label} (${isLen ? LU() : '°'})`, yMin: 0, yMax: 105, vrefs: [{ x: isLen ? lnv(sw.now) : sw.now, label: 'now' }] });
    $('arDofFoot').textContent = AR_DOF_TEXT[key];
  }
  // the tread seen face on, with each pixel's footprint (same style as the single IR view)
  function drawArLook(r, o) {
    const lo = Math.min(o.bgC, ...r.truth.map(p => p.T)), hi = Math.max(...r.truth.map(p => p.T));
    const ys = r.pixels.map(p => p.yMM).filter(v => v != null);
    const fpW = r.mmPerPx || (2 * o.distMM * Math.tan(o.hFovDeg / o.pixels * Math.PI / 360));
    const fpH = Math.max(4, 2 * o.distMM * Math.tan(o.vFovDeg * Math.PI / 360));
    const span = Math.max(o.widthMM * 1.5, ...ys.map(v => Math.abs(v) * 2 + fpW * 2));
    const k = Math.min(820 / span, 150 / fpH, 6), cx = 450, cy = 110, H = 160;
    const X = mm => cx + mm * k, ink2 = 'var(--ink-2)';
    let g = `<defs><linearGradient id="arGrad" x1="0" x2="1">${r.truth.map((p, n) => `<stop offset="${(n / (r.truth.length - 1)).toFixed(3)}" stop-color="${heatCss(p.T, lo, hi)}" stop-opacity="0.45"/>`).join('')}</linearGradient></defs>`;
    g += `<rect x="0" y="${cy - H / 2}" width="900" height="${H}" fill="var(--bg)"/>`;
    g += `<rect x="${X(-o.widthMM / 2)}" y="${cy - H / 2}" width="${o.widthMM * k}" height="${H}" fill="url(#arGrad)" stroke="var(--s2)"/>`;
    g += `<text x="${X(-o.widthMM / 2) + 6}" y="${cy - H / 2 + 16}" font-size="12" fill="${ink2}">inner edge</text>`;
    g += `<text x="${X(o.widthMM / 2) - 6}" y="${cy - H / 2 + 16}" font-size="12" text-anchor="end" fill="${ink2}">outer edge</text>`;
    g += `<text x="12" y="${cy - H / 2 + 16}" font-size="12" fill="${ink2}">background ${tp(o.bgC)}</text>`;
    r.pixels.forEach(p => {
      if (p.yMM == null) return;
      const bad = p.treadFrac < 0.98;
      const w = Math.max(2, fpW * k), h = Math.min(H - 8, fpH * k);
      g += `<rect x="${X(p.yMM) - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" fill="${heatCss(p.meas, lo, hi)}" fill-opacity="0.55" stroke="${bad ? 'var(--crit-ink)' : 'var(--s1)'}" stroke-width="${bad ? 1.5 : 1}"/>`;
    });
    // labels at inner, middle, outer pixels that land on the tread
    const on = r.pixels.filter(p => p.yMM != null && p.treadFrac > 0.5);
    const picks = on.length ? [on[0], on[Math.floor(on.length / 2)], on[on.length - 1]] : [];
    picks.forEach((p, n) => {
      const lx = cx + (n - 1) * 280, ly = cy + H / 2 + 62;
      const tr = r.truth[Math.round((p.yMM / 1000 + r.halfW) / (2 * r.halfW) * (r.truth.length - 1))];
      g += `<line x1="${X(p.yMM)}" y1="${cy}" x2="${lx}" y2="${ly - 16}" stroke="var(--ink-3)" stroke-dasharray="3 3"/><circle cx="${X(p.yMM)}" cy="${cy}" r="3" fill="var(--ink)"/>`;
      g += `<text x="${lx}" y="${ly}" font-size="14" text-anchor="middle" fill="var(--ink)" font-family="var(--f-mono)">${['inner', 'middle', 'outer'][n]} ${tp(p.meas, 1)}</text>`;
      g += `<text x="${lx}" y="${ly + 16}" font-size="11.5" text-anchor="middle" fill="var(--ink-2)">pixel ${p.i + 1} · true ${tr ? tp(tr.T, 1) : '–'}</text>`;
    });
    g += `<line x1="${X(-o.widthMM / 2)}" x2="${X(o.widthMM / 2)}" y1="${cy + H / 2 + 12}" y2="${cy + H / 2 + 12}" stroke="${ink2}"/><text x="${X(o.widthMM / 2) + 6}" y="${cy + H / 2 + 16}" font-size="12" fill="${ink2}">${ln(o.widthMM, 1)} tread</text>`;
    $('arSvg').innerHTML = g;
  }
  function drawArRow(r, o) {
    const presets = Object.entries(S.IR_ARRAY_PRESETS).filter(([k, p]) => p.kind === 'array' && k !== 'custom');
    const fovs = [...new Set(presets.map(([, p]) => p.hFovDeg).concat([o.hFovDeg]))].sort((a, b) => a - b);
    const cols = ['--s1', '--s3', '--s2', '--s7', '--s5'];
    const col = fv => cols[fovs.indexOf(fv) % cols.length];
    const ds = [];
    for (let d = 20; d <= 320; d += 10) ds.push(d);
    C.legend('arRowLegend', fovs.map(fv => [`${fv}°`, col(fv)]));
    C.draw('c_arRow', fovs.map(fv => ({ label: `${fv}°`, data: ds.map(d => ({ x: lnv(d), y: lnv(2 * d * Math.tan(fv * Math.PI / 360)) })), color: col(fv), width: fv === o.hFovDeg ? 3 : 1.5 })),
      { xTitle: `Distance (${LU()})`, yMin: 0, yMax: lnv(o.widthMM * 2.5), refs: [{ y: lnv(o.widthMM), label: 'tread width' }], vrefs: [{ x: lnv(o.distMM), label: 'now' }] });
  }
  // top view of the front tire with the pixel row (same style as the single IR top view)
  function drawArTop(r, o) {
    const R = r.tireR * 1000, Wt = o.widthMM + 12, deg = o.steerDeg;
    const lo = Math.min(o.bgC, ...r.truth.map(p => p.T)), hi = Math.max(...r.truth.map(p => p.T));
    const pe = r.pixels.map(p => p.end), sx0 = r.sensor[0] * 1000, sy0 = r.sensor[1] * 1000;
    const ext = Math.max(R, sx0 + 20, ...pe.map(e => e[0] * 1000));
    const k = Math.min(175 / R, 210 / ext), cx = 330, cy = 250;
    const P = (f, l) => [cx + l * k, cy - f * k];
    const ang = o.mount === 'chassis' ? deg : 0;              // on the upright the picture turns with the tire, so draw it straight
    let g = `<defs><linearGradient id="arTread" x1="0" x2="1"><stop offset="0" stop-color="var(--s2)" stop-opacity="${o.gradC ? 0.85 : 0.55}"/><stop offset="1" stop-color="var(--s2)" stop-opacity="0.4"/></linearGradient>
      <marker id="arArr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-3)"/></marker></defs>`;
    const [lx] = P(0, -Wt / 2 - 130);
    g += `<line x1="${lx}" y1="30" x2="${lx}" y2="440" stroke="var(--rule)" stroke-width="10" stroke-linecap="round"/><text x="${lx}" y="458" font-size="11.5" text-anchor="middle" fill="var(--ink-3)">chassis</text>`;
    g += `<line x1="40" y1="120" x2="40" y2="40" stroke="var(--ink-3)" stroke-width="1.5" marker-end="url(#arArr)"/><text x="48" y="52" font-size="11.5" fill="var(--ink-3)">front</text>`;
    const [x0, y0] = P(R, -Wt / 2), [tx, ty] = P(R, -o.widthMM / 2);
    g += `<g transform="rotate(${ang.toFixed(2)} ${cx} ${cy})">`;
    g += `<rect x="${x0}" y="${y0}" width="${Wt * k}" height="${2 * R * k}" rx="${22 * k}" fill="var(--ink-2)" fill-opacity="0.18" stroke="var(--ink-2)"/>`;
    g += `<rect x="${tx}" y="${ty}" width="${o.widthMM * k}" height="${2 * R * k}" fill="url(#arTread)"/>`;
    for (let f = -R + 30; f < R; f += 45) { const [a1, b1] = P(f, -Wt / 2), [a2] = P(f, Wt / 2); g += `<line x1="${a1}" y1="${b1}" x2="${a2}" y2="${b1}" stroke="var(--ink-2)" stroke-opacity="0.25"/>`; }
    g += `<text x="${P(0, -o.widthMM / 2 + 6)[0]}" y="${cy - 4}" font-size="11" fill="var(--ink)">inner</text><text x="${P(0, o.widthMM / 2 - 6)[0]}" y="${cy - 4}" font-size="11" text-anchor="end" fill="var(--ink)">outer</text>`;
    g += `</g><circle cx="${cx}" cy="${cy}" r="4" fill="var(--ink)"/><text x="${cx + 8}" y="${cy + 16}" font-size="11" fill="var(--ink-3)">steering axis</text>`;
    // the row in the frame the model drew it (the tire turned under a chassis sensor); for the upright, undo the turn
    const un = o.mount === 'chassis' ? 0 : deg * Math.PI / 180;
    const rot = (f, l) => [f * Math.cos(un) + l * Math.sin(un), -f * Math.sin(un) + l * Math.cos(un)];
    const [sx, sy] = P(...rot(sx0, sy0));
    r.pixels.forEach(p => {
      const [ex, ey] = P(...rot(p.end[0] * 1000, p.end[1] * 1000));
      g += `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${heatCss(p.meas, lo, hi)}" stroke-opacity="${p.hit === 'tread' ? 0.7 : 0.25}"/>`;
      if (p.hit === 'tread') g += `<circle cx="${ex}" cy="${ey}" r="3" fill="${heatCss(p.meas, lo, hi)}"/>`;
    });
    g += `<rect x="${sx - 9}" y="${sy - 6}" width="18" height="12" rx="2" fill="var(--ink)"/>`;
    g += `<text x="14" y="454" font-size="13" fill="var(--ink)" font-family="var(--f-mono)">steer ${deg >= 0 ? '+' : ''}${Math.round(deg)}°</text>`;
    $('arTopV').innerHTML = g;
    $('arTopNote').textContent = `${o.mount === 'chassis' ? 'Sensor on the chassis' : 'Sensor on the upright'} · ${ln(r.tireR * 2000, 1)} tire`;
    const st = r.sweeps.steerDeg.line, lose = st.filter(q => q.coverPct < 95).map(q => Math.abs(q.v));
    kv('arTopKv', [
      ['Steer', `${Math.round(deg)}°`],
      ['Tread width seen', `${fmt(r.coverPct, 0)} %`, r.coverPct > 95 ? 'ok' : r.coverPct > 80 ? 'meh' : 'bad'],
      ['Pixels on the tread', `${r.onTread} of ${o.pixels}`],
      ['Row starts losing an edge at', o.mount === 'upright' ? 'never' : lose.length ? `±${fmt(Math.min(...lose), 0)}°` : 'past the sweep']
    ]);
  }

  // top view of the front tire as it steers; pure geometry, so the sweep animates without calling the model
  let irLast = null, irAnim = null;
  function irAt(r, deg, key) {
    const t = r.bySteer, i = Math.max(0, Math.min(t.length - 2, Math.floor((deg - t[0].deg) / (t[1].deg - t[0].deg))));
    const a = t[i], b = t[i + 1], u = Math.max(0, Math.min(1, (deg - a.deg) / (b.deg - a.deg)));
    return a[key] + (b[key] - a[key]) * u;
  }
  function drawIrTop(o, r, deg) {
    const R = r.tireD * 500, Wt = o.widthMM + 12;            // tire radius and section width (mm), sidewall bulge past the tread
    const k = 175 / R, cx = 330, cy = 235;
    const P = (f, l) => [cx + l * k, cy - f * k];             // chassis frame (forward, outward) -> screen
    const th = -deg * Math.PI / 180;                          // tire turns opposite to the spot's slide across the tread
    const T = (f, l) => P(f * Math.cos(th) - l * Math.sin(th), f * Math.sin(th) + l * Math.cos(th));
    const pts = a => a.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');
    const ang = th * 180 / Math.PI;
    let g = `<defs><linearGradient id="irTread" x1="0" x2="1"><stop offset="0" stop-color="var(--s2)" stop-opacity="${o.gradC ? 0.85 : 0.55}"/><stop offset="1" stop-color="var(--s2)" stop-opacity="0.4"/></linearGradient>
      <marker id="irArr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-3)"/></marker></defs>`;
    // car frame references
    const [lx] = P(0, -Wt / 2 - 130);
    g += `<line x1="${lx}" y1="30" x2="${lx}" y2="440" stroke="var(--rule)" stroke-width="10" stroke-linecap="round"/>`;
    g += `<text x="${lx}" y="458" font-size="11.5" text-anchor="middle" fill="var(--ink-3)">chassis</text>`;
    g += `<line x1="40" y1="120" x2="40" y2="40" stroke="var(--ink-3)" stroke-width="1.5" marker-end="url(#irArr)"/><text x="48" y="52" font-size="11.5" fill="var(--ink-3)">front</text>`;
    // tire, drawn straight then rotated about the steering axis
    const [x0, y0] = P(R, -Wt / 2), [tx, ty] = P(R, -o.widthMM / 2);
    g += `<g transform="rotate(${ang.toFixed(2)} ${cx} ${cy})">`;
    g += `<rect x="${x0}" y="${y0}" width="${Wt * k}" height="${2 * R * k}" rx="${22 * k}" fill="var(--ink-2)" fill-opacity="0.18" stroke="var(--ink-2)"/>`;
    g += `<rect x="${tx}" y="${ty}" width="${o.widthMM * k}" height="${2 * R * k}" fill="url(#irTread)"/>`;
    for (let f = -R + 30; f < R; f += 45) { const [a1, b1] = P(f, -Wt / 2), [a2] = P(f, Wt / 2); g += `<line x1="${a1}" y1="${b1}" x2="${a2}" y2="${b1}" stroke="var(--ink-2)" stroke-opacity="0.25"/>`; }
    g += `<text x="${P(0, -o.widthMM / 2 + 6)[0]}" y="${cy - 4}" font-size="11" fill="var(--ink)">inner</text><text x="${P(0, o.widthMM / 2 - 6)[0]}" y="${cy - 4}" font-size="11" text-anchor="end" fill="var(--ink)">outer</text>`;
    g += `</g>`;
    g += `<circle cx="${cx}" cy="${cy}" r="4" fill="var(--ink)"/><text x="${cx + 8}" y="${cy + 16}" font-size="11" fill="var(--ink-3)">steering axis</text>`;
    // sensor spot: fixed to the chassis, or turning with the upright
    const mid = Math.floor(r.spots.length / 2);
    const centres = r.spots.map(p => p.centre - (o.mount === 'chassis' ? r.steerShiftMM : 0));   // aim without the current steer
    const spotAt = c => (o.mount === 'chassis' ? P(o.aimFwdMM, c) : T(o.aimFwdMM, c));
    const read = irAt(r, deg, o.mount === 'chassis' ? 'chassis' : 'upright');
    const fill = Math.abs(o.mount === 'chassis' ? o.aimFwdMM * Math.tan(deg * Math.PI / 180) + o.offsetMM : o.offsetMM) + r.spotMM / 2 <= o.widthMM / 2;
    centres.forEach((c, n) => {
      const [sx, sy] = spotAt(c);
      const col = fill || r.spots.length > 1 ? 'var(--s1)' : 'var(--crit-ink)';
      g += `<circle cx="${sx}" cy="${sy}" r="${(r.spotMM / 2) * k}" fill="${col}" fill-opacity="0.18" stroke="${col}" stroke-width="2"/>`;
      g += `<rect x="${sx - 7}" y="${sy - 5}" width="14" height="10" rx="2" fill="var(--ink)"/>`;
      if (n === mid) {
        const [bx, by] = o.mount === 'chassis' ? [lx, sy] : [cx, cy];
        g += `<line x1="${bx}" y1="${by}" x2="${sx}" y2="${sy}" stroke="var(--ink)" stroke-width="3" stroke-opacity="0.55"/>`;
      }
    });
    g += `<text x="14" y="${470 - 16}" font-size="13" fill="var(--ink)" font-family="var(--f-mono)">steer ${deg >= 0 ? '+' : ''}${Math.round(deg)}°</text>`;
    $('irTop').innerHTML = g;
    $('irTopNote').textContent = `${o.mount === 'chassis' ? 'Sensor on the chassis' : 'Sensor on the upright'} · ${ln(r.tireD * 1000, 1)} tire`;
    kv('irTopKv', [
      ['Steer', `${Math.round(deg)}°`],
      ['Reading (middle)', tp(read, 1), Math.abs(read - r.spots[mid].true) > 5 ? 'bad' : Math.abs(read - r.spots[mid].true) > 2 ? 'meh' : 'ok'],
      ['Tread slides under it', o.mount === 'chassis' ? ln(o.aimFwdMM * Math.tan(deg * Math.PI / 180), 1) : ln(0, 0)],
      ['Spot leaves the tread at', o.mount === 'chassis' ? (r.loseDeg < 30 ? `±${fmt(r.loseDeg, 0)}°` : 'past 30°') : 'never']
    ]);
  }
  function stopIrAnim() {
    if (!irAnim) return;
    cancelAnimationFrame(irAnim); irAnim = null;
    $('i_play').textContent = 'Play steering sweep';
    keepScroll(() => renderView('components'));
  }
  $('i_play').addEventListener('click', () => {
    if (irAnim) return stopIrAnim();
    if (!irLast) return;
    $('i_play').textContent = 'Stop';
    const t0 = performance.now();
    const step = now => {
      const deg = 25 * Math.sin((now - t0) / 1000 * Math.PI / 2);   // ±25° every 4 s
      IR.steerDeg = Math.round(deg);
      $('i_steerDeg').value = IR.steerDeg; $('o_i_steerDeg').textContent = `${IR.steerDeg}°`;
      drawIrTop(irLast.r.o, irLast.r, deg);
      irAnim = requestAnimationFrame(step);
    };
    irAnim = requestAnimationFrame(step);
  });

  function renderSteer() {
    const r = S.simulateSteering(ST), s = r.s;
    document.querySelectorAll('#v-components [data-mount]').forEach(el => { el.hidden = el.dataset.mount !== s.mount; });
    $('stNote').textContent = `±${s.lockDeg}° at the wheel uses ${fmt(r.usedPct, 0)} % of the pot`;
    kv('stKv', [
      ['Pot range used', `${fmt(r.usedPct, 0)} %`, r.clips ? 'bad' : r.usedPct < 50 ? 'meh' : 'ok'],
      ['Resolution', `${fmt(r.lsbDeg, 3)}° per count`],
      ['Noise', `±${fmt(r.noiseDeg, 2)}°`],
      ['Linearity', `±${fmt(r.linDeg, 2)}°`, r.linDeg > 2 ? 'meh' : ''],
      ['Supply', s.ratiometric ? 'cancels' : `±${fmt(r.supplyDeg, 2)}° at lock`, s.ratiometric ? 'ok' : 'meh'],
      ['Total (1σ)', `±${fmt(r.budgetDeg, 2)}°`, r.budgetDeg > 2 ? 'meh' : 'ok'],
      ['Worst in the test', `${fmt(r.maxErr, 2)}°`]
    ]);
    const f = [];
    if (r.clips) f.push(['crit', `Full lock needs ${fmt(r.usedPct, 0)} % of the pot's travel, so the reading sticks at the end of the track near lock${s.mount === 'column' ? ' and the wiper can hit the end stop' : ''}. ${s.mount === 'column' ? `Use a gear of ${fmt(r.good.gear, 2)} or a pot with more travel.` : `Use a pot with at least ${fmt(r.good.potMM, 0)} mm stroke.`}`]);
    else if (r.usedPct < 50) f.push(['warn', `Lock to lock uses only ${fmt(r.usedPct, 0)} % of the pot, which wastes resolution. ${s.mount === 'column' ? `Gearing it ${fmt(r.good.gear, 2)} : 1 would use 80 %.` : `A ${fmt(r.good.potMM, 0)} mm pot would use 80 %.`}`]);
    if (r.linDeg > 1) f.push(['warn', `Linearity (±${fmt(r.linDeg, 1)}°) is the biggest error. Calibrate at centre and both locks in the node or logger, or use a conductive plastic pot (about 0.25 %).`]);
    if (!s.ratiometric) f.push(['warn', `The pot is fed from a different supply than the ADC reference, so a ${s.supplyPct} % rail change moves the angle by up to ${fmt(r.supplyDeg, 1)}°. Feed the pot from the ADC's reference.`]);
    if (s.backlashDeg > 1) f.push(['warn', `${s.backlashDeg}° of free play shows up as a flat step every time the driver reverses. Use a clamped or keyed coupling.`]);
    if (!r.clips && r.usedPct >= 50) f.unshift(['good', `Range is fine: lock to lock uses ${fmt(r.usedPct, 0)} % of the pot and the ADC resolves ${fmt(r.lsbDeg, 2)}° steps.`]);
    flags('stFlags', f);
    const tr = r.trace;
    C.legend('stLegend', [['True', '--ink-3', true], ['Logged', '--s1']]);
    C.draw('c_stTrace', [
      { label: 'True', data: xy(tr.t, tr.truth), color: '--ink-3', dash: [5, 4], width: 1.5 },
      { label: 'Logged', data: xy(tr.t, tr.meas), color: '--s1', width: 1.75 }
    ], { xTitle: 'Time (s)', yTitle: 'Steering wheel angle (°)', refs: [{ y: s.lockDeg, label: 'lock' }, { y: -s.lockDeg }] });
    C.draw('c_stErr', [{ label: 'Error', data: xy(tr.t, tr.err), color: '--s2', width: 1.5 }], { xTitle: 'Time (s)', refs: [{ y: 0 }] });
  }

  // ------------------------------------------------------------ brake pressure
  let brk = null;
  function renderBrake() {
    const r = S.simulateBrakes(params, BK), b = r.b;
    if (!brk && window.BRBrake) {
      brk = window.BRBrake.mount($('brakeSvg'), {
        pr: (psi, d) => pr(psi, d), prShort: psi => `${fmt(prv(psi), 0)}`, force: n => frc(n),
        bore: inch => (IMP() ? `${(+inch).toFixed(3)} in` : `${fmt(inch * 25.4, 1)} mm`)
      });
      brk.onEnd = () => { $('bPlay').textContent = 'Press and release'; };
      $('bPlay').addEventListener('click', () => {
        if (brk.playing) { brk.stop(); $('bPlay').textContent = 'Press and release'; } else { brk.play(); $('bPlay').textContent = 'Stop'; }
      });
    }
    if (brk) brk.set(r);
    const share = `${fmt(r.brakeFrontPct, 0)} % front`;
    $('bNote').textContent = `${b.pedalPct} % pedal · ${share} · ${r.lightOn ? 'light on' : 'light off'}`;
    kv('bKv', [
      ['Front line', pr(r.frontPsi), r.clipFront ? 'bad' : ''],
      ['Rear line', pr(r.rearPsi), r.clipRear ? 'bad' : ''],
      ['Front sensor', `${fmt(r.vFront, 2)} V · ${r.codeFront}`],
      ['Rear sensor', `${fmt(r.vRear, 2)} V · ${r.codeRear}`],
      ['Braking', `${fmt(r.decelG, 2)} g`, r.lockFront || r.lockRear ? 'bad' : ''],
      ['Brake force front', `${fmt(r.brakeFrontPct, 1)} %`],
      ['Ideal front now', `${fmt(r.idealFrontPct, 1)} %`],
      ['Brake light', r.lightOn ? 'ON' : 'off', r.lightOn ? 'ok' : ''],
      ['Hard braking flag', r.hard ? 'yes' : 'no', r.hard ? 'meh' : '']
    ]);
    const f = [];
    if (r.lockFront && r.lockRear) f.push(['warn', `At ${b.pedalPct} % pedal both axles ask for more than the tires' ${fmt(b.tireMu, 2)} g of grip, so all four wheels lock.`]);
    else if (r.lockRear) f.push(['crit', `The rears lock first at ${b.pedalPct} % pedal. A car with locked rears spins. Turn the knob toward the front (about ${r.bestTurns > 0 ? '+' : ''}${fmt(r.bestTurns, 1)} turns uses both axles fully at the limit).`]);
    else if (r.lockFront) f.push(['warn', `The fronts lock first at ${b.pedalPct} % pedal: the car goes straight on but stays stable. Turning the knob toward the rear (about ${r.bestTurns > 0 ? '+' : ''}${fmt(r.bestTurns, 1)} turns) gets more out of the rears.`]);
    if (r.clipFront || r.clipRear) f.push(['crit', `The ${r.clipFront ? 'front' : 'rear'} line is past the sensor's ${pr(b.sensorMaxPsi)} range, so the reading sticks at 4.5 V. A smaller pedal ratio, bigger master cylinder or a 2,000 psi sensor fixes it.`]);
    if (b.lightOffPsi >= b.lightOnPsi) f.push(['crit', `The off point (${pr(b.lightOffPsi, 1)}) must be below the on point (${pr(b.lightOnPsi, 1)}) or the light flickers.`]);
    if (r.lightOnPedalPct != null) f.push(['good', `The brake light comes on at ${r.lightOnPedalPct} % pedal, just after the free play (${b.freePct} %), so a light touch of the brakes shows behind the car.`]);
    if (r.lockPedalPct != null && !r.lockFront && !r.lockRear) f.push(['good', `No wheel locks yet. Pushing harder, the ${r.lockFirst === 'both' ? 'front and rear lock together' : r.lockFirst + 's lock first'} at ${r.lockPedalPct} % pedal (${fmt(r.lockG, 2)} g).`]);
    flags('bFlags', f);
    const sw = r.sweep, pct = sw.map(x => x.pct);
    C.legend('bPressLegend', [['Front', '--s1'], ['Rear', '--s2']]);
    C.draw('c_bPress', [
      { label: 'Front', data: xy(pct, sw.map(x => prv(x.front))), color: '--s1' },
      { label: 'Rear', data: xy(pct, sw.map(x => prv(x.rear))), color: '--s2' }
    ], { xTitle: 'Pedal travel (%)', yTitle: `Pressure (${PU()})`, xMin: 0, xMax: 100, ySugMin: 0,
      refs: [{ y: prv(b.lightOnPsi), label: 'light on', color: '#d63b30' }, { y: prv(b.sensorMaxPsi), label: 'sensor max' }], vrefs: [{ x: b.pedalPct, label: 'now' }] });
    const lockAt = sw.filter(x => x.lockF || x.lockR);
    C.draw('c_bDecel', [
      { label: 'Braking', data: xy(pct, sw.map(x => Math.min(x.g, b.tireMu))), color: '--s1' },
      { label: 'Asked of the brakes', data: xy(pct, sw.map(x => x.g)), color: '--ink-3', dash: [5, 4], width: 1.5 }
    ], { xTitle: 'Pedal travel (%)', yTitle: 'g', xMin: 0, xMax: 100, ySugMin: 0, yMax: Math.max(b.tireMu * 1.6, 1),
      refs: [{ y: b.tireMu, label: 'tire grip' }], vrefs: [{ x: b.pedalPct, label: 'now' }].concat(lockAt.length ? [{ x: lockAt[0].pct, label: (r.lockFirst === 'both' ? 'all' : r.lockFirst) + ' lock' }] : []) });
    $('bDecelFoot').textContent = r.lockPedalPct != null ? `Past ${r.lockPedalPct} % pedal the brakes can make more force than the tires can hold, so the ${r.lockFirst === 'both' ? 'wheels lock' : r.lockFirst + ' wheels lock first'} and the car stops at the grip limit (${fmt(b.tireMu, 2)} g) at best.` : 'The tires never run out of grip at this setting.';
    // light: press to full and release, hysteresis on the higher of the two sensors
    const L = r.light, on = [], lTop = Math.ceil(prv(b.lightOnPsi) * 3 / (IMP() ? 10 : 1)) * (IMP() ? 10 : 1);
    let s0 = null;
    L.forEach((x, i) => { if (x.on && s0 == null) s0 = i; if ((!x.on || i === L.length - 1) && s0 != null) { on.push({ x0: s0, x1: i, color: 'rgba(214,59,48,0.16)', label: 'light on' }); s0 = null; } });
    C.legend('bLightLegend', [['Higher of the two sensors', '--s1'], ['Pedal travel (top = 100 %)', '--ink-3', true]]);
    C.draw('c_bLight', [
      { label: 'Pressure', data: L.map((x, i) => ({ x: i, y: prv(x.psi) })), color: '--s1' },
      { label: 'Pedal %', data: L.map((x, i) => ({ x: i, y: lTop * x.pct / 100 })), color: '--ink-3', dash: [4, 4], width: 1.25 }
    ], { xTitle: 'Time: pressing down, then letting off', yTitle: PU(), xMin: 0, xMax: L.length - 1, yMin: 0, yMax: lTop,
      bands: on, refs: [{ y: prv(b.lightOnPsi), label: 'on', color: '#d63b30' }, { y: prv(b.lightOffPsi), label: 'off' }],
      tooltip: { title: it => `pedal ${L[it[0].parsed.x].pct} %`, label: it => it.datasetIndex ? '' : `${pr(L[it.parsed.x].psi, 1)} · light ${L[it.parsed.x].on ? 'on' : 'off'}` } });
    $('bLightFoot').textContent = `Zoomed in on the bottom of the range. Going down the light switches on at ${pr(b.lightOnPsi, 1)}; coming back up it stays on until the pressure falls below ${pr(b.lightOffPsi, 1)}, so a foot resting at the threshold can't make it flicker. The rear node compares the higher of the two sensors, so it still works if one circuit fails.`;
    const bt = r.byTurn;
    C.draw('c_bBias', [
      { label: 'Brake force front', data: bt.map(x => ({ x: x.turns, y: x.brakeFrontPct })), color: '--s1' },
      { label: 'Bar split', data: bt.map(x => ({ x: x.turns, y: x.frontPct })), color: '--ink-3', dash: [5, 4], width: 1.5 }
    ], { xTitle: 'Knob turns from centre (+ = more front)', yTitle: '% front', xMin: -b.turnsMax, xMax: b.turnsMax,
      refs: [{ y: r.idealLimPct, label: `ideal at ${fmt(b.tireMu, 2)} g`, color: '#2a9d5c' }], vrefs: [{ x: b.biasTurns, label: 'now' }, { x: r.bestTurns, label: 'best' }] });
    $('bBiasFoot').textContent = `Solid: share of the braking force on the front axle; dashed: share of the pedal push the bar sends forward. The bores (${IMP() ? b.mcFrontIn.toFixed(3) + ' in' : fmt(b.mcFrontIn * 25.4, 1) + ' mm'} front, ${IMP() ? b.mcRearIn.toFixed(3) + ' in' : fmt(b.mcRearIn * 25.4, 1) + ' mm'} rear), calipers and rotors move the solid line up or down. Braking moves weight forward, so at the grip limit the front should take ${fmt(r.idealLimPct, 0)} %; about ${r.bestTurns > 0 ? '+' : ''}${fmt(r.bestTurns, 1)} turns gets there.`;
    const rows = [['Nothing pressed', 0], ['Brake light on', b.lightOnPsi], ['Hard braking flag', b.hardPsi], ['Front now', r.frontPsi], ['Rear now', r.rearPsi], ['Sensor full scale', b.sensorMaxPsi]];
    const vOf = psi => 0.5 + 4 * Math.min(psi, b.sensorMaxPsi) / b.sensorMaxPsi;
    $('bSens').innerHTML = `<thead><tr><th>Point</th><th class="num">Pressure</th><th class="num">Sensor</th><th class="num">ADC code</th></tr></thead><tbody>` +
      rows.map(([t, psi]) => `<tr><td>${t}</td><td class="num">${pr(psi, 1)}</td><td class="num">${fmt(vOf(psi), 3)} V</td><td class="num">${Math.round(vOf(psi) / 5 * (2 ** b.adcBits - 1))}</td></tr>`).join('') + '</tbody>';
    $('bSensFoot').textContent = `0 to ${pr(b.sensorMaxPsi)} sensors, 0.5 to 4.5 V (brake pressure sensors form), read by a ${b.adcBits}-bit ADC on a 5 V reference: one count is ${pr(r.psiPerCount, 2)}. Below 0.5 V or above 4.5 V means a broken wire or a short, which the node can flag.`;
  }

  // ------------------------------------------------------------ dash computer (Raspberry Pi) view
  const DP = Object.assign({}, S.PI_DEFAULTS);
  const D_UNITS = {
    fps: v => `${v} fps`, bufS: v => `${v} s`, viewerHistS: v => `${v} s`, imuHz: v => `${v} Hz`, gpsHz: v => `${v} Hz`,
    loraHz: v => `${v} /s`, loraBytes: v => `${v} B`, specRamPct: v => `${v} %`, specCorePct: v => `${v} %`
  };
  const ramTxt = g => (g >= 1 ? `${g} GB` : `${Math.round(g * 1024)} MB`);
  function piRamOpts() {
    const b = S.PI_BOARDS[DP.board], el = $('d_ramGB');
    if (b.linux) {
      if (!b.ramGB.includes(DP.ramGB)) DP.ramGB = b.ramGB.includes(2) ? 2 : b.ramGB[0];
      el.innerHTML = b.ramGB.map(g => `<option value="${g}">${ramTxt(g)} · $${b.price[g]}</option>`).join('');
      el.disabled = false; el.value = DP.ramGB;
    } else { el.innerHTML = `<option value="${DP.ramGB}">${b.ramKB} KB on the chip · $${b.price}</option>`; el.disabled = true; el.value = DP.ramGB; }
    $('d_boardNote').textContent = `${b.cpu}. ${b.note}.`;
    // firmware boards have no OS, language or renderer choice; Pi-only power-cut options greyed out
    ['d_os', 'd_lang', 'd_renderer', 'd_canIface', 'd_rootRO', 'd_bootTuned'].forEach(id => { $(id).disabled = !b.linux; });
    $('d_canIfaceNote').textContent = DP.board === 'teensy41' ? 'Teensy: CAN controller on the chip + Adafruit CAN Pal transceiver' : '';
  }
  // keep the screen sensible when the board changes: firmware boards need the EVE screen, Pis an HDMI/DSI one
  function piFitScreen() {
    const b = S.PI_BOARDS[DP.board], port = S.PI_DISPLAYS[DP.display].port;
    if (!b.linux && !['spi', 'eve'].includes(port)) DP.display = '5in-eve';
    if (b.linux && port === 'eve') DP.display = '5in-dsi';
  }
  const PI_PRESETS = {
    teensy: { board: 'teensy41', display: '5in-eve', lang: 'c', holdUp: 'cap', bufS: 1, rootRO: false, bootTuned: false },
    piStock: { board: 'pi5', ramGB: 2, os: 'lite', lang: 'python', renderer: 'pygame', display: '5in-dsi', canIface: 'mcp2518fd', holdUp: 'none', bufS: 5, rootRO: false, bootTuned: false },
    piHard: { board: 'pi5', ramGB: 2, os: 'lite', lang: 'python', renderer: 'pygame', display: '5in-dsi', canIface: 'mcp2518fd', holdUp: 'supercap', bufS: 1, rootRO: true, bootTuned: true },
    piKiosk: { board: 'pi5', ramGB: 2, os: 'lite', lang: 'python', renderer: 'chromium', display: '5in-dsi', canIface: 'mcp2518fd', holdUp: 'none', bufS: 1, rootRO: true, bootTuned: true }
  };
  function bindDash() {
    const opts = (id, obj) => { $(id).innerHTML = Object.entries(obj).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join(''); };
    opts('d_board', S.PI_BOARDS); opts('d_holdUp', S.PI_HOLDUPS); opts('d_os', S.PI_OS); opts('d_lang', S.PI_LANGS); opts('d_renderer', S.PI_RENDERERS); opts('d_display', S.PI_DISPLAYS); opts('d_canIface', S.PI_CAN);
    piRamOpts();
    const syncD = bindGroup('d', DP, D_UNITS, () => { Object.assign(DP, S.PI_DEFAULTS); piRamOpts(); }, 'dash');
    $('d_board').addEventListener('input', () => { piFitScreen(); piRamOpts(); syncD(); renderView('dash'); });
    $('piPreset').addEventListener('input', () => {
      const pr = PI_PRESETS[$('piPreset').value]; if (!pr) return;
      Object.assign(DP, pr); piRamOpts(); syncD(); renderView('dash');
    });
    $('piPlay').addEventListener('click', () => { piPlay = !piPlay; $('piPlay').textContent = piPlay ? 'Pause' : 'Play'; piGo(); });
    $('piRestart').addEventListener('click', () => dashOS && dashOS.reboot());
    $('piSkip').addEventListener('click', () => dashOS && dashOS.skip(30));
    $('piScen').innerHTML = Object.entries(window.BRDashOS ? window.BRDashOS.SCENARIOS : {}).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    $('piScen').addEventListener('input', () => dashOS && dashOS.scenario($('piScen').value));
    $('piTable').addEventListener('click', e => {
      const tr = e.target.closest('tr[data-k]'); if (!tr) return;
      const [k, g] = tr.dataset.k.split('|'); DP.board = k; if (g) DP.ramGB = +g;
      piFitScreen(); piRamOpts(); syncD(); renderView('dash');
    });
    return syncD;
  }
  let syncDash = null;
  let dashOS = null, piPlay = true, piScrolling = false, piScrollT = null, piVisible = true;
  function piGo() { if (!dashOS) return; if (piPlay && !piScrolling && piVisible && currentView === 'dash') dashOS.start(); else dashOS.stop(); }
  window.addEventListener('scroll', () => {
    if (!piScrolling) { piScrolling = true; piGo(); }
    clearTimeout(piScrollT); piScrollT = setTimeout(() => { piScrolling = false; piGo(); }, 250);
  }, { passive: true });
  if (window.IntersectionObserver) new IntersectionObserver(es => { piVisible = es[0].isIntersecting; piGo(); }).observe($('osScreen'));
  // the plain dash: default dash options, no inputs, nothing but the screen and its buttons
  let liveOS = null;
  function renderLive() {
    if (!window.BRDashOS) return;
    const r = S.simulatePi(params, S.PI_DEFAULTS);
    if (!liveOS) { liveOS = window.BRDashOS.mount($('liveScreen'), { spv, SU, tp, IMP }, {}); liveOS.scenario('clean'); }
    let bias = 64;
    try { bias = S.simulateBrakes(params, S.BRAKE_DEFAULTS).brakeFrontPct; } catch (e) { /* brake model optional here */ }
    liveOS.set(r, R.lap, { biasPct: bias });
    if (currentView === 'live' && !document.hidden) liveOS.start(); else liveOS.stop();
  }
  function renderDash() {
    const r = S.simulatePi(params, DP), sel = r.sel, b = r.board, pico = !b.linux, o = r.o;
    if (!dashOS && window.BRDashOS) {
      dashOS = window.BRDashOS.mount($('osScreen'), { spv, SU, tp, IMP }, {
        onSetting: (k, v) => { DP[k] = v; syncDash && syncDash(); renderView('dash'); }
      });
      dashOS.scenario($('piScen').value || 'clean');
    }
    let bias = 64;
    try { bias = S.simulateBrakes(params, BK).brakeFrontPct; } catch (e) { /* brake model optional here */ }
    if (dashOS) dashOS.set(r, R.lap, { biasPct: bias });
    if (window.BRPiWiring) window.BRPiWiring.draw({ svg: $('pwSvg'), table: $('pwPins'), flags: $('pwFlags'), cfg: $('pwCfg'), note: $('pwNote') }, r, { tp });
    piGo();
    const cutTxt = c => `${c.osSafe ? '' : 'OS at risk, '}${c.clean ? 'closes cleanly' : 'loses ~' + fmt(c.lostS, 0) + ' s'}`;
    const cut = sel.cut, teensy = r.boardKey === 'teensy41';
    $('pwTitle').textContent = b.linux ? 'Wiring: Pi, buttons, screen, CAN HAT and power' : teensy ? 'Wiring: Teensy 4.1, buttons, EVE screen, CAN Pal and power' : 'Wiring';
    $('pwCfgHead').innerHTML = b.linux ? 'Setup in <code>/boot/firmware/config.txt</code>:' : 'Firmware setup (Arduino / Teensyduino):';
    const memTxt = x => (x.ramKB ? `${fmt(x.usedKB, 0)} of ${x.ramKB} KB` : `${fmt(x.usedMB, 0)} of ${fmt(x.ramMB, 0)} MB`);
    $('piNote').textContent = `${b.label}${pico ? '' : ' ' + ramTxt(r.ramGB)} · ${r.fps} CAN frames/s · ${sel.ok ? 'inside spec' : 'outside spec'}`;
    $('piSpecNote').textContent = `spec: memory ≤ ${o.specRamPct} %, busiest core ≤ ${o.specCorePct} %`;
    $('piTable').innerHTML = '<thead><tr><th>Board</th><th>Memory</th><th class="num">Boot to dash</th><th class="num">Memory used</th><th class="num">Busiest core</th><th class="num">All cores</th><th class="num">5 V draw</th><th>Power cut</th><th class="num">Price</th><th>Spec</th><th>Why</th></tr></thead><tbody>' +
      r.rows.map(x => {
        const bb = S.PI_BOARDS[x.key], isSel = x.key === r.boardKey && x.ramGB === r.ramGB;
        const why = x.fails.concat(x.warns.filter(w => !/no operating system/.test(w))).join('; ') || 'fits with room to spare';
        return `<tr data-k="${x.key}|${x.ramGB == null ? '' : x.ramGB}" aria-selected="${isSel}"><td>${bb.label}</td><td>${x.ramKB ? x.ramKB + ' KB' : ramTxt(x.ramGB)}</td><td class="num">${fmt(x.bootS, 1)} s</td><td class="num">${fmt(x.ramPct, 0)} %</td><td class="num">${fmt(x.busiest, 0)} %</td><td class="num">${fmt(x.totalCpu, 0)} %</td><td class="num">${fmt(x.amps, 1)} A</td><td class="${x.cut.osSafe ? '' : 'bad'}">${cutTxt(x.cut)}</td><td class="num">$${x.price}</td><td class="${x.ok ? 'ok' : 'bad'}">${x.ok ? 'Yes' : 'No'}</td><td class="why">${why}</td></tr>`;
      }).join('') + '</tbody>';
    $('piSelTitle').textContent = `${b.label}${pico ? '' : ' ' + ramTxt(r.ramGB)}`;
    kv('piKv', [
      ['Memory used', memTxt(sel), sel.ramPct > o.specRamPct ? 'bad' : 'ok'],
      ['Memory use', `${fmt(sel.ramPct, 0)} %`, sel.ramPct > o.specRamPct ? 'bad' : 'ok'],
      ['Busiest core', `${fmt(sel.busiest, 0)} %`, sel.busiest > o.specCorePct ? 'bad' : 'ok'],
      ['All cores', `${fmt(sel.totalCpu, 0)} %`],
      ['Boot to dash', `${fmt(sel.bootS, 1)} s`, sel.bootS > 20 ? 'meh' : ''],
      ['CAN frames', `${r.fps} /s`],
      ['Log rate', `${fmt(r.logKBs, 1)} KB/s`],
      ['Log per endurance', `${fmt(r.logMBendur, 0)} MB`],
      ['5 V draw with screen', `${fmt(sel.amps, 1)} A`, sel.amps > 4 ? 'meh' : ''],
      ['Hold-up after master switch', cut.holdS > 0 ? `${fmt(cut.holdS, cut.holdS < 1 ? 2 : 0)} s (needs ${fmt(cut.needS, 2)} s)` : 'none', cut.clean ? 'ok' : 'meh'],
      ['Data lost on a power cut', cut.clean ? 'none, file closed' : `last ~${fmt(cut.lostS, 0)} s`, cut.clean ? 'ok' : cut.lostS > 3 ? 'bad' : 'meh'],
      ['Boots after a power cut', cut.osSafe ? (b.linux ? 'yes' : 'yes, firmware in flash') : 'at risk (SD root can corrupt)', cut.osSafe ? 'ok' : 'bad'],
      ['LoRa air time', o.lora ? `${fmt(r.lora.airtimeMs, 1)} ms × ${o.loraHz}/s = ${fmt(r.lora.dutyPct, 0)} %` : 'off', o.lora && r.lora.dutyPct > 100 ? 'bad' : o.lora && r.lora.dutyPct > 50 ? 'meh' : '']
    ]);
    const f = [];
    sel.fails.forEach(t => f.push(['crit', t[0].toUpperCase() + t.slice(1) + '.']));
    sel.warns.forEach(t => f.push(['warn', t[0].toUpperCase() + t.slice(1) + '.']));
    if (o.lora) {
      if (r.lora.dutyPct > 100) f.push(['crit', `LoRa can't keep up: each ${o.loraBytes} B packet takes ${fmt(r.lora.airtimeMs, 0)} ms on air at SF${o.loraSF}, so at most ${fmt(r.lora.maxHz, 1)} packets a second. Send fewer bytes, less often, or use a lower SF or wider bandwidth (shorter range).`]);
      else if (r.lora.dutyPct > 50) f.push(['warn', `LoRa is on air ${fmt(r.lora.dutyPct, 0)} % of the time; leave room for retries and the pit's replies.`]);
      if (!r.lora.dwellOk) f.push(['warn', `Each packet is on air ${fmt(r.lora.airtimeMs, 0)} ms, over the 400 ms per channel that US 915 MHz hopping rules allow at 125 kHz. Use 500 kHz or a lower SF.`]);
    }
    if (!cut.clean && cut.holdUp === 'none') f.push(['warn', `The master switch cuts power with no warning every time the car is turned off (IC.9.3.2a). With no hold-up the last ~${fmt(cut.lostS, 0)} s of log is lost${b.linux ? '' : '; a shorter write buffer or a 2,200 µF hold-up capacitor fixes it'}.`]);
    if (!cut.clean && cut.holdUp !== 'none') f.push(['warn', `The hold-up lasts ${fmt(cut.holdS, 2)} s but ${b.linux ? 'a clean shutdown' : 'closing the file'} needs about ${fmt(cut.needS, 2)} s: about ${fmt(cut.needF, cut.needF < 0.1 ? 4 : 2)} F on the 12 V feed is enough.`]);
    if (cut.clean) f.push(['good', `On a power cut the hold-up runs it ${fmt(cut.holdS, cut.holdS < 1 ? 2 : 0)} s, enough to ${b.linux ? 'sync and shut down cleanly' : 'finish the log and close the file'}. Wire the 12 V feed through a divider to a ${b.linux ? 'GPIO (power-lost signal)' : 'Teensy pin (power-fail interrupt)'}.`]);
    if (sel.ok) f.unshift(['good', `${b.label}${pico ? '' : ' ' + ramTxt(r.ramGB)} runs all of it with ${fmt(100 - sel.ramPct, 0)} % of memory and ${fmt(100 - sel.busiest, 0)} % of its busiest core to spare.`]);
    const smallest = r.rows.filter(x => x.ok && x.ramGB != null && x.key === r.boardKey).sort((a, c) => a.ramGB - c.ramGB)[0];
    if (b.linux && smallest) f.push(['info', `Smallest ${b.label} that fits this setup: ${ramTxt(smallest.ramGB)} ($${smallest.price}).`]);
    flags('piFlags', f);
    const procs = sel.procs.slice().sort((a, c) => c.ram - a.ram), cols = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s7'];
    $('piMemUnit').textContent = pico ? 'KB' : 'MB';
    C.draw('c_piMem', [{ label: pico ? 'KB' : 'MB', data: procs.map(p => +p.ram.toFixed(pico ? 1 : 0)), colors: procs.map((p, i) => cols[i % cols.length]) }], { bar: true, labels: procs.map(p => p.name), ySugMin: 0 });
    C.draw('c_piCpu', [{ label: '%', data: sel.cores.map(c => +c.toFixed(1)), colors: sel.cores.map(c => (c > o.specCorePct ? '--crit' : '--s1')) }], { bar: true, labels: sel.cores.map((c, i) => `core ${i}`), yMin: 0, ySugMax: 100, refs: [{ y: o.specCorePct, label: 'spec' }] });
    $('piCpuFoot').textContent = teensy
      ? 'One 600 MHz core runs everything from interrupts: CAN frames, IMU and GPS samples are timestamped in microseconds, and the EVE screen draws its own pixels.'
      : pico
      ? 'Firmware runs CAN, logging and the IMU on core 0 and the screen and LoRa on core 1.'
      : `Each program is one thread (${o.renderer === 'chromium' ? 'Chromium uses two' : 'the dash too'}), so a Python program can only use one core; the busiest core is the limit, not the average.`;
  }

  // ------------------------------------------------------------ inputs view
  const META = [
    ['Vehicle', 'massKg', 'Car + driver mass', 'kg', 'Master Timeline curb 216 kg + 160 lb driver [Tanner]'], ['Vehicle', 'tireD', 'Tire diameter (16x7.5-10)', 'm', 'VD Tire Model Data form'],
    ['Vehicle', 'finalDrive', 'Final drive ratio', '', 'assumption'], ['Vehicle', 'latG', 'Cornering grip', 'g', 'assumption'],
    ['Engine', 'restrictorMM', 'Intake restrictor', 'mm', 'Rules IC.1.6 (gasoline)'], ['Engine', 'shiftRpm', 'Upshift rpm', 'rpm', 'assumption'],
    ['Engine', 'revLimit', 'Rev limiter', 'rpm', 'assumption'], ['Engine', 'idleRpm', 'Idle speed', 'rpm', 'Charging form (≥ 1800)'],
    ['Engine', 'injFlowCc', 'Injector flow', 'cc/min', 'forum, verify on bench'], ['Engine', 'injOhm', 'Injector impedance', 'Ω', 'ECU CBR600RR form, verify'],
    ['Engine', 'dwell14', 'Coil dwell at 14 V', 'ms', 'assumption'], ['Engine', 'triggerTeeth', 'Crank wheel teeth (12, no gap)', '', 'ECU CBR600RR form, verify with scope'],
    ['Engine', 'lambdaWot', 'Lambda at full throttle', '', 'Calibration Plan form'], ['Engine', 'bte', 'Brake thermal efficiency', '', 'assumption (~70 hp)'],
    ['Power', 'battery', 'Battery', '', 'Tanner: NOCO NLP14'], ['Power', 'regSet', 'Regulator set point', 'V', 'Charging form (14.2–14.6)'],
    ['Power', 'statorSat', 'Stator current ceiling', 'A', 'fit to 26 A @ 5000 rpm, Charging form'], ['Power', 'starterA', 'Starter current', 'A', 'Charging form, verify'],
    ['Power', 'cableMOhm', 'Cable + switch resistance', 'mΩ', 'Charging form'], ['Power', 'fanA', 'Radiator fan', 'A', 'Charging form'],
    ['Power', 'pumpA', 'Fuel pump', 'A', 'Charging form'], ['Power', 'ecuMinV', 'ECU brown-out voltage', 'V', 'assumption, ask Ecumaster'],
    ['Power', 'buckEff', 'Node buck efficiency', '', '5V Buck form (LT8609S)'], ['Power', 'changeMin', 'Driver change', 'min', 'Rules D.12.8'],
    ['Power', 'endurKm', 'Endurance distance', 'km', 'Rules D.12'],
    ['CAN', 'canLayout', 'Bus layout', '', 'Tanner: all CAN 2.0'], ['CAN', 'bitrate', 'Nominal bitrate', 'bit/s', 'proposed, not confirmed'],
    ['CAN', 'fdDataRate', 'CAN FD data rate', 'bit/s', 'assumption'], ['CAN', 'emuRate', 'EMU stream rate', 'Hz', 'Sample Rates form'],
    ['CAN', 'emuFrames', 'EMU frames per cycle', '', 'assumption, check EMU client'], ['CAN', 'dashFwdFrames', 'Dash MCU frames to nodes', '', 'Tanner: dash logs and forwards; count assumed'], ['CAN', 'dashFwdHz', 'Dash-to-node rate', 'Hz', 'assumption'], ['CAN', 'trunkPtM', 'EMU bus length', 'm', '3D route × 1.25, assumption'], ['CAN', 'trunkChM', 'FD chassis bus length', 'm', '3D route × 1.25, assumption'],
    ['CAN', 'stubM', 'Node stub length', 'm', 'assumption'], ['CAN', 'trxLoopNs', 'Transceiver loop delay', 'ns', 'assumption (TJA1051 class)']
  ];
  let wiringDone = false;
  function renderWiring() {
    if (wiringDone || !window.BRWiring) return;
    const Wr = window.BRWiring;
    $('wiringSvg').innerHTML = Wr.schematicSVG();
    const svg = $('wiringSvg').querySelector('svg');
    svg.style.minWidth = '900px'; svg.style.width = '100%'; svg.style.height = 'auto';
    $('fuelSvg').innerHTML = Wr.fuelSystemSVG();
    const fsvg = $('fuelSvg').querySelector('svg');
    fsvg.style.minWidth = '900px'; fsvg.style.width = '100%'; fsvg.style.height = 'auto';
    const pinTable = rows => `<thead><tr><th>Pin</th><th>EMU function</th><th>BR27 use</th><th>Wire</th></tr></thead><tbody>` +
      rows.map(([pin, fn, use, wire, g]) => `<tr style="${g === 'spare' ? 'color:var(--ink-3)' : ''}"><td class="num">${pin}</td><td>${fn}</td><td>${use || '—'}</td><td>${wire}</td></tr>`).join('') + '</tbody>';
    $('pinsBlack').innerHTML = pinTable(Wr.BLACK);
    $('pinsGrey').innerHTML = pinTable(Wr.GREY);
    $('compTable').innerHTML = '<thead><tr><th>Ref</th><th>Component</th><th>Location</th><th>Status</th></tr></thead><tbody>' +
      Wr.components().map(c => `<tr><td>${c.ref}</td><td>${c.desc}</td><td>${c.loc}</td><td style="${c.status === 'To be selected' ? 'color:var(--warn-ink);font-weight:600' : ''}">${c.status}</td></tr>`).join('') + '</tbody>';
    $('fuseTable').innerHTML = '<tbody>' + Wr.FUSES.map(f => `<tr><td>${f[0]}</td><td class="num">${f[1]}</td><td>${f[2]}</td></tr>`).join('') + '</tbody>';
    flags('wiringNotes', [
      ['good', 'The EMU is fed from F1 ahead of the kill relay, so it keeps logging after a shutdown. Everything it fires (injectors, coils, wideband heater, pump relay) gets +12 V from the kill bus.'],
      ['warn', 'Coil 4 is on the black connector (B14), not the grey one. Easy to miss when building the harness.'],
      ['info', 'Crank and cam VR sensors: shielded twisted pair, shield grounded at the EMU sensor ground only.'],
      ['info', 'Firewall (rev F): one sheet bent ~135° (back panel + sloped lower leg). The battery and EMU sit in the wedge under the sloped leg on the engine side; the fuse/relay box is part of the dash unit at the front. EMU-to-engine wires do not cross; the battery feed, the dash-unit feeds back to the EMU and engine (F1, kill bus, pump and fan +12 V), the EMU relay drive wires (G13, G5) and the CAN chain cross at grommet GR1.'],
      ['info', 'Fuel system: the pump relay (G13) and the injectors take +12 V from the kill bus, so any shutdown switch stops fuel. The float fuel level sender reads on Analog #5 (B35) through a 470 Ω pull-up (R1) to +5 V, about 0.33 V full to 1.69 V empty; the EMU sends it to the dash over CAN.'],
      ['info', 'CAN: one chain, dash unit (120 Ω) → FR → FL → GR1 → splice beside the EMU → RR → RL (120 Ω). The EMU is on a ~0.1 m stub with its software-selectable 120 Ω OFF.'],
      ['warn', 'Pin functions come from the label on the unit. The BR27 use column is a proposal; assign the outputs in the EMU client and check against the EMU Black manual before powering up.']
    ]);
    wiringDone = true;
  }
  function renderInputs() {
    $('inputsTable').innerHTML = `<thead><tr><th>Area</th><th>Input</th><th class="num">Value</th><th>Source</th></tr></thead><tbody>` +
      META.map(([g, k, n, u, src]) => {
        let v = params[k];
        if (k === 'battery') v = S.BATTERIES[v].label;
        if (k === 'canLayout') v = S.CAN_LAYOUTS[v].label;
        const tag = /assumption|verify|proposed|ask/.test(src) ? 'warn' : '';
        return `<tr><td>${g}</td><td>${n}</td><td class="num">${v}${u ? ' ' + u : ''}</td><td><span class="tag" style="${tag ? 'border-color:var(--warn)' : ''}">${src}</span></td></tr>`;
      }).join('') + '</tbody>';
    flags('openQs', [
      ['good', 'Battery: NOCO NLP14, a 4S LiFePO4 (12.8 V, 4 Ah, 500 A), so it suits the 14.2–14.6 V charging system. Its internal resistance and BMS current limit are estimates; measure cranking voltage on the car.'],
      ['warn', 'Bitrate: everything is on one CAN 2.0 bus (decided). With no suspension pots and the IMU and GPS kept off CAN, it runs about 24 % at 1 Mbps. 500 kbps would also work at about 49 %, but leaves little room for added channels, so 1 Mbps is still recommended.'],
      ['info', 'Node MCU: the corner nodes are modeled as generic CAN 2.0 nodes. Any MCU with a CAN 2.0B controller at 1 Mbps works; the final part is not chosen yet.'],
      ['warn', 'Engine: 2012 Honda CBR600RR (decided). Its stock 12-tooth crank and 3-tooth cam wheels are both VR. The model assumes the cam is cut to one sync tooth unless the EMU Black has a decoder for the stock cam; confirm with a scope. Stock secondary injectors are not used.'],
      ['warn', 'EMU Black brown-out voltage and stream frame count: confirm with Ecumaster docs or the bench.'],
      ['info', 'Stator output, starter current and battery internal resistance should be measured once parts are in hand. Each one moves the cranking and charging results.']
    ]);
  }

  // ------------------------------------------------------------ CAD (STL) import
  // Files and settings are kept by the Python server (br27sim/cad.py), outside the app folder.
  let CAD = null;
  const partName = id => (window.BRCar.PARTS.find(p => p.id === id) || { name: id }).name;
  function setTrunks() {
    params.trunkPtM = +(RM.pt * ROUTE_ALLOWANCE).toFixed(1);
    params.trunkChM = +(RM.ch * ROUTE_ALLOWANCE).toFixed(1);
    params.trunkAllM = +(RM.all * ROUTE_ALLOWANCE).toFixed(1);
  }
  function applyCad(cad, rerun) {
    CAD = cad;
    window.BRCar.setPositions(cad.positions);
    setTrunks();
    if (car) car.setCad(cad).catch(e => window.BRShowError && window.BRShowError('the CAD view', e));
    renderCadPanel();
    if (rerun) schedule();
  }
  async function cadPost(url, body) {
    const r = await fetch(url, { method: 'POST', body: body instanceof ArrayBuffer ? body : JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
  const cadChange = change => cadPost('/api/cad/update', change).then(c => applyCad(c, true)).catch(e => alert('CAD: ' + e.message));
  function guessRole(name) {
    const n = name.toLowerCase();
    if (/frame|chassis|spaceframe/.test(n)) return 'frame';
    const words = { engine: /engine|cbr|motor/, battery: /batt|nlp14|noco/, ecu: /ecu|emu/, dash: /dash|display|screen/, regulator: /reg/,
      nodeFL: /node.?fl|fl.?node/, nodeFR: /node.?fr|fr.?node/, nodeRL: /node.?rl|rl.?node/, nodeRR: /node.?rr|rr.?node/, imu: /imu/, gps: /gps/,
      pms: /pms|master/, breaker: /breaker/, cms: /cms|cockpit/, bots: /bots|overtravel/, inertia: /inertia/, brakeLight: /brake.?light/ };
    for (const [id, re] of Object.entries(words)) if (re.test(n)) return id;
    return 'other';
  }
  function renderCadPanel() {
    if (!CAD) return;
    const st = CAD.settings;
    $('cadUnits').value = st.units; $('cadUp').value = st.up; $('cadFwd').value = st.forward; $('cadHide').checked = !!st.hidePlaceholder;
    ['cadOx', 'cadOy', 'cadOz'].forEach((id, i) => { $(id).value = (+st.offset[i]).toFixed(3); });
    const roles = [['frame', 'Frame / chassis'], ['other', 'Other (display only)']].concat(window.BRCar.PARTS.map(p => [p.id, p.name]));
    const opts = r => roles.map(([v, l]) => `<option value="${v}"${v === r ? ' selected' : ''}>${l}</option>`).join('');
    const xyz = a => a.map(v => fmt(v, 2)).join(', ');
    let rows = CAD.files.map(f => `<tr><td class="mono">${f.name.replace(/</g, '&lt;')}</td><td><select data-file="${f.name}">${opts(f.role)}</select></td>` +
      `<td class="num">${f.triangles.toLocaleString()}</td><td class="mono">${f.size.map(v => fmt(v, 2)).join(' × ')}</td><td class="mono">${xyz(f.center)}</td><td class="num">${fmt(f.volumeL, 2)}</td>` +
      `<td><button type="button" data-remove="${f.name}">Remove</button></td></tr>`).join('');
    for (const id of CAD.placed || []) rows += `<tr><td>${partName(id)}</td><td>placed by hand</td><td></td><td></td><td class="mono">${xyz(CAD.positions[id])}</td><td></td><td><button type="button" data-unplace="${id}">Reset</button></td></tr>`;
    $('cadTable').innerHTML = `<thead><tr><th>File / part</th><th>Role</th><th class="num">Triangles</th><th>Size (m)</th><th>Centre x, y, z (m)</th><th class="num">Volume (L)</th><th></th></tr></thead><tbody>` +
      (rows || '<tr><td colspan="7">No CAD imported yet. The 3D car uses placeholder positions.</td></tr>') + '</tbody>';
    $('cadDir').textContent = `CAD files are stored ${window.BR27_LOCAL ? 'in this browser on this device' : 'in ' + CAD.dir} (kept across updates). Axes: +x forward, +y up, +z to the driver's right, metres.`;
  }
  function bindCad() {
    $('cadFiles').addEventListener('change', async e => {
      const files = [...e.target.files];
      e.target.value = '';
      try {
        let c = null;
        for (const f of files) {
          $('cadPlaceText').textContent = `Importing ${f.name}…`;
          c = await cadPost(`/api/cad/upload?name=${encodeURIComponent(f.name)}&role=${guessRole(f.name)}`, await f.arrayBuffer());
        }
        $('cadPlaceText').textContent = '';
        if (c) applyCad(c, true);
      } catch (err) { $('cadPlaceText').textContent = ''; alert('CAD import failed: ' + err.message); }
    });
    const settings = () => cadChange({ settings: { units: $('cadUnits').value, up: $('cadUp').value, forward: $('cadFwd').value,
      offset: ['cadOx', 'cadOy', 'cadOz'].map(id => +$(id).value || 0), hidePlaceholder: $('cadHide').checked } });
    ['cadUnits', 'cadUp', 'cadFwd', 'cadOx', 'cadOy', 'cadOz', 'cadHide'].forEach(id => $(id).addEventListener('change', settings));
    $('cadCenter').addEventListener('click', () => cadChange({ centerFrame: true }));
    $('cadTable').addEventListener('change', e => { const s = e.target.closest('select[data-file]'); if (s) cadChange({ file: s.dataset.file, role: s.value }); });
    $('cadTable').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.remove && confirm(`Remove ${b.dataset.remove} from the simulator?`)) cadChange({ remove: b.dataset.remove });
      if (b.dataset.unplace) cadChange({ position: { part: b.dataset.unplace, xyz: null } });
    });
    $('cadPlace').addEventListener('click', () => {
      if (!car) return;
      $('cadPlaceText').textContent = `Tap a spot on the car for: ${partName(selectedPart)}.`;
      car.startPlacing(pt => { $('cadPlaceText').textContent = ''; cadChange({ position: { part: selectedPart, xyz: pt } }); });
    });
  }
  function loadCad() {
    fetch('/api/cad').then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then(c => { bindCad(); applyCad(c, true); })
      .catch(() => { const c = $('cadCard'); if (c) c.hidden = true; }); // static page without the Python server
  }

  // ------------------------------------------------------------ theme + boot
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const retheme = () => { C.resetAll(); if (car) car.setTheme(); renderView(currentView); };
  mq.addEventListener && mq.addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  bindInputs();
  bindComponents();
  syncDash = bindDash();
  FMT.rSpeed = v => `${v}`;
  makeEditable();
  function showUnits() {
    document.querySelectorAll('.su').forEach(e => { e.textContent = SU(); });
    document.querySelectorAll('.tu').forEach(e => { e.textContent = TU(); });
    document.querySelectorAll('.lu').forEach(e => { e.textContent = LU(); });
    document.querySelectorAll('.pu').forEach(e => { e.textContent = PU(); });
    $('unitSys').value = UNITSYS;
    syncers.forEach(f => f());
    const amb = params.ambientC; ['o_p_ambientC', 'o_p_ambientC2'].forEach(id => { if ($(id)) $(id).textContent = tp(amb); });
  }
  $('unitSys').addEventListener('input', () => {
    UNITSYS = $('unitSys').value; SPD = IMP() ? 'mph' : 'kmh';
    try { localStorage.setItem('br27.units', UNITSYS); } catch (e) { /* storage blocked */ }
    showUnits();
    if (R.lap) renderChips();
    if (harness3d) harness3d.setUnits && harness3d.setUnits();
    renderView(currentView);
  });
  showUnits();
  window.addEventListener('hashchange', route);
  if (window.Chart) { Chart.defaults.font.family = C.css('--f-body'); }
  runModel();
  route();
  loadCad();
})();
