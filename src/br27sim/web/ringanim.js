// Wheel speed tone ring, animated: the ring with its teeth spins past the sensor, the sensor's
// signal scrolls by, and the numbers walk from the time between teeth to wheel rpm to car speed.
// Pure geometry, so it runs without calling the model. window.BRRing.mount(svg, conv) returns
// { set({teeth, ringMM, gapMM, sensor, tireD, kmh, slow}), start(), stop() }.
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const fmt = (x, d) => (x == null || !isFinite(x) ? '–' : Number(x).toFixed(d));

  function mount(svg, conv) {
    let P = null, raf = 0, last = 0, angle = 0, running = false;
    const trace = [];          // recent sensor samples for the scrolling signal
    let simT = 0;

    function build() {
      const p = P, cx = 190, cy = 180, R = 135;
      const pitch = 2 * Math.PI / p.teeth, toothFrac = 0.5;
      const depth = Math.max(8, Math.min(18, R * 0.12));
      let teeth = '';
      for (let i = 0; i < p.teeth; i++) {
        const a0 = i * pitch, a1 = a0 + pitch * toothFrac;
        const pt = (a, r) => `${cx + r * Math.sin(a)},${cy - r * Math.cos(a)}`;
        teeth += `<polygon class="tooth" data-i="${i}" points="${pt(a0, R - depth)} ${pt(a0, R)} ${pt(a1, R)} ${pt(a1, R - depth)}"/>`;
      }
      const gapPx = Math.max(4, Math.min(22, p.gapMM * 8));    // drawn larger than scale so it shows
      const isHall = p.sensor === 'hall';
      svg.innerHTML = `
        <defs><marker id="rArr" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-2)"/></marker></defs>
        <g id="rRing">
          <circle cx="${cx}" cy="${cy}" r="${R - depth}" fill="var(--panel)" stroke="var(--ink-3)"/>
          <circle cx="${cx}" cy="${cy}" r="${R * 0.32}" fill="var(--bg)" stroke="var(--ink-3)"/>
          ${[0, 1, 2, 3, 4].map(k => { const a = k * 2 * Math.PI / 5; return `<circle cx="${cx + R * 0.48 * Math.sin(a)}" cy="${cy - R * 0.48 * Math.cos(a)}" r="6" fill="var(--bg)" stroke="var(--ink-3)"/>`; }).join('')}
          <g fill="var(--ink-2)">${teeth}</g>
          <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy + R * 0.3}" stroke="var(--accent)" stroke-width="3"/>
        </g>
        <rect x="${cx - 14}" y="${cy - R - gapPx - 62}" width="28" height="62" rx="4" fill="#26201f" stroke="var(--ink-3)"/>
        <rect x="${cx - 9}" y="${cy - R - gapPx - 6}" width="18" height="6" fill="${isHall ? 'var(--s1)' : 'var(--s2)'}"/>
        <line x1="${cx}" y1="${cy - R - gapPx - 62}" x2="${cx}" y2="${cy - R - gapPx - 90}" stroke="${isHall ? 'var(--s1)' : 'var(--s2)'}" stroke-width="3"/>
        <text x="${cx + 22}" y="${cy - R - gapPx - 40}" font-size="13" fill="var(--ink)" font-weight="600">${isHall ? 'Hall sensor' : 'VR sensor'}</text>
        <text x="${cx + 22}" y="${cy - R - gapPx - 24}" font-size="11.5" fill="var(--ink-2)">air gap ${conv.len(p.gapMM, 3)} (drawn larger)</text>
        <text x="${cx}" y="${cy + R + 24}" font-size="12" text-anchor="middle" fill="var(--ink-2)">${p.teeth} teeth · ring ${conv.len(p.ringMM, 1)} across · tooth ${conv.len(Math.PI * p.ringMM / p.teeth / 2, 2)} wide</text>
        <path d="M ${cx + R + 16} ${cy - 40} A ${R + 16} ${R + 16} 0 0 1 ${cx + R + 16} ${cy + 40}" fill="none" stroke="var(--ink-2)" marker-end="url(#rArr)"/>
        <text x="420" y="34" font-size="13" fill="var(--ink)" font-weight="600">Sensor output</text>
        <text x="880" y="34" font-size="11.5" text-anchor="end" fill="var(--ink-2)" id="rSigNote"></text>
        <rect x="420" y="46" width="460" height="120" fill="var(--bg)" rx="4"/>
        <polyline id="rSig" fill="none" stroke="${isHall ? 'var(--s1)' : 'var(--s2)'}" stroke-width="2"/>
        <line id="rThr" x1="420" x2="880" stroke="var(--crit-ink)" stroke-dasharray="4 4" stroke-width="1"/>
        <g id="rPeriod"></g>`;
    }

    function signal(phase, kmh) {
      // phase: position of the sensor within one tooth pitch (0..1); tooth under the sensor for phase < 0.5
      if (P.sensor === 'hall') return phase < 0.5 ? 1 : 0;
      const amp = Math.min(1, kmh / 60);  // VR output grows with speed (scaled for the picture)
      return amp * Math.sin(2 * Math.PI * phase);
    }

    function draw() {
      const p = P;
      const ring = svg.querySelector('#rRing');
      if (!ring) return;
      ring.setAttribute('transform', `rotate(${(angle * 180 / Math.PI) % 360} 190 180)`);
      // tooth under the sensor (sensor at 12 o'clock; ring turns clockwise)
      const pitch = 2 * Math.PI / p.teeth;
      const rel = ((-angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const idx = Math.floor(rel / pitch), ph = (rel / pitch) % 1;
      svg.querySelectorAll('.tooth').forEach(t => t.setAttribute('fill', +t.dataset.i === idx && ph < 0.5 ? (p.sensor === 'hall' ? 'var(--s1)' : 'var(--s2)') : 'var(--ink-2)'));
      // trace: x = recent tooth phases
      // last six tooth pitches that went past the sensor, oldest on the left (steady speed, so angle = time)
      const N = 300, span = 6 * pitch, pts = [];
      for (let i = 0; i <= N; i++) {
        const a = angle + span * (1 - i / N);
        const r2 = ((-a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const s = p.kmh > 0 ? signal((r2 / pitch) % 1, p.kmh) : (p.sensor === 'hall' ? (ph < 0.5 ? 1 : 0) : 0);
        pts.push(`${420 + (i / N) * 460},${p.sensor === 'hall' ? 150 - s * 90 : 106 - s * 52}`);
      }
      svg.querySelector('#rSig').setAttribute('points', pts.join(' '));
      const thr = svg.querySelector('#rThr');
      if (p.sensor === 'vr') { thr.setAttribute('y1', 106 - 52 * 0.15); thr.setAttribute('y2', 106 - 52 * 0.15); thr.style.display = ''; } else thr.style.display = 'none';
      svg.querySelector('#rSigNote').textContent = p.sensor === 'hall' ? '0 to 5 V square wave, one pulse per tooth' : 'AC sine, bigger with speed; chip triggers at the dashed line';
    }

    function numbers() {
      const p = P, U = conv;
      const v = p.kmh / 3.6;                                   // m/s
      const circM = Math.PI * p.tireD;                         // tire circumference
      const rps = v / circM, rpm = rps * 60;
      const fHz = rps * p.teeth, periodMs = fHz > 0 ? 1000 / fHz : Infinity;
      const ringSurf = Math.PI * p.ringMM / 1000 * rps;        // m/s at the tooth tips
      const imp = U.imp();
      const tireTxt = imp ? `${fmt(p.tireD * 39.3701, 1)} in` : `${fmt(p.tireD * 1000, 0)} mm`;
      const spdTxt = imp ? `${fmt(p.kmh / 1.609344, 1)} mph` : `${fmt(p.kmh, 1)} km/h`;
      const back = periodMs < Infinity ? 60000 / (p.teeth * periodMs) : 0;
      const spdBack = imp ? back * circM * 60 / 1609.344 : back * circM * 60 / 1000;
      const unit = imp ? 'mph' : 'km/h';
      const rows = [
        ['1', 'Node times the gap between two teeth', periodMs < Infinity ? `${fmt(periodMs, 3)} ms` : 'no teeth (stopped)'],
        ['2', `Tooth rate = 1 ÷ period`, `${fmt(fHz, 1)} Hz`],
        ['3', `Wheel rpm = 60 × tooth rate ÷ ${p.teeth} teeth`, `${fmt(back, 1)} rpm`],
        ['4', `Speed = rpm × π × ${tireTxt} tire ÷ ${imp ? '1056 (in/min → mph)' : '16.67 (m/min → km/h)'}`, `${fmt(spdBack, 1)} ${unit}`],
      ];
      return { rows, rpm, ringSurf, spdTxt, tireTxt };
    }

    function frame(t) {
      if (!running) return;
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
      last = t;
      const p = P;
      const rps = (p.kmh / 3.6) / (Math.PI * p.tireD);
      const step = 2 * Math.PI * rps * dt * p.slow;
      angle -= step;    // clockwise on screen
      simT += dt;
      draw();
      raf = requestAnimationFrame(frame);
    }

    return {
      set(p) {
        const rebuild = !P || ['teeth', 'ringMM', 'gapMM', 'sensor'].some(k => P[k] !== p[k]) || P.units !== p.units;
        P = Object.assign({}, p);
        if (rebuild) { build(); trace.length = 0; }
        draw();
        return numbers();
      },
      start() { if (!running) { running = true; last = 0; raf = requestAnimationFrame(frame); } },
      stop() { running = false; cancelAnimationFrame(raf); },
      numbers: () => (P ? numbers() : null)
    };
  }
  window.BRRing = { mount };
})();
