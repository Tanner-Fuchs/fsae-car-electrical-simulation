// Mock dash computer: the 5 in 800 x 480 screen as the driver sees it. It boots with a Bobcat Racing
// splash and goes straight to the dash. Button 1 (MODE) steps through the driver's display modes
// (Driver Dash Preferences sheet: Endurance, Check tires, Debug, Autocross), button 2 (CLEAR) clears a
// warning, and MENU opens CAN data, fault log, logging, system load, LoRa and settings.
// It plays a simulated session of laps; a session can script faults. Faults outrank everything on
// the screen: a new critical or warning fault takes the whole display, even over the menu.
// Oil, water, fuel and tire numbers are mock signals (the lap model has no oil or tire model).
// window.BRDashOS.mount(el, U, hooks) returns { set(pi, lap, extra), start(), stop(), press(btn), reboot(), scenario(k) }.
(function () {
  'use strict';
  const fmt = (x, d) => (x == null || !isFinite(x) ? '–' : Number(x).toFixed(d));
  const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0');
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const MAROON = '#501214', GOLD = '#c9a86a', GOLD2 = '#e6cf9b', RED = '#ef4444', AMB = '#f59e0b', GRN = '#22c55e';
  const MODES = ['ENDURANCE', 'CHECK TIRES', 'DEBUG', 'AUTOCROSS'];
  const MENU = ['CAN data', 'Fault log', 'Logging', 'System', 'LoRa telemetry', 'Settings', 'Back to dash'];
  const T = (x, y, txt, size, o) => `<text x="${x}" y="${y}" font-size="${size}" ${o || ''}>${txt}</text>`;
  const MONO = 'font-family="var(--f-mono)"', DISP = 'font-family="var(--f-display)"';
  const SESSION_LAPS = 5;

  // Fault codes match the Faults tab; BR-W12 (fuel pressure), BR-W13 and BR-W14 (tire temps) are new, proposed.
  // Tire limits [assumption]: whole tire over 100 °C, or inner and outer more than 15 °C apart (needs the I/C/O option).
  const CORNERS = ['FL', 'FR', 'RL', 'RR'];
  const hotTire = (s, U) => { const k = s.tires.reduce((a, x, n) => (x.c > s.tires[a].c ? n : a), 0); return `${CORNERS[k]} ${U.tp(s.tires[k].c)}`; };
  const edgeTire = (s, U) => {
    const k = s.tires.reduce((a, x, n) => (Math.abs(x.z[0] - x.z[2]) > Math.abs(s.tires[a].z[0] - s.tires[a].z[2]) ? n : a), 0), z = s.tires[k].z;
    return `${CORNERS[k]} ${z[0] > z[2] ? 'inner' : 'outer'} ${U.tp(Math.max(z[0], z[2]))}`;
  };
  const FAULTS = {
    'BR-C01': { sev: 'critical', name: 'LOW OIL PRESSURE', test: s => s.oilP < 1.0 && s.rpm > 3000, val: (s, U) => U.pr(s.oilP) },
    'BR-C02': { sev: 'critical', name: 'COOLANT OVER TEMP', test: s => s.waterC > 110, val: (s, U) => U.tp(s.waterC) },
    'BR-C03': { sev: 'critical', name: 'BATTERY OVER-VOLTAGE', test: s => s.volts > 15.0, val: s => `${fmt(s.volts, 1)} V` },
    'BR-W01': { sev: 'warning', name: 'NOT CHARGING', test: s => s.volts < 12.8 && s.rpm > 3000, val: s => `${fmt(s.volts, 1)} V` },
    'BR-W02': { sev: 'warning', name: 'LEAN AT FULL THROTTLE', test: s => s.lam > 0.95 && s.map > 85, val: s => `λ ${fmt(s.lam, 2)}` },
    'BR-W03': { sev: 'warning', name: 'CORNER NODE OFFLINE', test: s => !!s.nodeOff, val: s => `node ${s.nodeOff}` },
    'BR-W09': { sev: 'warning', name: 'BRAKE SENSOR FAULT', test: s => !!s.brakeSensorFault, val: () => 'rear sensor open' },
    'BR-W10': { sev: 'warning', name: 'LOW FUEL', test: s => s.fuelL < 1.0, val: s => `${fmt(s.fuelL, 2)} L` },
    'BR-W12': { sev: 'warning', name: 'LOW FUEL PRESSURE', test: s => s.fuelP < 2.8 && s.rpm > 2000, val: (s, U) => U.pr(s.fuelP) },
    'BR-W13': { sev: 'warning', name: 'TIRE OVERHEAT', test: s => s.tires.some(x => x.c > 100), val: (s, U) => hotTire(s, U) },
    'BR-W14': { sev: 'warning', name: 'TIRE EDGE HOT', test: s => s.zonesOn && s.tires.some(x => Math.abs(x.z[0] - x.z[2]) > 15), val: (s, U) => edgeTire(s, U) },
    'BR-I01': { sev: 'info', name: 'SD WRITE STALL', test: s => !!s.sdStall, val: () => '> 250 ms' }
  };
  const RANK = { critical: 0, warning: 1, info: 2 };

  // Scripted sessions. Times are seconds into the session (5 laps of about 44 s).
  const SCENARIOS = {
    clean: { label: 'Clean laps (no faults)' },
    oil: { label: 'Oil pressure drops on lap 2 (BR-C01)', fx: (s, t) => { if (t > 62) s.oilP *= clamp(1 - (t - 62) / 12, 0.12, 1); } },
    overheat: { label: 'Coolant creeps up to overheating (BR-C02)', fx: (s, t) => { s.waterC += Math.max(0, t - 40) * 0.22; } },
    charging: { label: 'Regulator fails, battery runs down (BR-W01)', fx: (s, t) => { if (t > 45) s.volts = 13.1 - (t - 45) * 0.012 + 0.03 * Math.sin(t * 3); } },
    tires: {
      label: 'Tires overheat: FR whole tire, then FL inner edge (BR-W13, BR-W14)',
      fx: (s, t) => {
        const heat = (k, dz) => { const x = s.tires[k]; x.z = x.z.map((v, n) => v + dz[n]); x.c = (x.z[0] + x.z[1] + x.z[2]) / 3; };
        if (t > 40) heat(1, [1, 1, 1].map(() => Math.min(34, (t - 40) * 0.7)));                 // FR: too much pressure / sliding, whole tire
        if (t > 100) heat(0, [Math.min(26, (t - 100) * 0.8), Math.min(6, (t - 100) * 0.2), 0]);  // FL: too much negative camber, inner edge
      }
    },
    pileup: {
      label: 'Many faults at once (2 critical, 5 warnings, 1 info) to test the screen',
      fx: (s, t) => {
        if (t < 20) return;
        s.oilP *= 0.12; s.rpm = Math.max(s.rpm, 3500);
        s.waterC = Math.max(s.waterC, 113);
        s.volts = 12.4; s.nodeOff = 'RL'; s.fuelP = 2.4; s.lam = Math.max(s.lam, 0.97); s.map = Math.max(s.map, 90);
        s.tires[1].c += 30; s.tires[1].z = s.tires[1].z.map(v => v + 30);
        s.sdStall = (t % 10) < 3;
      }
    },
    mixed: {
      label: 'Endurance stint: several faults (W03, W02, W12, W09, W10, I01)', fuel0: 1.45,
      fx: (s, t) => {
        if (t > 30 && t < 30.6) s.sdStall = true;
        if (t > 40 && t < 44) s.nodeOff = 'FR';
        if (t > 95 && t < 101 && s.tps > 80) s.lam = 1.02;
        if (t > 118 && t < 128) s.fuelP = 2.4 + 0.1 * Math.sin(t * 9);
        if (t > 150 && t < 165) { s.brakeSensorFault = true; s.brakeR = null; }
      }
    }
  };

  const bobcat = op => window.BRSplash.bobcat(op);

  let mounts = 0;
  // fonts for the rasterized screen: an SVG drawn as an image can't see the page's web fonts, so embed them once (latin only)
  let FONT_CSS = '', fontsAsked = false;
  function screenCss() {
    if (!fontsAsked) { fontsAsked = true; loadFonts(); }
    const cs = getComputedStyle(document.documentElement), v = k => cs.getPropertyValue(k).trim();
    return `${FONT_CSS} svg { --f-mono: ${v('--f-mono') || 'monospace'}; --f-display: ${v('--f-display') || 'sans-serif'}; font-family: ${v('--f-body') || 'sans-serif'}; }`;
  }
  async function loadFonts() {
    try {
      const link = document.querySelector('link[href*="fonts.googleapis.com/css"]');
      if (!link) return;
      const css = await (await fetch(link.href)).text();
      const blocks = css.split('/* ').filter(b => b.startsWith('latin */'));
      const toData = async url => { const b = await (await fetch(url)).blob(); return await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); }); };
      let out = '';
      for (const b of blocks) {
        const m = b.match(/url\(([^)]+)\)/);
        if (!m) continue;
        out += b.replace('latin */', '').replace(m[1], await toData(m[1]));
      }
      FONT_CSS = out;
    } catch (e) { /* offline: the rasterized screen falls back to system fonts */ }
  }
  function mount(el, U, hooks) {
    hooks = hooks || {};
    const UID = 'd' + (++mounts);              // unique SVG ids when more than one dash is on the page
    let PI = null, LAP = null, X = {}, cum = null, t = 0, last = 0, raf = 0, running = false, lastDraw = 0;
    let phase = 'boot', bootT = 0, mode = 0, menuIdx = 0, page = null, pageIdx = 0, logging = true, logStartT = 0, logBytes = 0;
    let scen = 'clean', lastSig = null;
    const fs = {};                       // per fault: { since, lastTrue, acked, ackT }
    const history = [];                  // fault log: { t, code, on }
    const set = { shiftRpm: 12500, bright: 100, speedUnit: null, bootMode: 0 };
    el.innerHTML = `<div class="dev">
        <div class="dev-bezel"><div class="dev-glass"><canvas class="dev-px" hidden></canvas><svg class="dev-scr" viewBox="0 0 800 480" role="img" aria-label="Mock 5 inch dash screen"></svg></div></div>
        <div class="dev-btns">
          <button type="button" data-btn="mode"><b>MODE</b><span>button 1 · display / down</span></button>
          <button type="button" data-btn="clear"><b>CLEAR</b><span>button 2 · clear warning / back</span></button>
          <button type="button" data-btn="menu"><b>MENU</b><span>open / select</span></button>
        </div>
      </div>`;
    const scr = el.querySelector(".dev-scr");
    el.querySelectorAll('[data-btn]').forEach(b => b.addEventListener('click', () => api.press(b.dataset.btn)));
    scr.addEventListener('click', e => {
      const tb = e.target.closest('[data-touch]');
      if (tb) { api.press(tb.dataset.touch); return; }
      const hit = e.target.closest('[data-tap]'); if (!hit) return;
      if (phase === 'menu') { menuIdx = +hit.dataset.tap; api.press('menu'); }
      else if (phase === 'page' && page === 'Settings') { pageIdx = +hit.dataset.tap; api.press('menu'); }
    });

    const S = () => LAP.series;
    const lapT = () => t % LAP.lapTime;
    const idx = () => Math.floor(lapT() * LAP.fs) % S().t.length;
    const lapNo = () => Math.min(SESSION_LAPS, Math.floor(t / LAP.lapTime) + 1);
    const imp = () => (set.speedUnit ? set.speedUnit === 'mph' : U.SU() === 'mph');
    const spd = kmh => (imp() ? kmh / 1.609344 : kmh), su = () => (imp() ? 'mph' : 'km/h');
    const tv = c => (U.IMP() ? c * 9 / 5 + 32 : c);
    const pr = bar => (bar == null ? '—' : U.IMP() ? `${fmt(bar * 14.5038, 0)} psi` : `${fmt(bar, 1)} bar`);
    const UU = { tp: U.tp, pr };
    const bootLen = () => clamp(PI.sel.bootS * 0.35, 1.6, 5);
    const lapTxt = s => `${Math.floor(s / 60)}:${fmt(s % 60, 2).padStart(5, '0')}`;

    // ---------------------------------------------------------------- signals for this instant
    function signals(i) {
      const s0 = S(), rpm = s0.rpm[i];
      const fuel0 = (SCENARIOS[scen].fuel0 != null ? SCENARIOS[scen].fuel0 : 3.0);       // litres at the start [assumption]
      const used = cum[i] + Math.floor(t / LAP.lapTime) * cum[cum.length - 1];
      const warm = 1 - Math.exp(-t / 90);
      const s = {
        rpm, v: s0.v[i], gear: s0.gear[i], tps: s0.tps[i], lam: s0.lam[i], map: s0.map[i], duty: s0.duty[i],
        brakeF: s0.brakeF[i], brakeR: s0.brakeR[i], brakeLight: s0.brakeLight[i],
        oilP: clamp(0.8 + 4.1 * rpm / 6000, 0, 5.6) + 0.05 * Math.sin(t * 7),     // about 4.9 bar at 6000 rpm (CBR600RR spec) [assumption]
        oilC: 70 + 32 * warm + 2 * Math.sin(t / 9),
        waterC: 70 + 20 * warm + 2 * Math.sin(t / 7),
        volts: (rpm > 2500 ? 14.3 : 13.1) + 0.04 * Math.sin(t * 3),
        fuelP: 3.43 + 0.04 * Math.sin(t * 11),                                  // 343 kPa regulated (CBR600RR spec) [assumption]
        fuelL: Math.max(0, fuel0 - used),
        zonesOn: !!PI.o.tireZones,
        tires: [0, 1, 2, 3].map(k => {
          const warmT = 1 - Math.exp(-t / 70), c = 32 + (42 + (k < 2 ? 5 : 0) + 3 * Math.sin(k)) * warmT + 1.5 * Math.sin(t / 5 + k);
          const camb = (k < 2 ? 9 : 4) * warmT, load = 3 * Math.sin(t / 4 + (k % 2) * Math.PI) * warmT;   // negative camber: inner hotter; corners load the outside [mock]
          return { c, psi: 10 + (c - 32) / 30 * 2.4, z: [c + camb / 2 - load / 2, c + 1.5 * warmT, c - camb / 2 + load] };   // inner, centre, outer
        }),
        wheels: [0, 1, 2, 3].map(k => s0.v[i] * (1 + 0.012 * Math.sin(t * 0.9 + k * 1.3)))
      };
      if (SCENARIOS[scen].fx) SCENARIOS[scen].fx(s, t);
      s.biasPct = s.brakeF > 1 && s.brakeR != null ? s.brakeF / (s.brakeF + s.brakeR) * 100 : X.biasPct;
      return s;
    }

    // ---------------------------------------------------------------- faults
    function updateFaults(s) {
      for (const [code, f] of Object.entries(FAULTS)) {
        const st = fs[code] || (fs[code] = { active: false, lastTrue: -99, acked: false, ackT: 0 });
        if (f.test(s)) {
          st.lastTrue = t;
          if (!st.active) { st.active = true; st.acked = false; st.showT = null; st.since = t; history.push({ t, code, on: true }); }
        } else if (st.active && t - st.lastTrue > 3) {           // clears after 3 s without the condition
          st.active = false; st.acked = false; history.push({ t, code, on: false });
        }
      }
      if (history.length > 60) history.splice(0, history.length - 60);
    }
    const activeFaults = () => Object.keys(fs).filter(c => fs[c].active).sort((a, b) => RANK[FAULTS[a].sev] - RANK[FAULTS[b].sev] || (a < b ? -1 : 1));   // most important first: severity, then code (lower code = lower CAN ID)
    const POP_S = { warning: 1.5, critical: 8 };   // longest a fault fills the screen [Tanner 2026-11-05: yellow < 2 s, red < 10 s]
    function popup() {
      // highest priority fault that should fill the screen: not cleared yet, or a critical fault
      // that was cleared more than 15 s ago and is still there
      // it fills the screen for at most POP_S (yellow 1.5 s, red 8 s), then moves to the warning box by itself
      for (let n = 0; n < 8; n++) {
        const c = activeFaults().find(k => FAULTS[k].sev !== 'info' && (!fs[k].acked || (FAULTS[k].sev === 'critical' && t - fs[k].ackT > 15)));
        if (!c) return undefined;
        const st = fs[c];
        if (st.showT == null || st.showT > t) st.showT = t;
        if (t - st.showT < POP_S[FAULTS[c].sev]) return c;
        st.acked = true; st.ackT = t; st.showT = null;
      }
      return undefined;
    }

    // ---------------------------------------------------------------- drawing helpers
    // a paw print: main pad and four toe beans, fitted in a circle of radius r
    const paw = (cx, cy, r, col) => `<g fill="${col}"><ellipse cx="${cx}" cy="${cy + r * 0.32}" rx="${r * 0.52}" ry="${r * 0.42}"/>` +
      [[-0.62, -0.2], [-0.23, -0.6], [0.23, -0.6], [0.62, -0.2]].map(([u, v]) => `<ellipse cx="${(cx + u * r).toFixed(1)}" cy="${(cy + v * r).toFixed(1)}" rx="${r * 0.2}" ry="${r * 0.25}"/>`).join('') + '</g>';
    function shiftLights(rpm) {
      const n = 14, on = Math.round(clamp((rpm - (set.shiftRpm - 3500)) / 3500, 0, 1) * n), flash = rpm >= set.shiftRpm && Math.floor(t * 8) % 2;
      const tk = PI.o.touchButtons, x0 = tk ? 140 : 43, dx = tk ? 40 : 55, rr = tk ? 14 : 15;   // touch: lights sit between the corner keys
      let g = '<rect width="800" height="46" fill="#000"/>';
      for (let k = 0; k < n; k++) {
        const col = flash ? '#3b82f6' : k < on ? (k < 5 ? GRN : k < 10 ? AMB : RED) : '#1a1a1a', cx = x0 + k * dx;
        g += PI.o.revPaws ? paw(cx, 24, rr + 3, col) : `<circle cx="${cx}" cy="23" r="${rr}" fill="${col}"/>`;
      }
      return g;
    }
    function footer(s) {
      return `<rect y="456" width="800" height="24" fill="#0b0b0b"/>` + T(10, 473, MODES[mode], 13, `fill="${GOLD}" ${DISP} font-weight="700" letter-spacing="1"`) +
        T(200, 473, `LAP ${lapNo()}/${SESSION_LAPS} · ${lapTxt(lapT())}`, 13, `fill="#bbb" ${MONO}`) +
        `<circle cx="470" cy="468" r="5" fill="${RED}" opacity="${logging ? (Math.floor(t * 2) % 2 ? 1 : 0.35) : 0.15}"/>` + T(480, 473, logging ? 'LOG' : 'LOG OFF', 12, `fill="#ccc" ${MONO}`) +
        (PI.o.lora ? T(560, 473, 'LoRa', 12, `fill="${(t * PI.o.loraHz) % 1 < 0.3 ? GRN : '#666'}" ${MONO}`) : '') +
        T(790, 473, `CAN ${PI.fps}/s`, 12, `text-anchor="end" fill="${s.nodeOff ? AMB : GRN}" ${MONO}`);
    }
    function cell(x, y, w, h, label, val, col, big) {
      return `<rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="6" fill="#0f0f0f" stroke="#2a2a2a"/>` +
        T(x + 14, y + 24, label, 14, 'fill="#9aa4b1" letter-spacing="1"') + T(x + w / 2, y + h / 2 + (big || 34) / 2 + 8, val, big || 34, `text-anchor="middle" fill="${col || '#fff'}" ${MONO} font-weight="700"`);
    }
    const colTemp = (c, warn, crit) => (c >= crit ? RED : c >= warn ? AMB : '#fff');
    const sevCol = f => (f.sev === 'critical' ? RED : f.sev === 'warning' ? AMB : '#38bdf8');
    const cut = (txt, n) => (txt.length > n ? txt.slice(0, n - 1) + '…' : txt);
    function faultBox(x, y, w, h) {
      const act = activeFaults();
      if (!act.length) return cell(x, y, w, h, 'WARNINGS', 'none', '#3a3a3a', 24);
      const c = act[0], f = FAULTS[c], col = sevCol(f), blink = f.sev === 'critical' && Math.floor(t * 2) % 2 ? 0.75 : 1;
      if (act.length === 1) {
        return `<rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="6" fill="${col}" opacity="${blink}"/>` +
          T(x + 12, y + 26, `⚠ ${c}`, 15, `fill="#000" font-weight="700" ${MONO}`) +
          T(x + 12, y + 56, cut(f.name, 17), 17, 'fill="#000" font-weight="700"') + T(x + 12, y + 82, f.val(lastSig, UU), 17, `fill="#000" ${MONO}`);
      }
      // several at once: one row each, most important on top
      let g = `<rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="6" fill="#0f0f0f" stroke="${col}" stroke-width="2"/>`;
      if (h < 150) {
        // short box: the most important fault on top, the rest as code chips under it
        g += `<rect x="${x + 7}" y="${y + 7}" width="${w - 14}" height="30" rx="4" fill="${col}" opacity="${blink}"/>` +
          T(x + 13, y + 27, c.slice(3), 14, `fill="#000" font-weight="700" ${MONO}`) + T(x + 54, y + 27, cut(f.name, Math.floor((w - 70) / 8.6)), 14, 'fill="#000" font-weight="700"');
        const rest = act.slice(1), fit = Math.floor((w - 14) / 56), chips = rest.length > fit ? rest.slice(0, fit - 1) : rest;
        chips.forEach((k, i) => { g += `<rect x="${x + 7 + i * 56}" y="${y + 42}" width="52" height="26" rx="4" fill="${sevCol(FAULTS[k])}"/>` + T(x + 33 + i * 56, y + 60, k.slice(3), 13, `text-anchor="middle" fill="#000" font-weight="700" ${MONO}`); });
        if (chips.length < rest.length) g += T(x + 33 + chips.length * 56, y + 60, `+${rest.length - chips.length}`, 15, `text-anchor="middle" fill="#fff" font-weight="700" ${MONO}`);
        return g + T(x + 9, y + h - 14, `${act.length} active · MENU › Fault log`, 11.5, 'fill="#aaa"');
      }
      const rowH = 33, n = Math.floor((h - 12) / rowH), show = act.length > n ? n - 1 : act.length;
      const chars = Math.floor((w - 70) / 8.6);
      act.slice(0, show).forEach((k, i) => {
        const fk = FAULTS[k], ry = y + 6 + i * rowH;
        g += `<rect x="${x + 7}" y="${ry}" width="${w - 14}" height="${rowH - 3}" rx="4" fill="${sevCol(fk)}" opacity="${i === 0 ? blink : 1}"/>` +
          T(x + 13, ry + rowH * 0.66, k.slice(3), rowH > 24 ? 14 : 12, `fill="#000" font-weight="700" ${MONO}`) +
          T(x + 54, ry + rowH * 0.66, cut(fk.name, chars), rowH > 24 ? 14 : 12, 'fill="#000" font-weight="700"');
      });
      if (show < act.length) g += T(x + 13, y + 6 + show * rowH + rowH * 0.66, `+${act.length - show} more (MENU › Fault log)`, 12, 'fill="#ccc"');
      return g;
    }
    function faultBar() {
      const act = activeFaults();
      if (!act.length) return '';
      const c = act[0], f = FAULTS[c], rest = act.slice(1), chips = rest.slice(0, 4);
      let g = `<rect x="0" y="414" width="800" height="40" fill="${sevCol(f)}"/>` +
        T(14, 441, `⚠ ${c}  ${cut(f.name, rest.length ? 20 : 40)}  ${f.val(lastSig, UU)}`, rest.length ? 16 : 19, `fill="#000" font-weight="700" ${MONO}`);
      chips.forEach((k, i) => {
        const x = 800 - (chips.length - i) * 62 - (rest.length > 4 ? 44 : 4);
        g += `<rect x="${x}" y="419" width="58" height="30" rx="4" fill="${sevCol(FAULTS[k])}" stroke="#000" stroke-width="1.5"/>` + T(x + 29, 440, k.slice(3), 14, `text-anchor="middle" fill="#000" font-weight="700" ${MONO}`);
      });
      if (rest.length > 4) g += T(796, 440, `+${rest.length - 4}`, 15, `text-anchor="end" fill="#000" font-weight="700" ${MONO}`);
      return g;
    }

    // ---------------------------------------------------------------- the driver's modes
    function modeEndurance(s) {
      const tiresReady = s.tires.every(x => x.c >= 55);
      return shiftLights(s.rpm) +
        cell(0, 46, 250, 102, 'OIL P', pr(s.oilP), s.oilP < 1.0 ? RED : s.oilP < 1.5 ? AMB : '#fff') +
        cell(0, 148, 250, 102, 'OIL TEMP', U.tp(s.oilC), colTemp(s.oilC, 120, 130)) +
        cell(0, 250, 250, 102, 'WATER TEMP', U.tp(s.waterC), colTemp(s.waterC, 100, 110)) +
        faultBox(0, 352, 250, 104) +
        cell(250, 46, 300, 170, `SPEED (${su()})`, fmt(spd(s.v), 0), '#fff', 96) +
        cell(250, 216, 300, 160, 'GEAR', s.gear || 'N', '#fff', 120) +
        cell(250, 376, 300, 80, 'BRAKE BIAS', `${fmt(s.biasPct, 0)} % F`, '#fff', 28) +
        cell(550, 46, 250, 102, 'VOLTAGE', `${fmt(s.volts, 1)} V`, s.volts < 12.8 || s.volts > 15 ? AMB : '#fff') +
        cell(550, 148, 250, 102, 'FUEL LEVEL', `${fmt(s.fuelL, 2)} L`, s.fuelL < 1 ? AMB : '#fff') +
        cell(550, 250, 250, 102, 'FUEL P', pr(s.fuelP), s.fuelP < 2.8 ? AMB : '#fff') +
        cell(550, 352, 250, 104, 'TIRES', tiresReady ? 'READY ✓' : 'COLD', tiresReady ? GRN : '#60a5fa', 30) + footer(s);
    }
    // rev lights on top with the content scaled to fit under them: always on Check tires, and on Debug when the touch keys need the top corners
    const touchFit = (g, s, always) => (always || PI.o.touchButtons ? shiftLights(s.rpm) + `<g transform="translate(44 46) scale(0.89)">${g}</g>` : g);
    function modeTires(s) {
      let g = `<rect width="800" height="456" fill="#050505"/>`;
      g += T(20, 40, 'BRAKE BIAS', 16, 'fill="#9aa4b1" letter-spacing="1"') + T(20, 120, `${fmt(s.biasPct, 0)}%`, 76, `fill="#fff" font-weight="700" ${MONO}`) + T(20, 146, 'front', 16, 'fill="#9aa4b1"');
      g += T(20, 220, 'FRONT BRAKE P', 14, 'fill="#9aa4b1"') + T(20, 258, pr(s.brakeF), 32, `fill="#fff" ${MONO}`);
      g += T(20, 320, 'REAR BRAKE P', 14, 'fill="#9aa4b1"') + T(20, 358, s.brakeR == null ? 'FAULT' : pr(s.brakeR), 32, `fill="${s.brakeR == null ? AMB : '#fff'}" ${MONO}`);
      g += `<rect x="440" y="60" width="160" height="350" rx="70" fill="none" stroke="#555" stroke-width="3"/><line x1="470" y1="120" x2="570" y2="120" stroke="#333" stroke-width="2"/><line x1="470" y1="350" x2="570" y2="350" stroke="#333" stroke-width="2"/>`;
      const pos = [[392, 80, 'FL', 'end', 370], [608, 80, 'FR', 'start', 690], [392, 300, 'RL', 'end', 370], [608, 300, 'RR', 'start', 690]];
      pos.forEach(([x, y, nm, anchor, tx], k) => {
        const tr = s.tires[k], tcol = c => (c < 55 ? '#60a5fa' : c > 95 ? RED : GRN), col = tcol(tr.c);
        const heat = c => `hsl(${Math.round(240 * (1 - clamp((c - 50) / 50, 0, 1)))} 85% 50%)`;   // 50 °C blue → 100 °C red
      if (PI.o.tireZones) {
          // left tires: outer | centre | inner from left to right as seen from the seat; right tires mirrored
          const order = k % 2 === 0 ? [2, 1, 0] : [0, 1, 2], lab = ['I', 'C', 'O'];
          g += `<clipPath id="tz${UID}${k}"><rect x="${x}" y="${y}" width="40" height="90" rx="8"/></clipPath><g clip-path="url(#tz${UID}${k})" opacity="0.9">` +
            order.map((z, n) => `<rect x="${x + n * 40 / 3}" y="${y}" width="${40 / 3 + 0.5}" height="90" fill="${heat(tr.z[z])}"/>`).join('') + '</g>';
          const xs = k % 2 === 0 ? [266, 312, 358] : [680, 723, 766];
          g += T(k % 2 === 0 ? 370 : 690, y + 18, nm, 16, `text-anchor="${anchor}" fill="${GOLD}" font-weight="700"`);
          order.forEach((z, n) => { g += T(xs[n], y + 36, lab[z], 11, 'text-anchor="middle" fill="#9aa4b1"') + T(xs[n], y + 58, fmt(tv(tr.z[z]), 0), 20, `text-anchor="middle" fill="${tcol(tr.z[z]) === GRN ? '#fff' : tcol(tr.z[z])}" ${MONO} font-weight="700"`); });
          g += T(tx, y + 84, `${fmt(U.IMP() ? tr.psi : tr.psi / 14.5038, U.IMP() ? 1 : 2)} ${U.IMP() ? 'psi' : 'bar'}`, 18, `text-anchor="${anchor}" fill="#ccc" ${MONO}`);
          return;
        }
        g += `<rect x="${x}" y="${y}" width="40" height="90" rx="8" fill="${col}" opacity="0.85"/>`;
        g += T(tx, y + 18, nm, 16, `text-anchor="${anchor}" fill="${GOLD}" font-weight="700"`) + T(tx, y + 50, U.tp(tr.c), 26, `text-anchor="${anchor}" fill="#fff" ${MONO}`) +
          T(tx, y + 80, `${fmt(U.IMP() ? tr.psi : tr.psi / 14.5038, U.IMP() ? 1 : 2)} ${U.IMP() ? 'psi' : 'bar'}`, 20, `text-anchor="${anchor}" fill="#ccc" ${MONO}`);
      });
      g += (PI.o.tireZones ? T(400, 30, `tire temps ${U.IMP() ? '°F' : '°C'}: I inner · C centre · O outer`, 13, 'text-anchor="middle" fill="#9aa4b1"') : '') + T(400, 440, 'tire pressure / temperature: mock values until sensors are chosen', 12, 'text-anchor="middle" fill="#555"');
      return touchFit(g, s, true) + faultBar() + footer(s);
    }
    function modeDebug(s) {
      const items = [
        ['RPM', fmt(s.rpm, 0)], ['SPEED', `${fmt(spd(s.v), 1)} ${su()}`], ['GEAR', s.gear || 'N'], ['TPS', `${fmt(s.tps, 0)} %`],
        ['MAP', `${fmt(s.map, 0)} kPa`], ['LAMBDA', fmt(s.lam, 2)], ['INJ DUTY', `${fmt(s.duty, 0)} %`], ['VOLTAGE', `${fmt(s.volts, 2)} V`],
        ['OIL P', pr(s.oilP)], ['OIL TEMP', U.tp(s.oilC)], ['WATER', U.tp(s.waterC)], ['FUEL P', pr(s.fuelP)],
        ['FUEL LEVEL', `${fmt(s.fuelL, 2)} L`], ['BRAKE F', pr(s.brakeF)], ['BRAKE R', s.brakeR == null ? 'FAULT' : pr(s.brakeR)], ['BIAS', `${fmt(s.biasPct, 1)} %`],
        ['WS FL', fmt(spd(s.wheels[0]), 1)], ['WS FR', s.nodeOff === 'FR' ? 'OFFLINE' : fmt(spd(s.wheels[1]), 1)], ['WS RL', fmt(spd(s.wheels[2]), 1)], ['WS RR', fmt(spd(s.wheels[3]), 1)],
        ...['FL', 'FR', 'RL', 'RR'].map((nm, k) => [PI.o.tireZones ? `TIRE ${nm} I/C/O` : `TIRE ${nm}`, PI.o.tireZones ? s.tires[k].z.map(c => fmt(tv(c), 0)).join('/') : U.tp(s.tires[k].c)]),
        ['CAN', `${PI.fps}/s`], ['CPU', `${fmt(PI.sel.busiest, 0)} % max`], ['RAM', `${fmt(PI.sel.ramPct, 0)} %`], ['FAULTS', `${activeFaults().length}`]
      ];
      let g = `<rect width="800" height="456" fill="#050505"/>`;
      items.forEach(([k, v], n) => {
        const c = n % 4, r = Math.floor(n / 4), x = 6 + c * 197, y = 8 + r * 58;
        g += `<rect x="${x}" y="${y}" width="191" height="52" rx="4" fill="#0f0f0f" stroke="#262626"/>` + T(x + 8, y + 17, k, 12, 'fill="#9aa4b1"') + T(x + 183, y + 43, v, 20, `text-anchor="end" fill="${/FAULT|OFFLINE/.test(v) ? AMB : '#fff'}" ${MONO}`);
      });
      return touchFit(g, s) + faultBar() + footer(s);
    }
    // driver's autocross sketch: speed + gear in one centre panel, four panels around it, faults bottom right
    function modeAutocross(s) {
      const box = (x, y, w, h) => `<rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="6" fill="#0f0f0f" stroke="#2a2a2a"/>`;
      const pair = (x, y, label, rows) => box(x, y, 230, 205) + T(x + 14, y + 26, label, 14, 'fill="#9aa4b1" letter-spacing="1"') +
        rows.map(([k, v, c], n) => T(x + 16, y + 92 + n * 72, k, 15, 'fill="#9aa4b1"') + T(x + 214, y + 92 + n * 72, v, 36, `text-anchor="end" fill="${c}" ${MONO} font-weight="700"`)).join('');
      return shiftLights(s.rpm) +
        pair(0, 46, 'TEMPS', [['WATER', U.tp(s.waterC), colTemp(s.waterC, 100, 110)], ['OIL', U.tp(s.oilC), colTemp(s.oilC, 120, 130)]]) +
        cell(0, 251, 230, 205, 'OIL P', pr(s.oilP), s.oilP < 1.0 ? RED : s.oilP < 1.5 ? AMB : '#fff', 54) +
        box(230, 46, 340, 410) + T(400, 72, `SPEED (${su()})`, 14, 'text-anchor="middle" fill="#9aa4b1" letter-spacing="1"') +
        T(400, 190, fmt(spd(s.v), 0), 120, `text-anchor="middle" fill="#fff" ${MONO} font-weight="700"`) +
        `<line x1="250" y1="236" x2="550" y2="236" stroke="#2a2a2a" stroke-width="2"/>` + T(400, 262, 'GEAR', 14, 'text-anchor="middle" fill="#9aa4b1" letter-spacing="1"') +
        T(400, 420, s.gear || 'N', 170, `text-anchor="middle" fill="#fff" ${MONO} font-weight="700"`) +
        pair(570, 46, 'POWER / FUEL', [['VOLTS', `${fmt(s.volts, 1)} V`, s.volts < 12.8 || s.volts > 15 ? AMB : '#fff'], ['FUEL', `${fmt(s.fuelL, 2)} L`, s.fuelL < 1 ? AMB : '#fff']]) +
        faultBox(570, 251, 230, 205) +
        footer(s);
    }
    function fullWarning(code, s) {
      const f = FAULTS[code], crit = f.sev === 'critical', flash = crit && Math.floor(t * 3) % 2;
      const n = activeFaults().length;
      return `<rect width="800" height="480" fill="${crit ? (flash ? '#7f1d1d' : RED) : AMB}"/>` +
        T(400, 110, crit ? '⚠ STOP SAFELY' : '⚠ WARNING', 40, `text-anchor="middle" fill="#000" font-weight="700" ${DISP} letter-spacing="2"`) +
        T(400, 200, f.name, 60, `text-anchor="middle" fill="#000" font-weight="700" ${DISP}`) +
        T(400, 268, f.val(s, UU), 48, `text-anchor="middle" fill="#000" ${MONO} font-weight="700"`) +
        T(400, 306, `${code}${n > 1 ? `   ·   ${n - 1} more active` : ''}`, 20, `text-anchor="middle" fill="#000" ${MONO}`) +
        `<rect x="0" y="372" width="800" height="108" fill="#000" opacity="0.85"/>` +
        T(200, 450, s.gear || 'N', 72, `text-anchor="middle" fill="#fff" ${MONO} font-weight="700"`) + T(560, 432, `${fmt(spd(s.v), 0)} ${su()}`, 48, `text-anchor="middle" fill="#fff" ${MONO}`) +
        T(400, 350, `CLEAR, or it moves to the warning box in ${fmt(Math.max(0, POP_S[f.sev] - (t - (fs[code].showT ?? t))), 1)} s${crit ? ' · back every 15 s while active' : ''}`, 17, `text-anchor="middle" fill="#000" font-weight="600"`);
    }

    // ---------------------------------------------------------------- menu and pages
    const status = () => `<rect width="800" height="${PI.o.touchButtons ? 46 : 34}" fill="#0b0b0b"/>` + T(PI.o.touchButtons ? 130 : 14, 23, 'BR27 DASH', 15, `fill="${GOLD}" ${DISP} font-weight="700"`) + T(PI.o.touchButtons ? 670 : 786, 23, `LAP ${lapNo()}/${SESSION_LAPS} · CAN ${PI.fps}/s`, 13, `text-anchor="end" fill="#9aa4b1" ${MONO}`);
    const hint = (a, b, c) => PI.o.touchButtons
      ? `<rect y="446" width="800" height="34" fill="#0b0b0b"/>` + T(400, 468, `MODE: ${a} · tap an item or SELECT · BACK: ${c || 'back'}`, 13, `text-anchor="middle" fill="#9aa4b1" ${MONO}`)
      : `<rect y="446" width="800" height="34" fill="#0b0b0b"/>` + T(14, 468, `MODE: ${a}`, 13, `fill="#9aa4b1" ${MONO}`) + T(400, 468, `CLEAR: ${c || 'back'}`, 13, `text-anchor="middle" fill="#9aa4b1" ${MONO}`) + T(786, 468, `MENU: ${b}`, 13, `text-anchor="end" fill="#9aa4b1" ${MONO}`);
    const head = title => status() + T(30, 76, title, 26, `fill="${GOLD}" ${DISP} font-weight="700"`);
    function menu() {
      let g = head('MENU');
      MENU.forEach((m, k) => {
        const y = 92 + k * 50, on = k === menuIdx;
        g += `<g data-tap="${k}" style="cursor:pointer"><rect x="30" y="${y}" width="740" height="42" rx="6" fill="${on ? MAROON : '#141414'}" stroke="${on ? GOLD : '#262626'}" stroke-width="${on ? 2 : 1}"/>` +
          T(50, y + 28, m, 20, `fill="${on ? '#fff' : '#ccc'}"`) + (m === 'Fault log' && activeFaults().length ? T(700, y + 28, `${activeFaults().length} active`, 15, `text-anchor="end" fill="${AMB}" ${MONO}`) : '') + (on ? T(750, y + 29, '›', 26, `text-anchor="end" fill="${GOLD}"`) : '') + '</g>';
      });
      return g + hint('move down', 'select', 'back to dash');
    }
    function frameBytes(m, i, cnt, s) {
      const b = [0, 0, 0, 0, 0, 0, 0, 0];
      const u16 = (k, v) => { v = clamp(Math.round(v || 0), 0, 65535); b[k] = v >> 8; b[k + 1] = v & 255; };
      const id = m.id;
      if (id === 0x0A0) { b[0] = s.brakeLight ? 1 : 0; u16(1, s.brakeF * 10); u16(3, (s.brakeR || 0) * 10); }
      else if (id >= 0x100 && id <= 0x103) { u16(0, s.wheels[id - 0x100] * 100); if (id === 0x100) u16(2, s.brakeF * 10); if (id === 0x102) u16(2, (s.brakeR || 0) * 10); }
      else if (id === 0x140) { u16(0, s.v * 100); b[2] = s.gear; u16(3, s.rpm); }
      else if (id === 0x600) { u16(0, s.rpm); u16(2, s.map * 10); b[4] = clamp(s.tps * 2, 0, 255); b[5] = clamp(s.lam * 100, 0, 255); }
      else if (id === 0x601) { u16(0, s.oilP * 100); b[2] = clamp(s.oilC, 0, 255); b[3] = clamp(s.waterC, 0, 255); u16(4, s.fuelP * 100); b[6] = clamp(s.volts * 10, 0, 255); }
      else if (id >= 0x602 && id <= 0x607) { b[0] = (id * 7 + Math.floor(t)) & 255; b[1] = 90 + (id & 7); }
      else if (id >= 0x701) { b[0] = cnt & 255; b[1] = 1; }
      else { b[0] = 60 + ((id + Math.floor(t / 2)) % 30); b[1] = 62 + (id % 9); b[2] = 58 + (id % 5); }
      return b;
    }
    const ROWS = 11;
    function pageCan(s, i) {
      const msgs = PI.msgs.concat(activeFaults().filter(c => FAULTS[c].sev !== 'info').map(c => ({ id: (FAULTS[c].sev === 'critical' ? 0x080 : 0x090) + parseInt(c.slice(-2), 10), name: `FAULT ${c} ${FAULTS[c].name}`, hz: FAULTS[c].sev === 'critical' ? 10 : 2, fault: true })));
      msgs.sort((a, b) => a.id - b.id);           // lowest ID wins arbitration, so fault frames sit at the top
      const pages = Math.ceil(msgs.length / ROWS), pg = pageIdx % pages;
      let g = head('CAN DATA') + T(770, 76, `can0 · ${PI.fps} frames/s · page ${pg + 1}/${pages}`, 14, `text-anchor="end" fill="#9aa4b1" ${MONO}`);
      g += T(30, 108, 'ID', 13, 'fill="#7d8794"') + T(90, 108, 'DATA', 13, 'fill="#7d8794"') + T(420, 108, 'HZ', 13, 'fill="#7d8794" text-anchor="end"') + T(510, 108, 'COUNT', 13, 'fill="#7d8794" text-anchor="end"') + T(530, 108, 'NAME', 13, 'fill="#7d8794"');
      msgs.slice(pg * ROWS, pg * ROWS + ROWS).forEach((m, k) => {
        const y = 136 + k * 28, cnt = Math.floor(t * m.hz), col = m.fault ? RED : '#fff';
        const bytes = m.fault ? [1, 0, 0, 0, 0, 0, 0, 0] : frameBytes(m, i, cnt, s);
        g += T(30, y, hex(m.id, 3), 16, `fill="${m.fault ? RED : GOLD2}" ${MONO}`) + T(90, y, bytes.map(x => hex(x, 2)).join(' '), 16, `fill="${col}" ${MONO}`) +
          T(420, y, m.hz, 15, `text-anchor="end" fill="#ccc" ${MONO}`) + T(510, y, cnt, 15, `text-anchor="end" fill="#ccc" ${MONO}`) + T(530, y, m.name.length > 30 ? m.name.slice(0, 29) + '…' : m.name, 14, `fill="${m.fault ? RED : '#ccc'}"`);
      });
      return g + hint('next page', 'back');
    }
    function pageFaults() {
      let g = head('FAULT LOG');
      const act = activeFaults();
      g += T(30, 110, act.length ? `Active: ${act.join(', ')}` : 'No active faults', 18, `fill="${act.length ? AMB : GRN}" ${MONO}`);
      history.slice(-9).reverse().forEach((h, k) => {
        const f = FAULTS[h.code], y = 150 + k * 32, col = f.sev === 'critical' ? RED : f.sev === 'warning' ? AMB : '#38bdf8';
        g += T(30, y, lapTxt(h.t), 16, `fill="#9aa4b1" ${MONO}`) + T(130, y, h.code, 16, `fill="${col}" ${MONO}`) + T(230, y, f.name, 16, 'fill="#ddd"') + T(770, y, h.on ? 'SET' : 'CLEARED', 16, `text-anchor="end" fill="${h.on ? col : GRN}" ${MONO}`);
      });
      return g + hint('—', 'back');
    }
    function kvRows(rows, x, y, w) {
      return rows.map(([k, v, c], n) => T(x, y + n * 38, k, 18, 'fill="#9aa4b1"') + T(x + w, y + n * 38, v, 20, `text-anchor="end" fill="${c || '#fff'}" ${MONO}`)).join('');
    }
    function pageLog() {
      const kb = logBytes / 1024, drop = PI.sel.busiest > 100 ? Math.floor((t - logStartT) * PI.fps * (1 - 100 / PI.sel.busiest)) : 0;
      const pico = !PI.board.linux, ext = PI.o.logFormat === 'binary' ? 'br27' : 'csv';
      return head('LOGGING') + `<rect x="560" y="96" width="210" height="44" rx="6" fill="${logging ? '#7f1d1d' : '#14532d'}"/>` + T(665, 125, logging ? '● RECORDING' : '■ STOPPED', 18, 'text-anchor="middle" fill="#fff" font-weight="700"') +
        kvRows([
          ['File', `${pico ? 'SD:/' : '/data/'}2026-11-05_1432.${ext}`],
          ['Size', kb > 1024 ? `${fmt(kb / 1024, 2)} MB` : `${fmt(kb, 0)} KB`],
          ['Rate', `${fmt(PI.logKBs, 1)} KB/s (${PI.o.logFormat})`],
          ['Frames logged', `${logging ? Math.floor((t - logStartT) * PI.fps) : 0}`],
          ['Dropped', `${drop}`, drop ? RED : GRN],
          ['One endurance run', `${fmt(PI.logMBendur, 0)} MB`],
          ['SD card free (32 GB)', `${fmt(29.5 - kb / 1048576, 2)} GB`]
        ], 30, 180, 740) + hint('start / stop log', 'back');
    }
    function pageSys() {
      const sel = PI.sel, pico = !PI.board.linux, wob = k => 1 + 0.15 * Math.sin(t * 3.1 + k * 1.7) * Math.sin(t * 0.7 + k);
      let g = head('SYSTEM') + T(770, 76, `${PI.board.label}${PI.ramGB ? ' · ' + (PI.ramGB >= 1 ? PI.ramGB + ' GB' : PI.ramGB * 1024 + ' MB') : ''}`, 14, `text-anchor="end" fill="#9aa4b1" ${MONO}`);
      sel.cores.forEach((c, k) => {
        const v = clamp(c * wob(k), 0, 100), y = 100 + k * 28;
        g += T(30, y + 16, `core ${k}`, 14, `fill="#38bdf8" ${MONO}`) + `<rect x="110" y="${y + 3}" width="560" height="16" rx="3" fill="#262b33"/><rect x="110" y="${y + 3}" width="${v * 5.6}" height="16" rx="3" fill="${v > PI.o.specCorePct ? RED : v > 40 ? AMB : GRN}"/>` + T(770, y + 16, `${fmt(v, 1)} %`, 14, `text-anchor="end" fill="#ccc" ${MONO}`);
      });
      const y0 = 108 + sel.cores.length * 28, used = pico ? sel.usedKB : sel.usedMB, tot = pico ? sel.ramKB : sel.ramMB;
      g += T(30, y0 + 16, 'memory', 14, `fill="#38bdf8" ${MONO}`) + `<rect x="110" y="${y0 + 3}" width="560" height="16" rx="3" fill="#262b33"/><rect x="110" y="${y0 + 3}" width="${clamp(used / tot, 0, 1) * 560}" height="16" rx="3" fill="${used / tot * 100 > PI.o.specRamPct ? RED : '#38bdf8'}"/>` +
        T(770, y0 + 16, `${fmt(used, 0)}/${fmt(tot, 0)} ${pico ? 'KB' : 'MB'}`, 14, `text-anchor="end" fill="#ccc" ${MONO}`);
      const temp = pico ? 30 + sel.totalCpu * 0.1 : 42 + sel.totalCpu * (PI.boardKey === 'pi5' ? 0.45 : 0.35);
      g += T(30, y0 + 50, `${U.tp(temp)} · up ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')} · booted in ${fmt(sel.bootS, 1)} s`, 14, `fill="#9aa4b1" ${MONO}`);
      sel.procs.slice().sort((a, b) => b.cpu - a.cpu).slice(0, 6).forEach((p, k) => {
        const y = y0 + 84 + k * 24;
        g += T(30, y, p.name, 15, `fill="#ddd" ${MONO}`) + T(620, y, `${fmt(p.cpu * wob(k + 4), 1)} %`, 15, `text-anchor="end" fill="#ccc" ${MONO}`) + T(770, y, `${pico ? fmt(p.ram, 1) + ' KB' : fmt(p.ram, 0) + ' MB'}`, 15, `text-anchor="end" fill="#ccc" ${MONO}`);
      });
      return g + hint('—', 'back');
    }
    function pageLora(s) {
      const L = PI.lora;
      if (!PI.o.lora) return head('LORA TELEMETRY') + T(30, 160, 'Telemetry is off. Turn it on in Settings.', 20, 'fill="#ccc"') + hint('—', 'back');
      const payload = [s.rpm >> 8, s.rpm & 255, Math.round(s.v), s.gear, Math.round(s.tps), s.brakeLight ? 1 : 0, Math.round(s.oilP * 10), activeFaults().length];
      return head('LORA TELEMETRY') + kvRows([
        ['Radio', `SX1276 · SF${PI.o.loraSF} · ${PI.o.loraBW} kHz`],
        ['Packet', `${PI.o.loraBytes} B every ${fmt(1000 / PI.o.loraHz, 0)} ms`],
        ['Time on air', `${fmt(L.airtimeMs, 1)} ms (${fmt(L.dutyPct, 0)} % of the time)`, L.dutyPct > 100 ? RED : L.dutyPct > 50 ? AMB : GRN],
        ['Packets sent', `${Math.floor(t * PI.o.loraHz)}`],
        ['Pit sees', `${fmt(spd(s.v), 0)} ${su()} · gear ${s.gear} · ${fmt(s.rpm, 0)} rpm`],
        ['Faults sent', activeFaults().join(' ') || 'none', activeFaults().length ? AMB : GRN],
        ['Last payload', payload.map(x => hex(Math.max(0, Math.round(x)) & 255, 2)).join(' ') + (PI.o.loraBytes > 8 ? ' …' : '')]
      ], 30, 130, 740) + hint('—', 'back');
    }
    function settingsItems() {
      return [
        ['Shift light at', `${set.shiftRpm} rpm`], ['Speed in', imp() ? 'mph' : 'km/h'], ['Brightness', `${set.bright} %`],
        ['Display at start', MODES[set.bootMode]], ['LoRa telemetry', PI.o.lora ? 'ON' : 'OFF'], ['Log format', PI.o.logFormat === 'binary' ? 'Binary' : 'CSV'],
        ['Restart dash computer', '↻'], ['Back', '‹']
      ];
    }
    function pageSettings() {
      let g = head('SETTINGS');
      settingsItems().forEach(([k, v], n) => {
        const y = 90 + n * 44, on = n === pageIdx;
        g += `<g data-tap="${n}" style="cursor:pointer"><rect x="30" y="${y}" width="740" height="38" rx="6" fill="${on ? MAROON : '#141414'}" stroke="${on ? GOLD : '#262626'}" stroke-width="${on ? 2 : 1}"/>` +
          T(48, y + 26, k, 18, `fill="${on ? '#fff' : '#ccc'}"`) + T(752, y + 26, v, 18, `text-anchor="end" fill="${on ? GOLD2 : '#9aa4b1'}" ${MONO}`) + '</g>';
      });
      return g + hint('move down', 'change');
    }
    function changeSetting(n) {
      if (n === 0) set.shiftRpm = set.shiftRpm >= 13500 ? 11000 : set.shiftRpm + 500;
      else if (n === 1) set.speedUnit = imp() ? 'kmh' : 'mph';
      else if (n === 2) set.bright = set.bright <= 40 ? 100 : set.bright - 20;
      else if (n === 3) set.bootMode = (set.bootMode + 1) % MODES.length;
      else if (n === 4) hooks.onSetting && hooks.onSetting('lora', !PI.o.lora);
      else if (n === 5) hooks.onSetting && hooks.onSetting('logFormat', PI.o.logFormat === 'binary' ? 'csv' : 'binary');
      else if (n === 6) api.reboot();
      else { phase = 'menu'; page = null; }
    }

    function boot() {
      const L = bootLen(), u = clamp(bootT / L, 0, 1), pico = !PI.board.linux;
      const lines = pico
        ? ['RP2040 boot ROM', 'flash XIP ok', 'SD card mounted (FatFs)', 'MCP2515 1 Mbit/s', 'LVGL display ready', 'dash']
        : ['Raspberry Pi bootloader', `Linux on ${PI.board.cpu}`, 'mounting /data (SD card)', 'can0: 1 Mbit/s, up', 'starting can-reader, logger, fault monitor', PI.o.lora ? 'lora-telemetry: SX1276 ok' : 'lora-telemetry: off', 'starting dash'];
      const shown = lines.slice(0, Math.max(1, Math.ceil(u * lines.length))).slice(-3);
      const g = window.BRSplash.frame(u, bootT, shown, `ready in ${fmt(PI.sel.bootS, 1)} s on this board`, UID);
      return g;
    }

    // capacitive touch option: MENU and CLEAR become tap targets in the top corners, either side of the rev lights (big enough for a gloved finger)
    function touchKeys() {
      const pop = popup(), act = activeFaults().length;
      const key = (x, id, label, fill, stroke, txt) => `<g data-touch="${id}" style="cursor:pointer"><rect x="${x}" y="3" width="110" height="40" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="2.5" opacity="0.94"/>` +
        T(x + 55, 30, label, 18, `text-anchor="middle" fill="${txt}" font-weight="700" ${DISP} letter-spacing="1.5" pointer-events="none"`) + '</g>';
      let g = '';
      if (!pop) g += key(4, 'menu', phase === 'dash' ? 'MENU' : 'SELECT', '#1d1d22', GOLD, '#fff');
      const back = !pop && phase !== 'dash';
      g += key(686, 'clear', back ? 'BACK' : 'CLEAR', pop || (act && !back) ? '#7f1d1d' : '#1d1d22', pop ? '#fff' : act && !back ? RED : '#555', '#fff');
      return g;
    }
    // real pixels: draw the frame into a canvas the size of the chosen display (800 × 480 for the 5 in TFT) and blow it up
    // with nearest-neighbour scaling, so the preview shows the screen's actual resolution. The SVG stays on top, invisible, for taps.
    const px = el.querySelector('.dev-px');
    let rasterBusy = false, rasterNext = false;
    function rasterize() {
      if (rasterBusy) { rasterNext = true; return; }
      const w = (PI.display && PI.display.w) || 800, h = (PI.display && PI.display.h) || 480;
      if (px.width !== w || px.height !== h) { px.width = w; px.height = h; }
      px.style.aspectRatio = `${w} / ${h}`;
      rasterBusy = true;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 480" width="${w}" height="${h}" preserveAspectRatio="none"><style>${screenCss()}</style>${scr.innerHTML}</svg>`;
      const img = new Image();
      img.onload = () => {
        const c = px.getContext('2d'); c.imageSmoothingEnabled = true; c.clearRect(0, 0, w, h); c.drawImage(img, 0, 0, w, h);
        if (px.hidden) { px.hidden = false; scr.style.opacity = '0'; }
        rasterBusy = false; if (rasterNext) { rasterNext = false; rasterize(); }
      };
      img.onerror = () => { rasterBusy = false; px.hidden = true; scr.style.opacity = ''; };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }
    function draw() {
      if (!PI || !LAP) return;
      let g;
      if (phase === 'boot') g = boot();
      else {
        const i = idx(), s = lastSig || signals(i), pop = popup();
        if (pop) g = fullWarning(pop, s);                          // faults outrank the dash and the menu
        else if (phase === 'dash') g = [modeEndurance, modeTires, modeDebug, modeAutocross][mode](s);
        else if (phase === 'menu') g = menu();
        else g = ({ 'CAN data': pageCan, 'Fault log': pageFaults, Logging: pageLog, System: pageSys, 'LoRa telemetry': pageLora, Settings: pageSettings })[page](s, i);
      }
      if (phase !== 'boot' && PI.o.touchButtons) g += touchKeys();
      scr.innerHTML = `<rect width="800" height="480" fill="#050505"/>${g}<rect width="800" height="480" fill="#000" opacity="${(100 - set.bright) / 100 * 0.7}" pointer-events="none"/>`;
      if (PI.o.pixelTrue !== false) rasterize(); else if (!px.hidden) { px.hidden = true; scr.style.opacity = ''; }
    }

    function resetSession() {
      t = 0; logStartT = 0; logBytes = 0; history.length = 0;
      for (const k of Object.keys(fs)) delete fs[k];
    }
    function step(dt) {
      if (phase === 'boot') {
        bootT += dt;
        if (bootT >= bootLen() + 0.4) { phase = 'dash'; mode = set.bootMode; resetSession(); }
        return;
      }
      t += dt;
      if (t >= SESSION_LAPS * LAP.lapTime) resetSession();             // the session starts over (refuelled, faults reset)
      if (logging) logBytes += PI.logKBs * 1024 * dt;
      lastSig = signals(idx());
      updateFaults(lastSig);
    }
    function frame(ts) {
      if (!running) return;
      const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
      last = ts; step(dt);
      if (ts - lastDraw > (phase === 'boot' ? 40 : 100)) { lastDraw = ts; draw(); }
      raf = requestAnimationFrame(frame);
    }

    const api = {
      set(pi, lap, extra) {
        const reboot = !PI || PI.boardKey !== pi.boardKey || PI.ramGB !== pi.ramGB || PI.o.os !== pi.o.os || PI.o.renderer !== pi.o.renderer;
        PI = pi; X = extra || {};
        el.querySelectorAll('.dev-btns [data-btn="clear"], .dev-btns [data-btn="menu"]').forEach(btn => { btn.hidden = !!pi.o.touchButtons; });
        if (LAP !== lap) {
          LAP = lap; cum = []; let c = 0;
          lap.series.fuelGs.forEach(gs => { c += gs / lap.fs / 740; cum.push(c); });   // litres, gasoline ~740 g/L
        }
        if (reboot) api.reboot(); else draw();
      },
      press(btn) {
        if (!PI || phase === 'boot') return;
        const pop = popup();
        if (pop) { if (btn === 'clear') { fs[pop].acked = true; fs[pop].ackT = t; fs[pop].showT = null; } draw(); return; }   // only CLEAR works while a fault fills the screen
        if (phase === 'dash') { if (btn === 'mode') mode = (mode + 1) % MODES.length; else if (btn === 'menu') { phase = 'menu'; menuIdx = 0; } }
        else if (phase === 'menu') {
          if (btn === 'mode') menuIdx = (menuIdx + 1) % MENU.length;
          else if (btn === 'clear' || MENU[menuIdx] === 'Back to dash') phase = 'dash';
          else { phase = 'page'; page = MENU[menuIdx]; pageIdx = 0; }
        } else if (btn === 'clear') { phase = 'menu'; page = null; }
        else if (page === 'Settings') { if (btn === 'mode') pageIdx = (pageIdx + 1) % settingsItems().length; else changeSetting(pageIdx); }
        else if (btn === 'mode') {
          if (page === 'CAN data') pageIdx++;
          else if (page === 'Logging') { logging = !logging; if (logging) { logStartT = t; logBytes = 0; } }
        } else { phase = 'menu'; page = null; }
        draw();
      },
      skip(sec) { if (phase === 'boot') return; for (let k = 0; k < sec * 10; k++) step(0.1); draw(); },
      scenario(k) { scen = SCENARIOS[k] ? k : 'clean'; if (phase !== 'boot') { resetSession(); phase = 'dash'; } draw(); },
      reboot() { phase = 'boot'; bootT = 0; page = null; draw(); },
      start() { if (!running) { running = true; last = 0; raf = requestAnimationFrame(frame); } },
      stop() { running = false; cancelAnimationFrame(raf); },
      get running() { return running; }
    };
    return api;
  }
  window.BRDashOS = { mount, MODES, MENU, SCENARIOS, FAULTS };
})();
