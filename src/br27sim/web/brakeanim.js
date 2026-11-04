// Brake system diagram: pedal, balance bar with the bias knob, two master cylinders, a pressure
// gauge and sensor on each circuit, the rear node and the brake light. It draws a simulateBrakes()
// result and can animate a press and release using the result's sweep (no model calls per frame).
// window.BRBrake.mount(svg, conv) returns { set(r), play(), stop() }.
(function () {
  'use strict';
  const fmt = (x, d) => (x == null || !isFinite(x) ? '–' : Number(x).toFixed(d));
  const rad = d => d * Math.PI / 180;

  function mount(svg, conv) {
    let R = null, raf = 0, t0 = 0, playing = false, lightOn = false;

    function at(pct) {
      const s = R.sweep, i = Math.max(0, Math.min(99, Math.floor(pct))), u = Math.max(0, Math.min(1, pct - i));
      const a = s[i], b = s[i + 1];
      return { front: a.front + (b.front - a.front) * u, rear: a.rear + (b.rear - a.rear) * u, N: a.N + (b.N - a.N) * u };
    }

    function gauge(cx, cy, r, psi, max, color, title) {
      const ang = u => rad(135 + 270 * u);
      const pt = (u, rr) => `${cx + rr * Math.cos(ang(u))},${cy + rr * Math.sin(ang(u))}`;
      let ticks = '';
      for (let k = 0; k <= 10; k++) {
        const u = k / 10, big = k % 5 === 0;
        ticks += `<line x1="${pt(u, r - (big ? 11 : 6)).split(',')[0]}" y1="${pt(u, r - (big ? 11 : 6)).split(',')[1]}" x2="${pt(u, r - 2).split(',')[0]}" y2="${pt(u, r - 2).split(',')[1]}" stroke="var(--ink-3)" stroke-width="${big ? 1.5 : 1}"/>`;
      }
      const u = Math.max(0, Math.min(1, psi / max));
      const [nx, ny] = pt(u, r - 14).split(',');
      const large = u > 2 / 3 ? 1 : 0;
      const arc = u > 0.002 ? `<path d="M ${pt(0, r - 2)} A ${r - 2} ${r - 2} 0 ${large} 1 ${pt(u, r - 2)}" fill="none" stroke="${color}" stroke-width="4" opacity="0.8"/>` : '';
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--bg)" stroke="var(--ink-3)"/>${ticks}${arc}
        <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>
        <circle cx="${cx}" cy="${cy}" r="5" fill="${color}"/>
        <text x="${cx}" y="${cy - r - 8}" text-anchor="middle" font-size="12" font-weight="600" fill="var(--ink)">${title}</text>
        <text x="${cx}" y="${cy + 26}" text-anchor="middle" font-size="13" font-weight="600" fill="var(--ink)" class="mono">${conv.pr(psi)}</text>
        <text x="${pt(0, r + 10).split(',')[0]}" y="${+pt(0, r + 10).split(',')[1] + 4}" text-anchor="middle" font-size="9.5" fill="var(--ink-3)">0</text>
        <text x="${pt(1, r + 10).split(',')[0]}" y="${+pt(1, r + 10).split(',')[1] + 4}" text-anchor="middle" font-size="9.5" fill="var(--ink-3)">${conv.prShort(max)}</text>`;
    }

    function draw(pct, light) {
      const b = R.b, p = at(pct), fs = R.frontShare;
      const travel = Math.max(0, Math.min(1, pct / 100));
      // pedal: pivot at the floor, pad up top; the driver pushes it forward (right)
      const px = 96, py = 318, L = 205, th = rad(-14 + 30 * travel);
      const pad = [px + L * Math.sin(th), py - L * Math.cos(th)];
      const dA = 205 / b.pedalRatio;                        // pushrod pickup: pedal ratio = L / dA
      const att = [px + dA * Math.sin(th), py - dA * Math.cos(th)];
      // balance bar: front clevis at the top, rear at the bottom; the pivot sits closer to the front for more front
      const barX = 262 + 20 * travel, yF = 176, yR = 300, pivY = yF + (1 - fs) * (yR - yF);
      const hF = 18 + (b.mcFrontIn - 0.5) * 40, hR = 18 + (b.mcRearIn - 0.5) * 40;
      const mc = (y, h, col, name, bore) => `
        <rect x="318" y="${y - h / 2 - 12}" width="22" height="10" rx="2" fill="var(--panel)" stroke="var(--ink-3)"/>
        <rect x="300" y="${y - h / 2}" width="118" height="${h}" rx="4" fill="var(--panel)" stroke="var(--ink-2)"/>
        <rect x="${302 + 20 * travel}" y="${y - h / 2 + 2}" width="10" height="${h - 4}" fill="var(--ink-2)"/>
        <rect x="${312 + 20 * travel}" y="${y - h / 2 + 2}" width="${104 - 20 * travel}" height="${h - 4}" fill="${col}" opacity="${0.12 + 0.5 * Math.min(1, (name === 'Front' ? p.front : p.rear) / 1500)}"/>
        <line x1="${barX}" y1="${y}" x2="${302 + 20 * travel}" y2="${y}" stroke="var(--ink-2)" stroke-width="3"/>
        <text x="359" y="${y + h / 2 + 15}" text-anchor="middle" font-size="11.5" fill="var(--ink-2)">${name} master cylinder ${bore} → calipers</text>`;
      const knobRot = (b.biasTurns * 360) % 360;
      const gF = [560, 118], gR = [560, 262];
      const vF = 0.5 + 4 * Math.min(p.front, b.sensorMaxPsi) / b.sensorMaxPsi, vR = 0.5 + 4 * Math.min(p.rear, b.sensorMaxPsi) / b.sensorMaxPsi;
      const code = v => Math.round(v / 5 * (2 ** b.adcBits - 1));
      const lit = light;
      svg.innerHTML = `
        <defs><filter id="bGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="7"/></filter></defs>
        <text x="16" y="26" font-size="13" font-weight="600" fill="var(--ink)">Pedal ${fmt(pct, 0)} % down</text>
        <text x="16" y="44" font-size="11.5" fill="var(--ink-2)">${conv.force(p.N)} on the pad × ${fmt(b.pedalRatio, 1)} = ${conv.force(p.N * b.pedalRatio)} on the bar</text>
        <line x1="40" y1="${py}" x2="160" y2="${py}" stroke="var(--ink-3)" stroke-width="2"/>
        <line x1="${px}" y1="${py}" x2="${pad[0]}" y2="${pad[1]}" stroke="var(--ink-2)" stroke-width="7" stroke-linecap="round"/>
        <line x1="${pad[0] - 22 * Math.cos(th)}" y1="${pad[1] - 22 * Math.sin(th)}" x2="${pad[0] + 22 * Math.cos(th)}" y2="${pad[1] + 22 * Math.sin(th)}" stroke="var(--accent)" stroke-width="9" stroke-linecap="round"/>
        <circle cx="${px}" cy="${py}" r="7" fill="var(--panel)" stroke="var(--ink-2)" stroke-width="2"/>
        <line x1="${att[0]}" y1="${att[1]}" x2="${barX}" y2="${pivY}" stroke="var(--ink-2)" stroke-width="4"/>
        <circle cx="${att[0]}" cy="${att[1]}" r="3.5" fill="var(--ink-2)"/>
        <line x1="${barX}" y1="${yF - 8}" x2="${barX}" y2="${yR + 8}" stroke="var(--ink)" stroke-width="7" stroke-linecap="round"/>
        <circle cx="${barX}" cy="${pivY}" r="6" fill="var(--accent)"/>
        <text x="${barX - 12}" y="${yF - 16}" text-anchor="end" font-size="11" fill="var(--ink-2)">balance bar</text>
        <path d="M ${barX} ${pivY} C ${barX - 40} ${pivY - 40}, 190 110, 200 92" fill="none" stroke="var(--ink-3)" stroke-dasharray="4 3" stroke-width="1.5"/>
        <g transform="translate(200 72)">
          <circle r="20" fill="var(--panel)" stroke="var(--ink-2)" stroke-width="2"/>
          <g transform="rotate(${knobRot})"><line x1="0" y1="-4" x2="0" y2="-17" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"/></g>
        </g>
        <text x="228" y="66" font-size="12" font-weight="600" fill="var(--ink)">Bias knob ${b.biasTurns > 0 ? '+' : ''}${fmt(b.biasTurns, 1)} turns</text>
        <text x="228" y="82" font-size="11.5" fill="var(--ink-2)">bar sends ${fmt(fs * 100, 1)} % of the push to the front</text>
        ${mc(yF, hF, 'var(--s1)', 'Front', conv.bore(b.mcFrontIn))}
        ${mc(yR, hR, 'var(--s2)', 'Rear', conv.bore(b.mcRearIn))}
        <path d="M 418 ${yF} H 470 V ${gF[1]} H ${gF[0] - 58}" fill="none" stroke="var(--s1)" stroke-width="2.5"/>
        <path d="M 418 ${yR} H 470 V ${gR[1]} H ${gR[0] - 58}" fill="none" stroke="var(--s2)" stroke-width="2.5"/>
        ${gauge(gF[0], gF[1], 52, p.front, b.sensorMaxPsi, 'var(--s1)', 'Front pressure')}
        ${gauge(gR[0], gR[1], 52, p.rear, b.sensorMaxPsi, 'var(--s2)', 'Rear pressure')}
        <text x="626" y="${gF[1] - 6}" font-size="11.5" fill="var(--ink)">sensor ${fmt(vF, 2)} V</text>
        <text x="626" y="${gF[1] + 10}" font-size="11" fill="var(--ink-2)" class="mono">ADC ${code(vF)}</text>
        <text x="626" y="${gR[1] - 6}" font-size="11.5" fill="var(--ink)">sensor ${fmt(vR, 2)} V</text>
        <text x="626" y="${gR[1] + 10}" font-size="11" fill="var(--ink-2)" class="mono">ADC ${code(vR)}</text>
        <rect x="700" y="196" width="76" height="40" rx="6" fill="var(--panel)" stroke="var(--ink-2)"/>
        <text x="738" y="214" text-anchor="middle" font-size="11.5" font-weight="600" fill="var(--ink)">Rear node</text>
        <text x="738" y="228" text-anchor="middle" font-size="10" fill="var(--ink-2)">higher of the two</text>
        <path d="M 626 ${gF[1] + 18} C 700 ${gF[1] + 30}, 730 160, 738 196" fill="none" stroke="var(--ink-3)" stroke-dasharray="4 3"/>
        <text x="690" y="150" font-size="10" fill="var(--ink-3)">CAN</text>
        <path d="M 680 ${gR[1] - 14} C 700 ${gR[1] - 20}, 720 250, 738 236" fill="none" stroke="var(--ink-3)"/>
        <line x1="776" y1="216" x2="806" y2="216" stroke="var(--ink-3)" stroke-width="2"/>
        <rect x="806" y="110" width="80" height="190" rx="12" fill="var(--panel)" stroke="var(--ink-2)"/>
        ${lit ? '<rect x="816" y="186" width="60" height="22" rx="5" fill="#ff2a2a" filter="url(#bGlow)" opacity="0.9"/>' : ''}
        <rect x="816" y="186" width="60" height="22" rx="5" fill="${lit ? '#ff3b30' : '#3a1a1a'}" stroke="${lit ? '#ff8a80' : 'var(--ink-3)'}"/>
        <text x="846" y="132" text-anchor="middle" font-size="11.5" font-weight="600" fill="var(--ink)">Car rear</text>
        <text x="846" y="232" text-anchor="middle" font-size="12" font-weight="700" fill="${lit ? '#ff3b30' : 'var(--ink-3)'}">${lit ? 'LIGHT ON' : 'light off'}</text>
        <text x="846" y="250" text-anchor="middle" font-size="10" fill="var(--ink-2)">on at ${conv.pr(b.lightOnPsi, 1)}</text>
        <text x="846" y="264" text-anchor="middle" font-size="10" fill="var(--ink-2)">off at ${conv.pr(b.lightOffPsi, 1)}</text>`;
    }

    function frame(t) {
      if (!playing) return;
      if (!t0) t0 = t;
      const T = 5, s = (t - t0) / 1000;
      if (s >= T) { playing = false; lightOn = R.lightOn; draw(R.b.pedalPct, R.lightOn); if (api.onEnd) api.onEnd(); return; }
      const pct = s < T / 2 ? (s / (T / 2)) * 100 : (1 - (s - T / 2) / (T / 2)) * 100;
      const p = at(pct), hi = Math.max(p.front, p.rear);
      if (!lightOn && hi >= R.b.lightOnPsi) lightOn = true; else if (lightOn && hi <= R.b.lightOffPsi) lightOn = false;
      draw(pct, lightOn);
      raf = requestAnimationFrame(frame);
    }

    const api = {
      set(r) { R = r; if (!playing) draw(r.b.pedalPct, r.lightOn); },
      play() { if (!R) return; playing = true; t0 = 0; lightOn = false; cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); },
      stop() { if (playing) { playing = false; cancelAnimationFrame(raf); if (R) draw(R.b.pedalPct, R.lightOn); } },
      get playing() { return playing; },
      onEnd: null
    };
    return api;
  }
  window.BRBrake = { mount };
})();
