// Mock dash computer screen: a pretend OS desktop (or Pico firmware status) that plays the simulator's
// lap and shows what each program on the board would be doing: the driver's dash, a system monitor,
// a CAN viewer, the logger and the LoRa link. Numbers come from simulatePi() and the lap; the small
// wobble on CPU numbers is cosmetic. window.BRDashOS.mount(el, U) returns { set(pi, lap, can), start(), stop(), seek(s) }.
(function () {
  'use strict';
  const fmt = (x, d) => (x == null || !isFinite(x) ? '–' : Number(x).toFixed(d));
  const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0');
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function mount(el, U) {
    let PI = null, LAP = null, t = 0, last = 0, raf = 0, running = false, lastDraw = 0, packets = 0, lastPacketT = -1;

    function layout() {
      const pico = !PI.board.linux;
      el.innerHTML = `
        <div class="os-bar">
          <span class="os-host">${pico ? 'br27-dash · firmware' : 'br27-dash'}</span>
          <span class="os-board">${PI.board.label}${PI.ramGB ? ` · ${PI.ramGB >= 1 ? PI.ramGB + ' GB' : PI.ramGB * 1024 + ' MB'}` : ` · ${PI.board.ramKB} KB`}</span>
          <span class="os-stat" id="osCpu"></span><span class="os-stat" id="osMem"></span><span class="os-stat" id="osTemp"></span><span class="os-stat" id="osClock"></span>
        </div>
        <div class="os-desk">
          <div class="os-win os-dash"><div class="os-title"><i></i><i></i><i></i>${pico ? 'SPI dash (LVGL)' : 'dash'}</div><svg id="osDash" viewBox="0 0 480 280"></svg></div>
          <div class="os-win os-top"><div class="os-title"><i></i><i></i><i></i>${pico ? 'core load' : 'htop'}</div><div class="os-body" id="osTop"></div></div>
          <div class="os-win os-can"><div class="os-title"><i></i><i></i><i></i>${pico ? 'USB serial: CAN stream' : 'can-viewer'}</div><div class="os-body" id="osCan"></div></div>
          <div class="os-win os-log"><div class="os-title"><i></i><i></i><i></i>logger</div><div class="os-body" id="osLog"></div></div>
          <div class="os-win os-lora"><div class="os-title"><i></i><i></i><i></i>lora-telemetry</div><div class="os-body" id="osLora"></div></div>
        </div>`;
    }

    const S = () => LAP.series;
    function idx() { return Math.floor((t % LAP.lapTime) * LAP.fs) % S().t.length; }

    function frameBytes(m, i, cnt) {
      const s = S(), b = [0, 0, 0, 0, 0, 0, 0, 0];
      const u16 = (k, v) => { v = clamp(Math.round(v), 0, 65535); b[k] = v >> 8; b[k + 1] = v & 255; };
      const id = m.id;
      if (id === 0x0A0) { b[0] = s.brakeLight[i] ? 1 : 0; u16(1, s.brakeF[i] * 10); u16(3, s.brakeR[i] * 10); }
      else if (id >= 0x100 && id <= 0x103) { u16(0, s.v[i] * 100); if (id === 0x100) u16(2, s.brakeF[i] * 10); if (id === 0x102) u16(2, s.brakeR[i] * 10); }
      else if (id === 0x140) { u16(0, s.v[i] * 100); b[2] = s.gear[i]; u16(3, s.rpm[i]); }
      else if (id === 0x600) { u16(0, s.rpm[i]); u16(2, s.map[i] * 10); b[4] = clamp(s.tps[i] * 2, 0, 255); b[5] = clamp(s.lam[i] * 100, 0, 255); }
      else if (id === 0x601) { u16(0, s.pw[i] * 100); u16(2, s.dwell[i] * 100); b[4] = clamp(s.duty[i] * 2, 0, 255); }
      else if (id >= 0x602 && id <= 0x607) { b[0] = (id * 7 + Math.floor(t)) & 255; b[1] = 90 + (id & 7); }
      else if (id >= 0x701 && id <= 0x7F0) { b[0] = cnt & 255; b[1] = 1; }
      else { b[0] = 60 + ((id + Math.floor(t / 2)) % 30); b[1] = 62 + (id % 9); b[2] = 58 + (id % 5); }
      return b;
    }

    function drawDash(i) {
      const s = S(), rpm = s.rpm[i], gear = s.gear[i], kmh = s.v[i], lim = 14000;
      const lights = 10, on = Math.round(clamp((rpm - 9000) / (13000 - 9000), 0, 1) * lights);
      let g = `<rect width="480" height="280" rx="6" fill="#050505"/>`;
      for (let k = 0; k < lights; k++) g += `<circle cx="${60 + k * 40}" cy="22" r="10" fill="${k < on ? (k < 4 ? '#22c55e' : k < 8 ? '#f59e0b' : '#ef4444') : '#1c1c1c'}"/>`;
      const w = clamp(rpm / lim, 0, 1) * 440;
      g += `<rect x="20" y="44" width="440" height="20" rx="3" fill="#1c1c1c"/><rect x="20" y="44" width="${w}" height="20" rx="3" fill="${rpm > 12500 ? '#ef4444' : '#d4b98a'}"/>`;
      g += `<text x="20" y="84" font-size="14" fill="#aaa" font-family="var(--f-mono)">${fmt(rpm, 0)} rpm</text>`;
      g += `<text x="240" y="200" font-size="120" font-weight="700" text-anchor="middle" fill="#fff" font-family="var(--f-mono)">${gear || 'N'}</text>`;
      g += `<text x="30" y="150" font-size="44" font-weight="700" fill="#fff" font-family="var(--f-mono)">${fmt(U.spv(kmh), 0)}</text><text x="32" y="172" font-size="14" fill="#aaa">${U.SU()}</text>`;
      g += `<text x="450" y="130" font-size="13" text-anchor="end" fill="#aaa">TPS</text><text x="450" y="154" font-size="24" text-anchor="end" fill="#fff" font-family="var(--f-mono)">${fmt(s.tps[i], 0)}%</text>`;
      g += `<text x="450" y="182" font-size="13" text-anchor="end" fill="#aaa">λ</text><text x="450" y="206" font-size="24" text-anchor="end" fill="#fff" font-family="var(--f-mono)">${fmt(s.lam[i], 2)}</text>`;
      const lt = t % LAP.lapTime;
      g += `<text x="30" y="250" font-size="22" fill="#fff" font-family="var(--f-mono)">${Math.floor(lt / 60)}:${fmt(lt % 60, 2).padStart(5, '0')}</text><text x="30" y="268" font-size="11" fill="#aaa">lap time</text>`;
      g += `<rect x="190" y="236" width="100" height="28" rx="5" fill="${s.brakeLight[i] ? '#ef4444' : '#1c1c1c'}"/><text x="240" y="255" font-size="13" text-anchor="middle" fill="${s.brakeLight[i] ? '#fff' : '#666'}" font-weight="600">BRAKE</text>`;
      g += `<circle cx="372" cy="250" r="6" fill="#ef4444" opacity="${Math.floor(t * 2) % 2 ? 1 : 0.35}"/><text x="384" y="255" font-size="13" fill="#ddd">LOG</text>`;
      if (PI.o.lora) g += `<text x="450" y="255" font-size="13" text-anchor="end" fill="${t - lastPacketT < 0.15 ? '#22c55e' : '#666'}">LoRa</text>`;
      $('osDash').innerHTML = g;
    }

    const $ = id => el.querySelector('#' + id);
    const wob = (k, amp) => 1 + amp * Math.sin(t * 3.1 + k * 1.7) * Math.sin(t * 0.7 + k);

    function drawTop() {
      const sel = PI.sel, pico = !PI.board.linux;
      const cores = sel.cores.map((c, k) => clamp(c * wob(k, 0.18), 0, 100));
      let h = '<div class="os-cores">' + cores.map((c, k) => `<div><span>${k}</span><b><i style="width:${c}%;background:${c > PI.o.specCorePct ? '#ef4444' : c > 40 ? '#f59e0b' : '#22c55e'}"></i></b><em>${fmt(c, 1)}%</em></div>`).join('') + '</div>';
      const used = pico ? sel.usedKB : sel.usedMB, tot = pico ? sel.ramKB : sel.ramMB, unit = pico ? 'KB' : 'MB';
      const ramNow = used * (1 + 0.004 * Math.sin(t));
      h += `<div class="os-mem"><span>Mem</span><b><i style="width:${clamp(ramNow / tot * 100, 0, 100)}%;background:${ramNow / tot * 100 > PI.o.specRamPct ? '#ef4444' : '#38bdf8'}"></i></b><em>${fmt(ramNow, 0)}/${fmt(tot, 0)} ${unit}</em></div>`;
      if (!pico) h += `<div class="os-mem"><span>Swp</span><b><i style="width:${ramNow > tot ? 60 : 0}%;background:#f59e0b"></i></b><em>${ramNow > tot ? 'swapping' : '0 MB'}</em></div>`;
      h += `<table><thead><tr><th>${pico ? 'TASK' : 'PROCESS'}</th><th class="num">CPU%</th><th class="num">${pico ? 'KB' : 'MEM MB'}</th></tr></thead><tbody>` +
        sel.procs.slice().sort((a, b) => b.cpu - a.cpu).map((p, k) => `<tr><td>${p.name}</td><td class="num">${fmt(p.cpu * wob(k + 4, 0.15), 1)}</td><td class="num">${pico ? fmt(p.ram, 1) : fmt(p.ram, 0)}</td></tr>`).join('') + '</tbody></table>';
      $('osTop').innerHTML = h;
      $('osCpu').textContent = `CPU ${fmt(sel.totalCpu * wob(9, 0.1), 0)}%`;
      $('osMem').textContent = `RAM ${fmt(sel.ramPct, 0)}%`;
      const temp = pico ? 30 + sel.totalCpu * 0.1 : 42 + sel.totalCpu * (PI.boardKey === 'pi5' ? 0.45 : 0.35);
      $('osTemp').textContent = `${U.tp(temp)}`;
      $('osClock').textContent = `up ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    }

    function drawCan(i) {
      const msgs = PI.msgs;
      const rows = msgs.map(m => {
        const cnt = Math.floor(t * m.hz);
        return `<tr><td class="mono">${hex(m.id, 3)}</td><td class="mono">${frameBytes(m, i, cnt).map(x => hex(x, 2)).join(' ')}</td><td class="num">${m.hz}</td><td class="num">${cnt}</td><td>${m.name}</td></tr>`;
      }).join('');
      $('osCan').innerHTML = `<div class="os-line">can0 · ${PI.fps} frames/s · ${PI.o.viewer || !PI.board.linux ? 'live' : 'viewer off (enable in settings)'}</div>` +
        (PI.o.viewer || !PI.board.linux ? `<table><thead><tr><th>ID</th><th>DATA</th><th class="num">HZ</th><th class="num">COUNT</th><th>NAME</th></tr></thead><tbody>${rows}</tbody></table>` : '');
    }

    function drawLog() {
      const kb = PI.logKBs * t, pico = !PI.board.linux;
      const drop = PI.sel.busiest > 100 ? Math.floor(t * PI.fps * (1 - 100 / PI.sel.busiest)) : 0;
      const d = new Date(2026, 10, 5, 14, 32, 1);
      const name = `/data/${d.toISOString().slice(0, 10)}_143201.${PI.o.logFormat === 'binary' ? 'br27' : 'csv'}`;
      $('osLog').innerHTML = `<div class="os-line">writing <b>${pico ? name.replace('/data/', 'SD:/') : name}</b></div>
        <div class="os-kv"><span>size</span><b>${kb > 1024 ? fmt(kb / 1024, 2) + ' MB' : fmt(kb, 0) + ' KB'}</b><span>rate</span><b>${fmt(PI.logKBs, 1)} KB/s</b>
        <span>frames</span><b>${Math.floor(t * PI.fps)}</b><span>dropped</span><b class="${drop ? 'bad' : ''}">${drop}</b>
        <span>endurance</span><b>${fmt(PI.logMBendur, 0)} MB</b><span>buffer</span><b>${pico ? '0.25 s ×2' : PI.o.bufS + ' s'}</b></div>`;
    }

    function drawLora(i) {
      const L = PI.lora, s = S();
      if (!PI.o.lora) { $('osLora').innerHTML = '<div class="os-line">telemetry off (optional, enable in settings)</div>'; return; }
      const sent = Math.floor(t * PI.o.loraHz);
      if (sent !== packets) { packets = sent; lastPacketT = t; }
      const payload = [s.rpm[i] >> 8, s.rpm[i] & 255, Math.round(s.v[i]), s.gear[i], Math.round(s.tps[i]), s.brakeLight[i] ? 1 : 0];
      while (payload.length < Math.min(PI.o.loraBytes, 12)) payload.push(0);
      $('osLora').innerHTML = `<div class="os-line">SX1276 · SF${PI.o.loraSF} · ${PI.o.loraBW} kHz · ${PI.o.loraBytes} B every ${fmt(1000 / PI.o.loraHz, 0)} ms</div>
        <div class="os-mem"><span>air</span><b><i style="width:${clamp(L.dutyPct, 0, 100)}%;background:${L.dutyPct > 100 ? '#ef4444' : L.dutyPct > 50 ? '#f59e0b' : '#22c55e'}"></i></b><em>${fmt(L.dutyPct, 0)}%</em></div>
        <div class="os-kv"><span>packets</span><b>${sent}</b><span>airtime</span><b>${fmt(L.airtimeMs, 1)} ms</b><span>pit sees</span><b>${fmt(U.spv(s.v[i]), 0)} ${U.SU()} · ${s.gear[i]} · ${fmt(s.rpm[i], 0)}</b></div>
        <div class="os-line mono">${payload.map(x => hex(Math.max(0, Math.round(x)) & 255, 2)).join(' ')}${PI.o.loraBytes > 12 ? ' …' : ''}</div>`;
    }

    function draw() {
      if (!PI || !LAP) return;
      const i = idx();
      drawDash(i); drawTop(); drawCan(i); drawLog(); drawLora(i);
    }

    function frame(ts) {
      if (!running) return;
      const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
      last = ts; t += dt;
      if (ts - lastDraw > 100) { lastDraw = ts; draw(); }     // 10 updates a second is plenty to read
      raf = requestAnimationFrame(frame);
    }

    return {
      set(pi, lap) {
        const rebuild = !PI || PI.boardKey !== pi.boardKey || PI.ramGB !== pi.ramGB;
        PI = pi; LAP = lap;
        if (rebuild || !el.querySelector('#osDash')) layout();
        draw();
      },
      start() { if (!running) { running = true; last = 0; raf = requestAnimationFrame(frame); } },
      stop() { running = false; cancelAnimationFrame(raf); },
      get running() { return running; },
      restart() { t = 0; packets = 0; draw(); }
    };
  }
  window.BRDashOS = { mount };
})();
