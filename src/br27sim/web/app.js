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
    ambientC: v => `${v} °C`, soc0: v => `${v} %`, cableMOhm: v => `${v}`, starterA: v => `${v}`, regSet: v => `${(+v).toFixed(1)} V`,
    regFaultMin: v => `${v} min`, mainBreakerA: v => `${v} A`, stagingMin: v => `${v}`, emuFrames: v => `${v}`, extraFrames: v => `${v}`, dashFwdFrames: v => `${v}`, dashFwdHz: v => `${v} Hz`, stubM: v => `${(+v).toFixed(2)}`
  };
  const batSel = $('p_battery');
  batSel.innerHTML = Object.entries(S.BATTERIES).map(([k, b]) => `<option value="${k}">${b.label}</option>`).join('');

  function bindInputs() {
    document.querySelectorAll('[id^="p_"]').forEach(el => {
      let key = el.id.slice(2);
      if (key === 'ambientC2') key = 'ambientC';
      const v = params[key];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
      const out = $('o_' + el.id);
      const show = () => { if (out) out.textContent = (UNITS[key] || (x => x))(el.value); };
      show();
      el.addEventListener('input', () => {
        let val = el.type === 'checkbox' ? el.checked : el.value;
        if (el.type === 'range' || /^(bitrate|fdDataRate|emuRate|ber)$/.test(key)) val = +val;
        params[key] = val;
        if (key === 'ambientC') { $('p_ambientC').value = val; $('p_ambientC2').value = val; $('o_p_ambientC').textContent = `${val} °C`; $('o_p_ambientC2').textContent = `${val} °C`; }
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
      chip('Coolant max', `${fmt(power.stats.maxCoolant, 0)} °C`, power.stats.maxCoolant > 110 ? 'crit' : power.stats.maxCoolant > 102 ? 'warn' : 'good', 'power'),
      chip('Injector duty', `${fmt(lap.stats.maxDuty, 0)} %`, lap.stats.maxDuty > 85 ? 'crit' : lap.stats.maxDuty > 75 ? 'warn' : 'good', 'engine'),
      chip(R.cans.length > 1 ? 'Busiest CAN bus' : 'CAN load', `${fmt(maxLoad, 1)} %`, maxLoad > 70 ? 'crit' : maxLoad > 50 ? 'warn' : 'good', 'can'),
      chip('CAN setup', issues ? `${issues} issue${issues > 1 ? 's' : ''}` : 'OK', issues ? 'crit' : 'good', 'can'),
      chip('Shutdown', sd.engineRuns ? 'closed' : 'open', sd.engineRuns ? 'good' : 'warn', 'shutdown')
    ];
    $('chips').innerHTML = out.join('');
  }

  // ------------------------------------------------------------ routing
  const VIEWS = ['car', 'engine', 'power', 'shutdown', 'can', 'faults', 'wiring', 'inputs'];
  let currentView = 'car';
  function route() {
    const h = location.hash.replace('#', '');
    currentView = VIEWS.includes(h) ? h : 'car';
    for (const v of VIEWS) $('v-' + v).hidden = v !== currentView;
    document.querySelectorAll('nav.tabs a').forEach(a => a.setAttribute('aria-current', a.getAttribute('href') === '#' + currentView ? 'page' : 'false'));
    if (currentView === 'engine') startEngineAnim(); else stopEngineAnim();
    if (car) { if (currentView === 'car') car.resume(); else car.pause(); }
    renderView(currentView);
  }
  function renderView(v) {
    if (!R.lap) return;
    try { renderViewInner(v); } catch (e) { console.error(e); window.BRShowError && window.BRShowError('the ' + v + ' tab', e); }
  }
  function renderViewInner(v) {
    ({ car: renderCar, engine: renderEngine, power: renderPower, shutdown: renderShutdown, can: renderCan, faults: renderFaults, wiring: renderWiring, inputs: renderInputs })[v]();
  }

  const kv = (id, items) => { $(id).innerHTML = items.map(([k, v, cls]) => `<div><span>${k}</span><b class="${cls || ''}">${v}</b></div>`).join(''); };
  const flags = (id, items) => { $(id).innerHTML = items.map(([lvl, t]) => `<li class="${lvl}">${t}</li>`).join(''); };
  const xy = (xs, ys, step) => { const o = []; step = step || 1; for (let i = 0; i < xs.length; i += step) o.push({ x: xs[i], y: ys[i] }); return o; };

  // ------------------------------------------------------------ car view
  let car = null, selectedPart = 'battery';
  function partText(id) {
    const { lap, power, can } = R;
    const crank = power.crank;
    const T = {
      engine: `Mock 2012 Honda CBR600RR, 599 cc inline-four, firing order 1-2-4-3, on a 20 mm restrictor (IC.1.6). Model makes about ${fmt(lap.stats.peakHp, 0)} hp at ${lap.stats.peakRpm} rpm and burns ${fmt(lap.stats.fuelPerLapL * 1000, 0)} mL per lap. Open the Engine tab to watch it fire.`,
      ecu: `EMU Black under the seat. It drives 4 injectors (peak duty ${fmt(lap.stats.maxDuty, 0)} %) and 4 coils, reads the stock 12-tooth crank wheel and a cam sync tooth at up to ${fmt(lap.stats.toothHzMax / 1000, 1)} kHz, and terminates one end of the classic CAN powertrain bus. It is fed after the master switch but ahead of the kill relay, so it keeps logging when the shutdown circuit opens.`,
      battery: `${power.bat.label}. Cranking pulls it to ${fmt(crank.minV, 1)} V at the inrush peak. It ends the endurance run at ${fmt(power.stats.endSoc, 0)} % charge. With the regulator dead it would run the car for about ${fmt(power.stats.noChargeMin, 0)} minutes.`,
      breaker: `Manual-reset ${params.mainBreakerA} A main breaker between the battery and the master switch. All battery current goes through it. Cranking heats it to ${fmt(power.stats.breakerPeakPct, 0)} % of its trip point.`,
      regulator: `Series MOSFET regulator in the sidepod airflow, set to ${fmt(params.regSet, 1)} V. Its output goes through the second pole of the master switch onto the switched bus. Average heat is about ${fmt(power.stats.regHeatW, 0)} W. Stator gives about 10 A at idle and 26 A at 5000 rpm (charging form, verify).`,
      dash: `Custom dash and dash MCU at the front. The MCU terminates the far end of the CAN 2.0 bus and is the logger. It reads the IMU and GPS directly and stores them without putting them on CAN (a LoRa link to the pit would also hang off the MCU, not the bus). As logger it records every frame on the bus and sends shared values the nodes need (fused speed, gear, rpm, lap and logging state) back out on IDs 0x140+. It also shows the charging warnings (below 12.8 V above 3000 rpm, above 15.0 V any time).`,
      imu: `IMU next to the dash, wired to the dash MCU. It is about ${fmt(window.BRCar.P.imu[0] + 0.15, 2)} m ahead of the CG, so yaw rate adds false lateral and longitudinal g: at 1.1 rad/s in a tight corner that is about ${fmt(1.1 * 1.1 * (window.BRCar.P.imu[0] + 0.15) / 9.81, 2)} g. Log the offset and correct it in post, or mount the IMU near the CG.`,
      gps: `GPS antenna by the dash with a clear view of the sky, wired to the dash MCU, logged at 20 Hz.`,
      nodeFL: `Corner node FL at the front-left suspension pickup: wheel speed, front brake pressure, steering angle (no suspension pots on this car). MCU (final part not chosen) with an LT8609S 5 V supply, on the CAN 2.0 bus.`,
      nodeFR: `Corner node FR: wheel speed, plus spare channels.`,
      brakeF: `Front brake pressure sensor (0–100 bar, 0.5–4.5 V) in the front circuit, read by node FL at 200 Hz. Peak about ${fmt(R.lap.stats.maxBrakeF, 0)} bar on this lap.`,
      brakeR: `Rear brake pressure sensor in the rear circuit, read by node RL at 200 Hz. Peak about ${fmt(R.lap.stats.maxBrakeR, 0)} bar on this lap.`,
      brakeLight: `Brake light on the rear centerline between wheel centre and shoulder height (T.3.4.2). Driven by node RL from brake pressure, on for ${fmt(R.lap.stats.brakeLightPct, 0)} % of the lap. Its state goes out on CAN as frame 0x0A0.`,
      nodeRL: `Corner node RL: wheel speed, rear brake pressure, and it drives the brake light. In the CAN FD what-if it is the far end of the chassis bus; on the CAN 2.0 bus it is a stub with no terminator.`,
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
      $('routeText').textContent = 'One bus from the EMU Black under the seat, back to RL and RR, up the right side to FR and FL, and on to the dash. The EMU and the dash are the two ends.';
    }
    const buses = S.CAN_LAYOUTS[params.canLayout].buses;
    const items = [];
    buses.forEach((b, i) => {
      const ph = R.phys[i];
      items.push([`${b === 'pt' ? 'EMU bus' : b === 'ch' ? 'FD bus' : 'Bus'} length`, `${fmt(ph.trunk, 1)} m`, ph.trunk > ph.maxLen ? 'bad' : 'ok']);
      items.push([`${b === 'pt' ? 'EMU bus' : b === 'ch' ? 'FD bus' : 'Bus'} load`, `${fmt(R.cans[i].stats.load, 0)} %`, R.cans[i].stats.load > 50 ? 'meh' : 'ok']);
    });
    items.push(['Length basis', '3D path × 1.25']);
    kv('routeKv', items);
    const bat = R.power.bat;
    const f = [];
    if (bat.chem !== 'agm') f.push(['warn', 'A lithium battery under the seat is inside the driver compartment. T.1.8.1 needs a firewall between the driver and any lithium battery, and T.1.8.4 needs that face to be grounded aluminum. Plan an aluminum box or tray under the seat, or move the battery behind the main hoop firewall.']);
    f.push(['info', 'Battery must sit below the shoulder belt mount height and be mounted to structure strong enough for suspension loads (T.9.2.1). Under the seat meets the height part.']);
    f.push(['info', 'The EMU Black under the seat is close to the CG and away from engine heat, but its harness to the injectors, coils and crank sensor passes through the firewall: use grommets (T.1.8).']);
    f.push(['warn', 'The IMU by the dash sits well ahead of the CG. The sensor mounting form wanted it within 150 mm of the CG. Either mount it near the CG on its own wire or correct the lever arm in post-processing.']);
    f.push(['info', 'Corner nodes sit inboard of each wheel, so sensor leads to the wheel speed sensor stay under 1 m (sensor mounting form guideline).']);
    f.push(['info', 'Component positions are rough placeholders until chassis CAD exists.']);
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
      ['Lap time', `${fmt(st.lapTime, 1)} s`], ['Average speed', `${fmt(st.avgKmh, 0)} km/h`], ['Top speed', `${fmt(st.maxKmh, 0)} km/h`],
      ['Peak power', `${fmt(st.peakHp, 0)} hp @ ${st.peakRpm}`], ['Full throttle', `${fmt(st.wotPct, 0)} % of lap`],
      ['Fuel per lap', `${fmt(st.fuelPerLapL * 1000, 0)} mL`], ['Max injector duty', `${fmt(st.maxDuty, 0)} %`, st.maxDuty > 85 ? 'bad' : 'ok'],
      ['Max tooth rate', `${fmt(st.toothHzMax / 1000, 2)} kHz`]
    ]);
    const step = 5;
    const o = { xTitle: 'Time (s)', xMin: 0, xMax: st.lapTime };
    C.draw('c_speed', [{ label: 'Speed', data: xy(s.t, s.v, step), color: '--s1' }], o);
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
    C.draw('c_cool', [{ label: 'Coolant', data: xy(s.t, s.cool), color: '--s2' }], Object.assign({ refs: [{ y: params.fanOnC, label: 'fan on' }] }, o, { bands: [] }));
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

  // ------------------------------------------------------------ inputs view
  const META = [
    ['Vehicle', 'massKg', 'Car + driver mass', 'kg', 'assumption'], ['Vehicle', 'tireD', 'Loaded tire diameter', 'm', 'Sample Rates form'],
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
      ['info', `Run all engine-bay wires through one bulkhead connector in the firewall, about ${Wr.bulkheadCount()} circuits.`],
      ['info', 'Fuel system: the pump relay (G13) and the injectors take +12 V from the kill bus, so any shutdown switch stops fuel. The float fuel level sender reads on Analog #5 (B35) through a 470 Ω pull-up (R1) to +5 V, about 0.33 V full to 1.69 V empty; the EMU sends it to the dash over CAN.'],
      ['info', 'CAN: the EMU is one end of the bus. Put 120 Ω across B12 and B25 at the EMU; the other 120 Ω goes at the dash MCU.'],
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

  // ------------------------------------------------------------ theme + boot
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const retheme = () => { C.resetAll(); if (car) car.setTheme(); renderView(currentView); };
  mq.addEventListener && mq.addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  bindInputs();
  window.addEventListener('hashchange', route);
  if (window.Chart) { Chart.defaults.font.family = C.css('--f-body'); }
  runModel();
  route();
})();
