/* Slow-motion inline-4 animation and the 720-degree timing strip. */
(function (root) {
  'use strict';
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const STROKES = ['Power', 'Exhaust', 'Intake', 'Compression'];
  const mod = (a, n) => ((a % n) + n) % n;

  function fitCanvas(c) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  // phase of one cylinder in its own 720 deg cycle, 0 = its firing TDC
  const phaseOf = (theta, cyl) => mod(theta - cyl.tdc, 720);
  const inWindow = (theta, start, end) => {
    // start/end in absolute cycle degrees, may wrap
    const len = mod(end - start, 720);
    return len > 0 && mod(theta - start, 720) <= len;
  };

  function drawEngine(canvas, ev, theta) {
    const { ctx, w, h } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const ink = css('--ink'), ink3 = css('--ink-3'), rule = css('--rule');
    const narrow = w < 560;
    const engW = narrow ? w : w * 0.72;
    const bore = Math.min(64, engW / 6.2);
    const gap = (engW - 4 * bore) / 5;
    const topY = 104, stroke = bore * 0.9, rod = stroke * 1.7;
    const crankY = topY + bore * 0.35 + stroke + rod + 8;
    ctx.font = '600 12px ' + css('--f-body');
    ctx.textAlign = 'center';

    // crankshaft centre line
    ctx.strokeStyle = rule; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(gap * 0.6, crankY); ctx.lineTo(engW - gap * 0.6, crankY); ctx.stroke();

    const firingNow = ev.cyl.find(c => phaseOf(theta, c) < 40 || phaseOf(theta, c) > 720 - ev.advance);
    for (let i = 0; i < 4; i++) {
      const c = ev.cyl[i];
      const x = gap + i * (bore + gap) + bore / 2;
      const ph = phaseOf(theta, c);
      const strokeIdx = Math.floor(ph / 180);
      // crank pin: cylinders 1 and 4 at 0 deg, 2 and 3 at 180 deg (flat plane)
      const pin = (c.cyl === 1 || c.cyl === 4) ? 0 : 180;
      const a = (theta - pin) * Math.PI / 180;
      const r = stroke / 2;
      const pinX = x + r * Math.sin(a), pinY = crankY - r * Math.cos(a);
      const pistonY = pinY - Math.sqrt(rod * rod - Math.pow(pinX - x, 2));
      const headY = topY;

      // chamber fill by stroke
      let fill = css('--bg');
      if (strokeIdx === 0) { const k = 1 - ph / 180; fill = `rgba(235,104,52,${0.25 + 0.6 * k})`; }
      else if (strokeIdx === 1) fill = 'rgba(122,129,140,0.35)';
      else if (strokeIdx === 2) fill = 'rgba(42,120,214,0.22)';
      else fill = 'rgba(42,120,214,0.10)';
      ctx.fillStyle = fill;
      ctx.fillRect(x - bore / 2, headY, bore, pistonY - headY);

      // cylinder walls
      ctx.strokeStyle = ink3; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - bore / 2, headY); ctx.lineTo(x - bore / 2, topY + stroke + bore * 0.5);
      ctx.moveTo(x + bore / 2, headY); ctx.lineTo(x + bore / 2, topY + stroke + bore * 0.5);
      ctx.moveTo(x - bore / 2 - 4, headY); ctx.lineTo(x + bore / 2 + 4, headY);
      ctx.stroke();

      // piston and rod
      ctx.fillStyle = css('--ink-2');
      ctx.fillRect(x - bore / 2 + 2, pistonY, bore - 4, bore * 0.35);
      ctx.strokeStyle = css('--ink-2'); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x, pistonY + bore * 0.2); ctx.lineTo(pinX, pinY); ctx.stroke();
      ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(pinX, pinY, 4, 0, Math.PI * 2); ctx.fill();

      // coil on plug: glows during dwell
      const dwelling = !ev.cut && inWindow(theta, c.dwellStart, c.spark);
      ctx.fillStyle = dwelling ? css('--s4') : css('--panel');
      ctx.strokeStyle = ink3; ctx.lineWidth = 1.5;
      ctx.fillRect(x - 9, headY - 34, 18, 26); ctx.strokeRect(x - 9, headY - 34, 18, 26);
      ctx.beginPath(); ctx.moveTo(x, headY - 8); ctx.lineTo(x, headY + 3); ctx.stroke();

      // spark: short flash right after the spark angle
      const sinceSpark = mod(theta - c.spark, 720);
      if (!ev.cut && sinceSpark < 14) {
        ctx.fillStyle = css('--s4');
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const rr = k % 2 ? 5 : 14, aa = k * Math.PI / 5;
          ctx.lineTo(x + rr * Math.cos(aa), headY + 8 + rr * Math.sin(aa));
        }
        ctx.closePath(); ctx.fill();
      }

      // port injector on the runner, sprays while open
      const injX = x - bore / 2 - 2, injY = headY - 18;
      const spraying = !ev.cut && ev.injDeg > 0 && inWindow(theta, c.injStart, c.injEnd);
      ctx.strokeStyle = spraying ? css('--s1') : ink3; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(injX - 12, injY - 10); ctx.lineTo(injX, injY); ctx.stroke();
      if (spraying) {
        ctx.fillStyle = css('--s1') + '88';
        ctx.beginPath(); ctx.moveTo(injX, injY); ctx.lineTo(injX + 12, injY + 18); ctx.lineTo(injX + 2, injY + 22); ctx.closePath(); ctx.fill();
      }

      ctx.fillStyle = ink;
      ctx.fillText(`Cyl ${c.cyl}`, x, headY - 44);
      ctx.fillStyle = strokeIdx === 0 ? css('--s2') : css('--ink-2');
      ctx.font = '500 11.5px ' + css('--f-body');
      ctx.fillText(STROKES[strokeIdx], x, crankY + stroke / 2 + 22);
      ctx.font = '600 12px ' + css('--f-body');
    }

    // firing order banner
    ctx.textAlign = 'left';
    ctx.fillStyle = css('--ink-2');
    ctx.font = '500 12px ' + css('--f-body');
    ctx.fillText('Firing order', 8, 16);
    ctx.font = '700 20px ' + css('--f-display');
    let fx = 8;
    for (const n of [1, 2, 4, 3]) {
      const on = firingNow && firingNow.cyl === n && !ev.cut;
      ctx.fillStyle = on ? css('--s2') : ink;
      ctx.fillText(String(n), fx, 38);
      fx += 22;
      if (n !== 3) { ctx.fillStyle = ink3; ctx.fillText('·', fx - 9, 38); }
    }
    ctx.font = '500 12px ' + css('--f-mono');
    ctx.fillStyle = css('--ink-2');
    ctx.fillText(`crank ${mod(theta, 720).toFixed(0).padStart(3, ' ')}°`, 120, 38);

    // trigger wheels (right side on wide screens)
    if (!narrow) {
      const cx = engW + (w - engW) / 2, R = Math.min(62, (w - engW) / 2 - 16), cy = 40 + R;
      const R2 = R * 0.45, cy2 = cy + R + 60 + R2;
      drawWheel(ctx, cx, cy, R, theta, ev, false);
      drawWheel(ctx, cx, cy2, R2, theta / 2, ev, true);
      ctx.textAlign = 'center'; ctx.fillStyle = css('--ink-2'); ctx.font = '500 11.5px ' + css('--f-body');
      ctx.fillText('Crank wheel, 12 teeth (VR)', cx, cy + R + 18);
      ctx.fillText('Cam, 1 sync tooth (VR)', cx, cy2 + R2 + 18);
    }
  }

  function drawWheel(ctx, cx, cy, R, deg, ev, cam) {
    const ink3 = css('--ink-3');
    const teeth = cam ? 1 : Math.round(360 / ev.toothDeg), missing = cam ? 0 : teeth - ev.teeth.length / 2;
    ctx.strokeStyle = ink3; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.82, 0, Math.PI * 2); ctx.stroke();
    let sensorHit = false;
    for (let i = 0; i < teeth - missing; i++) {
      const a = (i * 360 / teeth + deg) * Math.PI / 180 - Math.PI / 2;
      const span = cam ? 0.35 : Math.PI / teeth;
      const near = Math.abs(mod((a + Math.PI / 2) * 180 / Math.PI, 360)) < (cam ? 20 : 4);
      if (near) sensorHit = true;
      ctx.fillStyle = near ? css('--s3') : css('--ink-2');
      ctx.beginPath();
      ctx.arc(cx, cy, R, a - span / 2, a + span / 2);
      ctx.arc(cx, cy, R * 0.82, a + span / 2, a - span / 2, true);
      ctx.closePath(); ctx.fill();
    }
    // sensor at 12 o'clock
    ctx.fillStyle = sensorHit ? css('--s3') : css('--panel');
    ctx.strokeStyle = ink3;
    ctx.fillRect(cx - 6, cy - R - 22, 12, 16); ctx.strokeRect(cx - 6, cy - R - 22, 12, 16);
  }

  function drawTiming(canvas, ev, theta) {
    const { ctx, w, h } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const left = 92, right = 10, top = 10, bottom = 26;
    const X = d => left + mod(d, 720) / 720 * (w - left - right);
    const rows = ['Crank 12', 'Cam', 'Cyl 1', 'Cyl 2', 'Cyl 3', 'Cyl 4'];
    const rh = (h - top - bottom) / rows.length;
    const ink2 = css('--ink-2'), ink3 = css('--ink-3'), grid = css('--grid');
    ctx.font = '500 11.5px ' + css('--f-body');
    ctx.textAlign = 'left';
    rows.forEach((r, i) => {
      ctx.fillStyle = ink2; ctx.fillText(r, 6, top + rh * i + rh / 2 + 4);
      ctx.fillStyle = grid; ctx.fillRect(left, top + rh * (i + 1) - 1, w - left - right, 1);
    });
    // degree ticks
    ctx.fillStyle = ink3; ctx.textAlign = 'center';
    for (let d = 0; d <= 720; d += 90) {
      const x = left + d / 720 * (w - left - right);
      ctx.fillRect(x, top, 1, h - top - bottom);
      ctx.fillText(d + '°', Math.min(x, w - 18), h - 8);
    }
    // crank teeth
    const y0 = top + rh * 0.25, th = rh * 0.5;
    ctx.fillStyle = css('--ink-2');
    const tw = Math.max(1, ev.toothDeg / 720 * (w - left - right) * 0.5);
    for (const t of ev.teeth) ctx.fillRect(X(t), y0, tw, th);
    // cam tooth
    ctx.fillStyle = css('--s3');
    ctx.fillRect(X(ev.camDeg), top + rh + rh * 0.25, Math.max(3, 20 / 720 * (w - left - right)), th);

    const seg = (y, a, b, color, hgt) => {
      const len = mod(b - a, 720);
      if (len <= 0) return;
      const x0 = X(a), x1 = x0 + len / 720 * (w - left - right);
      ctx.fillStyle = color;
      const maxX = w - right;
      if (x1 <= maxX) ctx.fillRect(x0, y, x1 - x0, hgt);
      else { ctx.fillRect(x0, y, maxX - x0, hgt); ctx.fillRect(left, y, x1 - maxX, hgt); }
    };
    ev.cyl.forEach((c, i) => {
      const yr = top + rh * (i + 2);
      // power stroke shading
      seg(yr + 2, c.tdc, c.tdc + 180, 'rgba(235,104,52,0.14)', rh - 4);
      if (!ev.cut) {
        if (ev.injDeg > 0) seg(yr + rh * 0.18, c.injStart, c.injEnd, css('--s1'), rh * 0.26);
        seg(yr + rh * 0.56, c.dwellStart, c.spark, css('--s4'), rh * 0.26);
        ctx.fillStyle = css('--s2');
        ctx.fillRect(X(c.spark) - 1, yr + 3, 3, rh - 6);
      }
      ctx.fillStyle = ink3;
      ctx.fillText('TDC', X(c.tdc), yr + rh - 3);
    });
    // cursor
    ctx.fillStyle = css('--accent');
    ctx.fillRect(X(theta) - 1, top, 2, h - top - bottom);
  }

  root.BREngine = { drawEngine, drawTiming };
})(window);
