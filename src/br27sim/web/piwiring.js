// Dash computer wiring: Raspberry Pi to the 5 in TFT, the three buttons, the CAN HAT, the 5 V supply,
// and (when switched on) LoRa, IMU and GPS. Pin choices keep clear of the CAN HAT's SPI0 + GPIO25.
// window.BRPiWiring.draw({ svg, table, flags, cfg, note }, r, U) where r is a simulatePi() result.
(function () {
  'use strict';
  const fmt = (x, d) => (x == null || !isFinite(x) ? '–' : Number(x).toFixed(d));
  const C = { p5: '#d63b30', gnd: '#222', sig: '#2a78d6', can: '#1baf7a', can2: '#e8e8e8', hdmi: '#6250d6', usb: '#8a8f98', btn: '#eda100' };

  function draw(el, r, U) {
    const o = r.o, b = r.board, disp = r.display, dsi = disp.port === 'dsi', usbCan = o.canIface === 'usb', pi = b.linux;
    const pi3 = r.boardKey === 'pi3', pi5 = r.boardKey === 'pi5';
    const hdmiPort = pi3 ? 'HDMI' : r.boardKey === 'zero2' ? 'mini HDMI' : 'micro HDMI';
    let g = `<defs><marker id="pwDot" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5"><circle cx="5" cy="5" r="4" fill="var(--ink)"/></marker></defs>`;
    const box = (x, y, w, h, title, sub, fill) => {
      g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill || 'var(--panel)'}" stroke="var(--ink-2)" stroke-width="1.5"/>`;
      g += `<text x="${x + 10}" y="${y + 20}" font-size="13" font-weight="600" fill="${fill ? '#f2f2f2' : 'var(--ink)'}">${title}</text>`;
      (sub || []).forEach((s, k) => { g += `<text x="${x + 10}" y="${y + 37 + k * 15}" font-size="11" fill="${fill ? '#c4c8cf' : 'var(--ink-2)'}">${s}</text>`; });
    };
    const wire = (pts, col, w, dash, label, lx, ly, anchor) => {
      g += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${col}" stroke-width="${w || 2}" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linejoin="round" marker-start="url(#pwDot)" marker-end="url(#pwDot)"/>`;
      if (label) g += `<text x="${lx}" y="${ly}" font-size="10.5" fill="var(--ink-2)" text-anchor="${anchor || 'start'}" font-family="var(--f-mono)">${label}</text>`;
    };
    // power
    box(20, 30, 220, 62, 'Switched 12 V bus', ['after the master switch and kill relay,', 'fused in the electrical box']);
    box(20, 170, 220, 76, '5 V 5 A module (screen + dash)', ['Universal-Solder, 9–35 V in,', 'screw terminals [central 5 V supply]']);
    wire([[90, 92], [90, 170]], C.p5, 3, '', '+12 V', 96, 135); wire([[150, 92], [150, 170]], C.gnd, 3, '', 'GND', 156, 135);
    // screen
    box(330, 10, 330, 130, `${disp.label.split('[')[0].trim()}`, [dsi ? 'DSI ribbon for video, 5 V from the module' : 'HDMI for video, USB for touch,', dsi ? '' : '5 V from the module (not the Pi\'s USB)'], '#1b1d22');
    g += `<rect x="350" y="74" width="200" height="56" rx="3" fill="#050505"/><text x="450" y="107" font-size="12" text-anchor="middle" fill="#c9a86a" font-family="var(--f-display)">BR27 DASH</text>`;
    // Pi
    const piLabel = `${b.label}${r.ramGB ? ` · ${r.ramGB >= 1 ? r.ramGB + ' GB' : r.ramGB * 1024 + ' MB'}` : ''}`;
    box(330, 230, 300, 200, piLabel, [pi ? 'Linux dash computer' : 'firmware (pins differ from the Pi header)', pi5 ? 'USB-C power in (5 V)' : 'USB power in (5 V)'], '#163a24');
    g += `<rect x="640" y="236" width="22" height="188" rx="2" fill="#0e0e0e"/>`;
    for (let k = 0; k < 20; k++) g += `<circle cx="646" cy="${242 + k * 9.2}" r="2.4" fill="#d4b98a"/><circle cx="656" cy="${242 + k * 9.2}" r="2.4" fill="#d4b98a"/>`;
    g += `<text x="651" y="440" font-size="10" text-anchor="middle" fill="var(--ink-2)">40-pin</text>`;
    // power wires to the Pi and the screen
    wire([[240, 208], [290, 208], [290, 300], [330, 300]], C.p5, 3, '', pi5 ? 'USB-C pigtail 5 V' : '5 V', 274, 280, 'end');
    wire([[240, 226], [280, 226], [280, 316], [330, 316]], C.gnd, 3);
    wire([[240, 186], [300, 186], [300, 110], [330, 110]], C.p5, 2.5, '', 'screen 5 V', 304, 150);
    // video and touch
    if (dsi) wire([[480, 230], [480, 140]], C.usb, 8, '', `DSI ribbon (${pi5 ? '22-pin' : '15-pin'})`, 490, 185);
    else {
      wire([[460, 230], [460, 140]], C.hdmi, 5, '', `${hdmiPort} → HDMI`, 470, 175);
      wire([[600, 230], [600, 140]], C.usb, 2, '5 4', 'USB-A: touch', 606, 200);
    }
    // CAN
    if (usbCan) {
      box(720, 230, 260, 74, 'USB CAN adapter (CANable / gs_usb)', ['plugs into a USB-A port', 'CAN_H / CAN_L screw terminal']);
      wire([[630, 410], [700, 410], [700, 268], [720, 268]], C.usb, 2, '5 4', 'USB-A', 704, 404);
    } else {
      box(720, 220, 260, 92, o.canIface === 'mcp2515' ? 'CAN HAT (MCP2515, 2 rx buffers)' : 'CAN HAT (MCP2518FD, 31-frame FIFO)', ['stacks on the 40-pin header', 'SPI0 + CE0 (GPIO8) + INT GPIO25', '120 Ω jumper ON (dash = bus end)']);
      wire([[662, 246], [720, 246]], C.sig, 6);
    }
    box(760, 40, 220, 90, 'CAN 2.0 bus, 1 Mbit/s', ['dash (120 Ω) → electrical box →', 'FR → FL → seat → EMU → RR → RL', 'twisted pair, 22 AWG TXL']);
    wire([[900, usbCan ? 230 : 220], [900, 130]], C.can, 3, '', 'CAN_H', 894, 180, 'end'); wire([[920, usbCan ? 230 : 220], [920, 130]], C.can2, 3, '', 'CAN_L', 926, 196);
    // optional peripherals
    let y = 330;
    const per = [];
    if (o.lora) per.push(['LoRa radio (RFM95W / SX1276, 915 MHz)', 'SPI0 CE1 (GPIO7), DIO0 GPIO24, RST GPIO17, 3.3 V', 290]);
    if (o.imu) per.push(['IMU (I2C)', 'SDA GPIO2, SCL GPIO3, 3.3 V', 330]);
    if (o.gps) per.push(['GPS (UART)', 'Pi TX GPIO14 → GPS RX, Pi RX GPIO15 ← GPS TX', 370]);
    per.forEach(([t, s, py], k) => {
      const by = y + k * 64;
      box(720, by, 260, 54, t, [s]);
      wire([[662, Math.min(410, py + k * 6)], [690, Math.min(410, py + k * 6)], [690, by + 27], [720, by + 27]], C.sig, 2);
    });
    // buttons
    const touch = !!o.touchButtons;          // capacitive touch: MENU and CLEAR are on the screen, only MODE is wired
    const bx = touch ? [480] : [380, 480, 580], names = ['MODE', 'CLEAR', 'MENU'], gp = ['GPIO5 (pin 29)', 'GPIO6 (pin 31)', 'GPIO13 (pin 33)'];
    box(330, 500, 330, 120, touch ? 'Steering wheel button' : 'Steering wheel buttons', [touch ? 'MODE only; MENU and CLEAR are tapped on the touch screen' : 'momentary, sealed, switch to ground']);
    bx.forEach((x, k) => {
      g += `<circle cx="${x}" cy="580" r="20" fill="${k === 1 ? '#7f1d1d' : '#222'}" stroke="#666" stroke-width="2"/><text x="${x}" y="584" font-size="10" text-anchor="middle" fill="#fff" font-weight="700">${names[k]}</text>`;
      wire([[x, 560], [x, 470 - k * 10], [675 + k * 8, 470 - k * 10], [675 + k * 8, 395 + k * 9], [662, 395 + k * 9]], C.btn, 2);
      g += `<text x="${x}" y="614" text-anchor="middle" font-size="9.5" fill="var(--ink-2)" font-family="var(--f-mono)">${gp[k]}</text>`;
    });
    wire([[630, 600], [710, 600], [710, 420], [662, 420]], C.gnd, 2, '', 'common GND (pin 34)', 714, 560);
    g += `<text x="20" y="300" font-size="12" font-weight="600" fill="var(--ink)">Wire colors</text>`;
    [['5 V', C.p5], ['GND', C.gnd], ['signal / SPI / I2C / UART', C.sig], ['buttons', C.btn], ['HDMI', C.hdmi], ['USB', C.usb], ['CAN_H / CAN_L', C.can]].forEach(([t, c], k) => {
      g += `<line x1="20" y1="${318 + k * 18}" x2="50" y2="${318 + k * 18}" stroke="${c}" stroke-width="3"/><text x="58" y="${322 + k * 18}" font-size="11" fill="var(--ink-2)">${t}</text>`;
    });
    if (!pi) g += `<text x="20" y="470" font-size="12" fill="var(--crit-ink)">A Pico has no 40-pin header, HDMI or DSI:</text><text x="20" y="486" font-size="12" fill="var(--crit-ink)">this drawing is for the Raspberry Pi boards.</text>`;
    el.svg.innerHTML = g;
    el.note.textContent = `${piLabel} · ${disp.label.split('[')[0].trim()}`;

    // pin table
    const rows = [
      ['5 V in', pi5 ? 'USB-C (or pins 2 + 4)' : 'USB (or pins 2 + 4)', '—', '5 V 5 A module +', 'USB-C pigtail keeps the Pi\'s input protection; pins 2/4 bypass it'],
      ['GND', 'USB-C (or pins 6 + 14)', '—', '5 V module −', ''],
      ['Video', dsi ? 'DSI connector' : hdmiPort, '—', '5 in TFT', dsi ? 'ribbon, clamp it against vibration' : 'locking or glued connector against vibration'],
      ...(dsi ? [] : [['Touch', 'USB-A', '—', '5 in TFT USB', 'touch only; the screen\'s 5 V comes from the module']]),
      ...(usbCan ? [['CAN', 'USB-A', '—', 'USB CAN adapter', 'shows up as can0 (gs_usb)']] : [
        ['CAN HAT SPI MOSI', 'pin 19', 'GPIO10', 'HAT', 'through the stacking header'], ['CAN HAT SPI MISO', 'pin 21', 'GPIO9', 'HAT', ''], ['CAN HAT SPI SCLK', 'pin 23', 'GPIO11', 'HAT', ''],
        ['CAN HAT chip select', 'pin 24', 'GPIO8 (CE0)', 'HAT', ''], ['CAN HAT interrupt', 'pin 22', 'GPIO25', 'HAT', 'check the HAT\'s pin map'], ['CAN HAT power', 'pins 1, 2, 6', '3.3 V, 5 V, GND', 'HAT', '']]),
      ['CAN_H / CAN_L', 'HAT screw terminal', '—', 'car CAN bus', '120 Ω jumper on: the dash is the front end'],
      ...(o.lora ? [['LoRa chip select', 'pin 26', 'GPIO7 (CE1)', 'RFM95W NSS', 'shares SPI0 with the CAN HAT'], ['LoRa DIO0', 'pin 18', 'GPIO24', 'RFM95W DIO0', 'packet done interrupt'], ['LoRa reset', 'pin 11', 'GPIO17', 'RFM95W RESET', ''], ['LoRa power', 'pin 17', '3.3 V', 'RFM95W 3.3 V', 'antenna outside any carbon or metal']] : []),
      ...(o.imu ? [['IMU SDA', 'pin 3', 'GPIO2', 'IMU SDA', 'I2C, keep the wires short'], ['IMU SCL', 'pin 5', 'GPIO3', 'IMU SCL', '']] : []),
      ...(o.gps ? [['GPS', 'pins 8 / 10', 'GPIO14 TX / GPIO15 RX', 'GPS RX / TX', 'crossed over; 3.3 V logic']] : []),
      ['MODE (button 1)', 'pin 29', 'GPIO5', 'button → GND', 'internal pull-up, 100 nF to GND'],
      ...(o.touchButtons ? [] : [['CLEAR (button 2)', 'pin 31', 'GPIO6', 'button → GND', ''], ['MENU', 'pin 33', 'GPIO13', 'button → GND', '']]),
      ['Button common', 'pin 34', 'GND', o.touchButtons ? 'MODE button' : 'all three buttons', 'through the wheel quick-release connector'],
      ['Power-loss sense (optional)', 'pin 37', 'GPIO26', 'supercap UPS "power lost" out', 'lets the Pi close the log before the power dies']
    ];
    el.table.innerHTML = '<thead><tr><th>Signal</th><th>Pi pin</th><th>GPIO</th><th>Goes to</th><th>Note</th></tr></thead><tbody>' +
      rows.map(x => `<tr><td>${x[0]}</td><td class="mono">${x[1]}</td><td class="mono">${x[2]}</td><td>${x[3]}</td><td class="wrap">${x[4]}</td></tr>`).join('') + '</tbody>';
    const amps = r.sel.watts / 5 + disp.W / 5 + 0.15 + (o.lora ? 0.12 : 0) + (o.gps ? 0.03 : 0) + (o.imu ? 0.01 : 0);
    const f = [
      [amps > 4 ? 'warn' : 'good', `5 V budget: Pi about ${fmt(r.sel.watts / 5, 1)} A, screen ${fmt(disp.W / 5, 1)} A, HAT and modules about ${fmt(0.15 + (o.lora ? 0.12 : 0) + (o.gps ? 0.03 : 0), 2)} A: ${fmt(amps, 1)} A of the module's 5 A.`],
      ['crit', 'The master switch and kill relay cut the Pi\'s power with no warning, which can corrupt the SD card. Run the root file system read-only (raspi-config → Overlay File System), write logs to their own partition and flush every buffer. A small supercap UPS with a power-lost signal on GPIO26 gives it time to close the file.'],
      ['info', 'Buttons switch to ground with the Pi\'s internal pull-ups. A 1 kΩ series resistor and 100 nF to ground at the Pi end stop noise and static from the harness. The dash software debounces them (about 30 ms).'],
      ['info', 'Pi GPIO is 3.3 V only: use 3.3 V logic modules (or level shifters) for LoRa, IMU and GPS.']
    ];
    if (pi5) f.splice(1, 0, ['warn', 'A Pi 5 on a plain 5 V supply (no USB-PD) limits its USB ports to 600 mA. Power the screen from the module as drawn, or add usb_max_current_enable=1.']);
    if (o.canIface === 'mcp2515') f.push(['warn', `The MCP2515 has only 2 receive buffers; at ${r.fps} frames/s Linux can miss frames. The MCP2518FD HAT has a 31-frame FIFO.`]);
    el.flags.innerHTML = f.map(([l, t]) => `<li class="${l}">${t}</li>`).join('');
    const cfg = ['# CAN HAT on SPI0, interrupt on GPIO25 (check the HAT\'s crystal and pin map)', 'dtparam=spi=on'];
    if (o.canIface === 'mcp2515') cfg.push('dtoverlay=mcp2515-can0,oscillator=12000000,interrupt=25,spimaxfrequency=2000000');
    else if (o.canIface === 'mcp2518fd') cfg.push('dtoverlay=mcp251xfd,spi0-0,interrupt=25');
    else cfg.splice(0, 2, '# USB CAN adapter: no overlay needed, it appears as can0');
    if (o.imu) cfg.push('dtparam=i2c_arm=on');
    if (o.gps) cfg.push('enable_uart=1');
    cfg.push('# buttons as keys for the dash program (active low, pull-up)',
      'dtoverlay=gpio-key,gpio=5,active_low=1,gpio_pull=up,keycode=50,label="MODE"',
      ...(o.touchButtons ? ['# MENU and CLEAR: on-screen buttons on the capacitive touch screen'] : ['dtoverlay=gpio-key,gpio=6,active_low=1,gpio_pull=up,keycode=46,label="CLEAR"',
        'dtoverlay=gpio-key,gpio=13,active_low=1,gpio_pull=up,keycode=28,label="MENU"']));
    if (pi5) cfg.push('# only if the screen is powered from the Pi\'s USB', '# usb_max_current_enable=1');
    if (!dsi) cfg.push('# if the 5 in screen shows the wrong size, add to cmdline.txt: video=HDMI-A-1:800x480@60D');
    cfg.push('', '# bring the bus up at boot (systemd-networkd or /etc/network/interfaces):', '# ip link set can0 up type can bitrate 1000000');
    el.cfg.textContent = cfg.join('\n');
  }
  window.BRPiWiring = { draw };
})();
