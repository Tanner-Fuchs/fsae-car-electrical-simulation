// Bobcat Racing boot splash, shared by the mock dash (dashos.js) and the web version's loading screen (pyboot.js).
// window.BRSplash = { bobcat(op), frame(u, tSec, lines, sub) } returns SVG markup for an 800 × 480 screen.
(function () {
  'use strict';
  const MAROON = '#501214', GOLD = '#c9a86a', GOLD2 = '#e6cf9b';
  const T = (x, y, txt, size, o) => `<text x="${x}" y="${y}" font-size="${size}" ${o || ''}>${txt}</text>`;
  const MONO = 'font-family="var(--f-mono, ui-monospace, monospace)"', DISP = 'font-family="var(--f-display, system-ui, sans-serif)"';
  function bobcat(op) {
    // the boot-screen bobcat in an open-face racing helmet (same artwork as web/icon.svg)
    return `<g opacity="${op}" stroke-linejoin="round" stroke-linecap="round">
      <!-- ears poking through the helmet -->
      <polygon points="318,128 312,62 362,108" fill="#501214" stroke="#c9a86a" stroke-width="4"/>
      <polygon points="482,128 488,62 438,108" fill="#501214" stroke="#c9a86a" stroke-width="4"/>
      <polygon points="321,112 318,80 344,104" fill="#c9a86a" opacity="0.55"/>
      <polygon points="479,112 482,80 456,104" fill="#c9a86a" opacity="0.55"/>
      <!-- the boot-screen bobcat face -->
      <polygon points="330,120 352,168 448,168 470,120 486,190 480,240 450,278 400,296 350,278 320,240 314,190" fill="#501214" stroke="#c9a86a" stroke-width="4"/>
      <polyline points="314,212 292,232 320,238" fill="none" stroke="#c9a86a" stroke-width="3"/><polyline points="486,212 508,232 480,238" fill="none" stroke="#c9a86a" stroke-width="3"/>
      <polyline points="320,240 300,258 330,262" fill="none" stroke="#c9a86a" stroke-width="3"/><polyline points="480,240 500,258 470,262" fill="none" stroke="#c9a86a" stroke-width="3"/>
      <polygon points="356,206 386,198 389,214 364,218" fill="#ffcc33"/><polygon points="444,206 414,198 411,214 436,218" fill="#ffcc33"/>
      <line x1="374" y1="201" x2="376" y2="216" stroke="#111" stroke-width="3"/><line x1="426" y1="201" x2="424" y2="216" stroke="#111" stroke-width="3"/>
      <polygon points="388,238 412,238 400,252" fill="#111" stroke="#c9a86a" stroke-width="2"/>
      <polyline points="400,252 400,264 386,274" fill="none" stroke="#c9a86a" stroke-width="3"/><polyline points="400,264 414,274" fill="none" stroke="#c9a86a" stroke-width="3"/>
      <!-- open-face racing helmet: shell, cheek pads, raised visor, stripe -->
      <path d="M304,244 L302,186 C302,124 344,92 400,92 C456,92 498,124 498,186 L496,244 C486,248 478,240 476,226 C472,202 450,188 400,188 C350,188 328,202 324,226 C322,240 314,248 304,244 Z" fill="#e9e9ee" stroke="#c9a86a" stroke-width="5"/>
      <path d="M388,93 L412,93 L413,187 L387,187 Z" fill="#501214"/>
      <path d="M380,94 L384,94 L383,187 L379,187 Z M416,94 L420,94 L421,187 L417,187 Z" fill="#c9a86a"/>
      <path d="M318,150 C340,128 460,128 482,150 L478,170 C452,156 348,156 322,170 Z" fill="#121216" stroke="#c9a86a" stroke-width="4"/>
      <path d="M334,148 C356,136 400,133 430,135" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="3"/>
      <circle cx="318" cy="160" r="6" fill="#c9a86a"/><circle cx="482" cy="160" r="6" fill="#c9a86a"/>
      <circle cx="452" cy="116" r="13" fill="#501214" stroke="#c9a86a" stroke-width="2.5"/>
      <text x="452" y="121.5" font-size="14" font-weight="800" text-anchor="middle" fill="#e6cf9b" font-family="Arial, Helvetica, sans-serif">27</text>
    </g>`;
  }


  // u: progress 0..1, tSec: seconds since start (drives the speed streaks), lines: boot log, sub: line under the bar
  function frame(u, tSec, lines, sub, uid) {
    const bg = 'bootBg' + (uid || '');
    const zoom = 0.85 + 0.15 * Math.min(1, u * 2.5 + tSec * 0.6), op = Math.min(1, u * 3 + tSec * 1.5);
    let g = `<defs><radialGradient id="${bg}" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="#3a0d0f"/><stop offset="1" stop-color="#050404"/></radialGradient></defs><rect width="800" height="480" fill="url(#${bg})"/>`;
    for (let k = 0; k < 7; k++) {
      const x = ((tSec * 900 + k * 160) % 1100) - 200, y = 120 + k * 30;
      g += `<line x1="${x}" y1="${y}" x2="${x + 120}" y2="${y}" stroke="${GOLD}" stroke-opacity="${0.12 + 0.05 * (k % 3)}" stroke-width="3" stroke-linecap="round"/>`;
    }
    g += `<g transform="translate(400 200) scale(${zoom}) translate(-400 -200)">${bobcat(op)}</g>`;
    g += T(400, 350, 'BOBCAT RACING', 46, `text-anchor="middle" fill="${GOLD}" ${DISP} font-weight="700" letter-spacing="4" opacity="${op}"`);
    g += T(400, 378, 'BR27 · FSAE 2027', 16, `text-anchor="middle" fill="${GOLD2}" ${MONO} letter-spacing="3" opacity="${op}"`);
    g += `<rect x="250" y="400" width="300" height="8" rx="4" fill="#2a1a1a"/><rect x="250" y="400" width="${300 * Math.max(0, Math.min(1, u))}" height="8" rx="4" fill="${GOLD}"/>`;
    if (sub) g += T(400, 430, sub, 13, `text-anchor="middle" fill="#9aa4b1" ${MONO}`);
    g += (lines || []).slice(-3).map((l, k, a) => T(16, 470 - (a.length - 1 - k) * 14, `[ ok ] ${l}`, 11, `fill="#6b7280" ${MONO}`)).join('');
    return g;
  }
  window.BRSplash = { bobcat, frame };
})();
