// Dash computer wiring: Raspberry Pi to the 5 in TFT, the three buttons, the CAN HAT, the 5 V supply,
// and (when switched on) LoRa, IMU and GPS. Pin choices keep clear of the CAN HAT's SPI0 + GPIO25.
// window.BRPiWiring.draw({ svg, table, flags, cfg, note }, r, U) where r is a simulatePi() result.
(function () {
  'use strict';
  const fmt = (x, d) => (x == null || !isFinite(x) ? '–' : Number(x).toFixed(d));
  const C = { p5: '#d63b30', gnd: '#222', sig: '#2a78d6', can: '#1baf7a', can2: '#e8e8e8', hdmi: '#6250d6', usb: '#8a8f98', btn: '#eda100' };

  // Teensy 4.1 dash: EVE screen on SPI, CAN1 + CAN Pal, GPS on Serial2, IMU on I2C, LoRa on SPI1, hold-up cap on the 12 V feed.
  // Pin numbers are the Teensy 4.1 pinout card; all I/O is 3.3 V and NOT 5 V tolerant.
  function drawTeensy(el, r) {
    const o = r.o, disp = r.display, cut = r.sel.cut, hold = o.holdUp !== 'none';
    let g = `<defs><marker id="pwDot" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5"><circle cx="5" cy="5" r="4" fill="var(--ink)"/></marker></defs>`;
    const box = (x, y, w, h, title, sub, fill) => {
      g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill || 'var(--panel)'}" stroke="var(--ink-2)" stroke-width="1.5"/>`;
      g += `<text x="${x + 10}" y="${y + 20}" font-size="13" font-weight="600" fill="${fill ? '#f2f2f2' : 'var(--ink)'}">${title}</text>`;
      (sub || []).forEach((t, k) => { g += `<text x="${x + 10}" y="${y + 37 + k * 15}" font-size="11" fill="${fill ? '#c4c8cf' : 'var(--ink-2)'}">${t}</text>`; });
    };
    const wire = (pts, col, w, label, lx, ly, anchor) => {
      g += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${col}" stroke-width="${w || 2}" stroke-linejoin="round" marker-start="url(#pwDot)" marker-end="url(#pwDot)"/>`;
      if (label) g += `<text x="${lx}" y="${ly}" font-size="10.5" fill="var(--ink-2)" text-anchor="${anchor || 'start'}" font-family="var(--f-mono)">${label}</text>`;
    };
    box(20, 30, 220, 62, 'Switched 12 V bus', ['after the master switch and kill relay,', 'fused in the electrical box']);
    box(20, 130, 220, 62, hold ? 'Hold-up' : 'No hold-up', hold ? [o.holdUp === 'cap' ? 'Schottky diode + 2,200 µF 25 V' : 'diode + supercap bank', `about ${fmt(cut.holdS, cut.holdS < 1 ? 2 : 0)} s after the switch opens`] : ['the log loses its last buffer', 'on every switch-off']);
    box(20, 240, 220, 62, '5 V 5 A module (screen + dash)', ['Universal-Solder, 9–35 V in']);
    wire([[90, 92], [90, 130]], C.p5, 3, '+12 V', 96, 115); wire([[90, 192], [90, 240]], C.p5, 3, '+12 V held', 96, 220);
    wire([[200, 92], [200, 110], [270, 110], [270, 470], [330, 470]], C.sig, 1.5, 'power-fail divider → pin 41', 262, 492, 'end');
    box(330, 10, 330, 120, disp.label.split(':')[0], ['SPI + INT + PD, 5 V from the module', 'the BT817 chip draws the pixels and reads touch'], '#1b1d22');
    g += `<rect x="350" y="66" width="200" height="54" rx="3" fill="#050505"/><text x="450" y="98" font-size="12" text-anchor="middle" fill="#c9a86a" font-family="var(--f-display)">BR27 DASH</text>`;
    box(330, 230, 300, 260, 'Teensy 4.1', ['C++ firmware, 600 MHz Cortex-M7', 'microSD in the on-board SDIO slot', 'VIN 5 V (cut the VIN/VUSB pad if', 'USB and 5 V are both connected)'], '#163a24');
    wire([[240, 270], [300, 270], [300, 330], [330, 330]], C.p5, 3, 'VIN', 296, 262, 'end');
    wire([[240, 286], [286, 286], [286, 346], [330, 346]], C.gnd, 3);
    wire([[240, 254], [310, 254], [310, 100], [330, 100]], C.p5, 2.5, 'screen 5 V', 314, 170);
    wire([[560, 230], [560, 130]], C.sig, 2, 'SPI 11/12/13, CS 10, INT 6, PD 9', 568, 185);
    box(760, 230, 220, 62, 'Adafruit CAN Pal', ['TJA1051T/3, 120 Ω on (bus end)']);
    wire([[630, 270], [760, 270]], C.sig, 2, 'CTX1 22 / CRX1 23', 640, 262);
    wire([[980, 260], [995, 260], [995, 214]], C.can, 3, 'CAN_H / CAN_L', 990, 208, 'end');
    let y = 310;
    if (o.gps) { box(760, y, 220, 46, 'GPS (u-blox M10)', ['Serial2 RX2 7 / TX2 8, PPS → 32']); wire([[630, y + 22], [760, y + 22]], C.sig, 1.5); y += 56; }
    if (o.imu) { box(760, y, 220, 46, 'IMU', ['I2C SDA 18 / SCL 19, INT → 31']); wire([[630, y + 22], [760, y + 22]], C.sig, 1.5); y += 56; }
    if (o.lora) { box(760, y, 220, 46, 'LoRa RFM95W 915 MHz', ['SPI1 26/39/27, CS 38, DIO0 36']); wire([[630, y + 22], [760, y + 22]], C.sig, 1.5); y += 56; }
    box(330, 530, 300, 70, 'Wheel buttons', [o.touchButtons ? 'MODE → pin 2 (MENU / CLEAR on screen)' : 'MODE → 2, CLEAR → 3, MENU → 4', 'to GND, internal pull-ups']);
    wire([[480, 530], [480, 490]], C.btn, 2.5);
    g += `<text x="20" y="360" font-size="12" font-weight="600" fill="var(--ink)">Wire colors</text>`;
    [['5 V / 12 V', C.p5], ['GND', C.gnd], ['signal / SPI / I2C / UART', C.sig], ['buttons', C.btn], ['CAN_H / CAN_L', C.can]].forEach(([t, c], k) => {
      g += `<line x1="20" y1="${378 + k * 18}" x2="50" y2="${378 + k * 18}" stroke="${c}" stroke-width="3"/><text x="58" y="${382 + k * 18}" font-size="11" fill="var(--ink-2)">${t}</text>`;
    });
    el.svg.innerHTML = g;
    el.note.textContent = `Teensy 4.1 · ${disp.label.split(':')[0]}`;
    const rows = [
      ['5 V in', 'VIN', '—', '5 V 5 A module +', 'cut the VIN/VUSB pad, or USB programming back-feeds the 5 V rail'],
      ['GND', 'GND', '—', '5 V module −', ''],
      ['EVE SPI MOSI / MISO / SCK', '11 / 12 / 13', 'SPI', 'EVE screen', 'up to ~30 MHz; keep the ribbon short and clamped'],
      ['EVE chip select', '10', 'CS', 'EVE CS#', ''], ['EVE interrupt', '6', 'INT', 'EVE INT#', 'touch and display-list done'], ['EVE power down', '9', 'PD', 'EVE PD#', 'hold low to reset the screen'],
      ['CAN TX / RX', '22 / 23', 'CTX1 / CRX1', 'CAN Pal TX / RX', 'CAN Pal VCC 5 V, VIO 3.3 V'],
      ['CAN_H / CAN_L', 'CAN Pal terminal', '—', 'car CAN bus', '120 Ω on: the dash is the front end'],
      ...(o.gps ? [['GPS', '7 / 8', 'RX2 / TX2', 'GPS TX / RX', 'crossed over; UBX binary at 10–25 Hz'], ['GPS PPS', '32', 'interrupt', 'GPS PPS', 'lines up the log clock to GPS time']] : []),
      ...(o.imu ? [['IMU SDA / SCL', '18 / 19', 'Wire', 'IMU', 'or SPI for 1 kHz and up'], ['IMU data ready', '31', 'interrupt', 'IMU INT', '']] : []),
      ...(o.lora ? [['LoRa SPI1 MOSI / MISO / SCK', '26 / 39 / 27', 'SPI1', 'RFM95W', 'own bus, so the screen never waits on the radio'], ['LoRa CS / DIO0 / RESET', '38 / 36 / 35', '—', 'RFM95W', 'antenna outside any carbon or metal']] : []),
      ['MODE (button 1)', '2', 'INPUT_PULLUP', 'button → GND', '1 kΩ series + 100 nF to GND'],
      ...(o.touchButtons ? [] : [['CLEAR (button 2)', '3', 'INPUT_PULLUP', 'button → GND', ''], ['MENU', '4', 'INPUT_PULLUP', 'button → GND', '']]),
      ['Power-fail sense', '41 (A17)', 'interrupt', '12 V feed via 10k / 3.3k + 3.3 V zener', 'falls when the master switch opens: stop logging, sync, close']
    ];
    el.table.innerHTML = '<thead><tr><th>Signal</th><th>Teensy pin</th><th>Function</th><th>Goes to</th><th>Note</th></tr></thead><tbody>' +
      rows.map(x => `<tr><td>${x[0]}</td><td class="mono">${x[1]}</td><td class="mono">${x[2]}</td><td>${x[3]}</td><td class="wrap">${x[4]}</td></tr>`).join('') + '</tbody>';
    const amps = r.sel.amps + 0.08 + (o.lora ? 0.12 : 0) + (o.gps ? 0.03 : 0);
    el.flags.innerHTML = [
      ['good', `5 V budget: Teensy and screen about ${fmt(r.sel.amps, 1)} A, CAN Pal and modules about ${fmt(amps - r.sel.amps, 2)} A: ${fmt(amps, 1)} A of the module's 5 A.`],
      [cut.clean ? 'good' : 'warn', cut.clean ? `On a power cut the hold-up gives ${fmt(cut.holdS, 2)} s; the power-fail interrupt needs about ${fmt(cut.needS, 2)} s to sync and close the log. Turn the screen backlight off first to stretch it.` : `With no hold-up the last ~${fmt(cut.lostS, 0)} s of log is lost on every switch-off. A 2,200 µF capacitor behind a diode on the 12 V feed is enough to close the file.`],
      ['warn', 'Teensy 4.1 pins are 3.3 V and not 5 V tolerant: use 3.3 V modules or level shifters, and never feed a 5 V signal into a pin.'],
      ['info', 'The program lives in the Teensy\'s flash, so a power cut can\'t stop it booting; only the log file on the SD card is at risk.']
    ].map(([l, t]) => `<li class="${l}">${t}</li>`).join('');
    el.cfg.textContent = [
      '// Libraries: FlexCAN_T4, SdFat (SDIO), an FT81x/BT81x EVE library, TinyGPSPlus or SparkFun u-blox, RadioLib',
      'FlexCAN_T4<CAN1, RX_SIZE_256, TX_SIZE_16> can1;   // pins 22/23',
      'can1.begin(); can1.setBaudRate(1000000); can1.enableFIFO(); can1.enableFIFOInterrupt();',
      'SdFs sd; sd.begin(SdioConfig(FIFO_SDIO));          // built-in slot',
      'logFile.preAllocate(256UL << 20);                  // 256 MB, so a cut never leaves a 0-byte file',
      `// sync the log every ${o.bufS} s; power-fail interrupt on pin 41 stops logging, syncs and closes`,
      'attachInterrupt(digitalPinToInterrupt(41), powerFail, FALLING);',
      ...(o.gps ? ['Serial2.begin(115200);                              // GPS, UBX at ' + o.gpsHz + ' Hz'] : []),
      'pinMode(2, INPUT_PULLUP);  // MODE' + (o.touchButtons ? '' : '\npinMode(3, INPUT_PULLUP);  // CLEAR\npinMode(4, INPUT_PULLUP);  // MENU'),
      '// watchdog: restart within 1 s if the firmware hangs'
    ].join('\n');
  }

  function draw(el, r, U) {
    if (r.boardKey === 'teensy41') return drawTeensy(el, r, U);
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
    const touch = !!o.touchButtons;          // resistive touch: MENU and CLEAR are on the screen, only MODE is wired
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
      r.sel.cut.osSafe
        ? ['good', `Power cut: ${o.rootRO ? 'the root file system is read-only (raspi-config → Overlay File System), so the Pi always boots' : 'the hold-up gives it time to shut down cleanly'}${r.sel.cut.clean ? '; the hold-up lets it close the log too.' : `; the last ~${fmt(r.sel.cut.lostS, 0)} s of log can still be lost. A supercap with a power-lost signal on GPIO26 lets it close the file.`}`]
        : ['crit', 'The master switch and kill relay cut the Pi\'s power with no warning, which can corrupt the SD card. Run the root file system read-only (raspi-config → Overlay File System), write logs to their own partition and flush every buffer. A small supercap UPS with a power-lost signal on GPIO26 gives it time to close the file.'],
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
      ...(o.touchButtons ? ['# MENU and CLEAR: on-screen buttons on the resistive touch screen'] : ['dtoverlay=gpio-key,gpio=6,active_low=1,gpio_pull=up,keycode=46,label="CLEAR"',
        'dtoverlay=gpio-key,gpio=13,active_low=1,gpio_pull=up,keycode=28,label="MENU"']));
    if (pi5) cfg.push('# only if the screen is powered from the Pi\'s USB', '# usb_max_current_enable=1');
    if (!dsi) cfg.push('# if the 5 in screen shows the wrong size, add to cmdline.txt: video=HDMI-A-1:800x480@60D');
    cfg.push('', '# bring the bus up at boot (systemd-networkd or /etc/network/interfaces):', '# ip link set can0 up type can bitrate 1000000');
    el.cfg.textContent = cfg.join('\n');
  }
  window.BRPiWiring = { draw };
})();
