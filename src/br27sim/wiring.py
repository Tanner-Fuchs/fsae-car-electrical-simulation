"""BR27 powertrain wiring: EMU Black pinout (from the label on Tanner's unit,
2026-10-30) with the proposed BR27 use of each pin, the harness schematic and
fuel system drawings (SVG), and the from-to wire list.

The page, `br27sim export-wiring` (SVG, xlsx, PDF) and the tests all read this
one file, so they always agree. Update STATUS as parts get selected.
"""
import re

from ._js import js_str

# [pin, EMU function, BR27 use, wire, group]. Black = 39-pin, Grey = 24-pin.
# group: sensor | wbo | out-inj | out-ign | out-aux | power | gnd | ref | sgnd | can | spare
BLACK = [
  [1, 'Ignition coil #5', '', '', 'spare'],
  [2, 'EGT in #1', 'Optional: EGT, exhaust collector', '22 AWG K-type ext.', 'spare'],
  [3, 'Knock sensor in #1', 'Knock sensor, TBD (optional, see calibration form)', '22 AWG shielded', 'sensor'],
  [4, 'Analog in #2', 'Fuel pressure sensor, TBD (0.5–4.5 V)', '22 AWG', 'sensor'],
  [5, 'CLT in', 'Coolant temp sensor (stock ECT)', '22 AWG', 'sensor'],
  [6, 'WBO Vs', 'LSU 4.9 wideband, Vs (pin 6)', '22 AWG', 'wbo'],
  [7, 'Camsync in #2', '', '', 'spare'],
  [8, 'Primary trigger', 'Crank VR sensor + (12 even teeth)', '22 AWG shielded twisted pair', 'sensor'],
  [9, 'Flex fuel in', '', '', 'spare'],
  [10, 'Switch #1 in', 'Neutral switch (to ground)', '22 AWG', 'sensor'],
  [11, 'RS232 TXD', '', '', 'spare'],
  [12, 'CAN H', 'CAN H, stub to the CAN junction in the electrical box (EMU 120 Ω OFF)', '22 AWG twisted pair', 'can'],
  [13, 'Battery +12V', 'ECU feed, F1 5 A, after PMS and ahead of kill relay', '18 AWG', 'power'],
  [14, 'Ignition coil #4', 'Coil, cylinder 4 (this one is on the black connector)', '20 AWG', 'out-ign'],
  [15, 'EGT in #2', '', '', 'spare'],
  [16, 'Knock sensor in #2', '', '', 'spare'],
  [17, 'Analog in #3', 'Oil temp sensor, TBD (optional)', '22 AWG', 'sensor'],
  [18, 'TPS in', 'Throttle position sensor (stock, confirm)', '22 AWG', 'sensor'],
  [19, 'WBO Ip', 'LSU 4.9 wideband, Ip (pin 1)', '22 AWG', 'wbo'],
  [20, 'VSS in', 'Spare (wheel speeds come over CAN)', '', 'spare'],
  [21, 'Camsync in #1', 'Cam VR sensor + (cut to one sync tooth)', '22 AWG shielded twisted pair', 'sensor'],
  [22, 'WBO Rcal', 'LSU 4.9 wideband, Rcal / trim (pin 5)', '22 AWG', 'wbo'],
  [23, 'Switch #2 in', 'Spare (launch or pit limiter button)', '', 'spare'],
  [24, 'RS232 RXD', '', '', 'spare'],
  [25, 'CAN L', 'CAN L, stub to the CAN junction in the electrical box', '22 AWG twisted pair', 'can'],
  [26, '+5V supply', '+5 V ref: TPS', '22 AWG', 'ref'],
  [27, 'Power ground', 'Power ground, engine block star point', '16 AWG', 'gnd'],
  [28, 'ECU ground', 'ECU ground, engine block star point', '18 AWG', 'gnd'],
  [29, 'Sensor ground', 'Sensor ground: crank and cam VR (−), shields', '22 AWG', 'sgnd'],
  [30, 'Analog in #4', 'Spare (gear position if fitted)', '', 'spare'],
  [31, 'Analog in #1', 'Oil pressure sensor, TBD (0.5–4.5 V)', '22 AWG', 'sensor'],
  [32, 'IAT in', 'Intake air temp sensor, TBD (plenum)', '22 AWG', 'sensor'],
  [33, 'WBO VGND', 'LSU 4.9 wideband, virtual ground (pin 2)', '22 AWG', 'wbo'],
  [34, '+5V supply', '+5 V ref: oil and fuel pressure, fuel level pull-up', '22 AWG', 'ref'],
  [35, 'Analog in #5', 'Fuel level sender, float, TBD (240–33 Ω reed type, 470 Ω pull-up to +5 V)', '22 AWG', 'sensor'],
  [36, 'Switch #3 in', 'Spare', '', 'spare'],
  [37, 'Analog in #6', 'Spare', '', 'spare'],
  [38, 'Sensor ground', 'Sensor ground: TPS, CLT, IAT', '22 AWG', 'sgnd'],
  [39, 'Sensor ground', 'Sensor ground: pressure sensors, oil temp, fuel level', '22 AWG', 'sgnd']
]
GREY = [
  [1, 'Ignition coil #6', '', '', 'spare'],
  [2, 'H-Bridge #1 winding A', 'Not used (cable throttle, no ETC)', '', 'spare'],
  [3, 'H-Bridge #2 winding A', 'Not used', '', 'spare'],
  [4, 'AUX 6', 'Spare', '', 'spare'],
  [5, 'AUX 3', 'Fan relay coil (low side); relay and fan TBD', '20 AWG', 'out-aux'],
  [6, 'Injector #4', 'Injector, cylinder 4', '20 AWG', 'out-inj'],
  [7, 'Injector #1', 'Injector, cylinder 1', '20 AWG', 'out-inj'],
  [8, 'Ignition coil #1', 'Coil, cylinder 1', '20 AWG', 'out-ign'],
  [9, 'Ignition coil #3', 'Coil, cylinder 3', '20 AWG', 'out-ign'],
  [10, 'H-Bridge #1 winding B', 'Not used', '', 'spare'],
  [11, 'H-Bridge #2 winding B', 'Not used', '', 'spare'],
  [12, 'AUX 5', 'Spare', '', 'spare'],
  [13, 'AUX 2 / Injector #8', 'Fuel pump relay coil (low side); relay and pump TBD', '20 AWG', 'out-aux'],
  [14, 'Injector #5', 'Not used (secondary injectors dropped)', '', 'spare'],
  [15, 'Injector #2', 'Injector, cylinder 2', '20 AWG', 'out-inj'],
  [16, 'Ignition coil #2', 'Coil, cylinder 2', '20 AWG', 'out-ign'],
  [17, 'Power ground', 'Power ground, engine block star point', '16 AWG', 'gnd'],
  [18, 'Ignition +12V', 'Ignition sense, F1 5 A (same feed as B13)', '20 AWG', 'power'],
  [19, 'WBO heater', 'LSU 4.9 heater − (pin 3); heater + from kill bus', '18 AWG', 'wbo'],
  [20, 'AUX 4 / Tacho', 'Spare (dash gets rpm over CAN)', '', 'spare'],
  [21, 'AUX 1 / Injector #7', 'Spare', '', 'spare'],
  [22, 'Injector #6', 'Not used', '', 'spare'],
  [23, 'Injector #3', 'Injector, cylinder 3', '20 AWG', 'out-inj'],
  [24, 'Power ground', 'Power ground, engine block star point', '16 AWG', 'gnd']
]
# Fuses and relays in the under-seat fuse/relay box. Sizes are proposals.
FUSES = [
  ['F1', '5 A', 'EMU Black (B13, G18)'],
  ['F2', '20 A', 'Kill relay contacts → injectors, coils, wideband heater, and the pump via F3 (~8 A + pump; recheck when the pump is chosen)'],
  ['F3', '10 A', 'Fuel pump (through pump relay, fed from kill bus)'],
  ['F4', '15 A', 'Radiator fan (through fan relay)'],
  ['F5', '5 A', 'Dash MCU and corner nodes']
]

# ---------------------------------------------------------------- schematic
# Signal rows on the EMU block, top to bottom. Each row: [connector, pin, label, device id].
ROWS = [
  ['B', 8, 'Primary trigger', 'crank'], ['B', 21, 'Camsync #1', 'cam'],
  ['B', 18, 'TPS in', 'tps'], ['B', 5, 'CLT in', 'clt'], ['B', 32, 'IAT in', 'iat'],
  ['B', 31, 'Analog #1', 'oilp'], ['B', 4, 'Analog #2', 'fuelp'], ['B', 35, 'Analog #5', 'fuellvl'], ['B', 17, 'Analog #3', 'oilt'],
  ['B', 3, 'Knock #1', 'knock'], ['B', 10, 'Switch #1', 'neutral'],
  ['B', 6, 'WBO Vs', 'wbo'], ['B', 19, 'WBO Ip', 'wbo'], ['B', 22, 'WBO Rcal', 'wbo'], ['B', 33, 'WBO VGND', 'wbo'], ['G', 19, 'WBO heater', 'wbo'],
  ['G', 7, 'Injector #1', 'inj1'], ['G', 15, 'Injector #2', 'inj2'], ['G', 23, 'Injector #3', 'inj3'], ['G', 6, 'Injector #4', 'inj4'],
  ['G', 8, 'Ign coil #1', 'ign1'], ['G', 16, 'Ign coil #2', 'ign2'], ['G', 9, 'Ign coil #3', 'ign3'], ['B', 14, 'Ign coil #4', 'ign4'],
  ['G', 13, 'AUX 2', 'pumprly'], ['G', 5, 'AUX 3', 'fanrly']
]
DEVICES = {
  'crank': ['Crank VR sensor', 'stock, 12 teeth, shielded pair', 'sensor'],
  'cam': ['Cam VR sensor', 'stock, 1 sync tooth, shielded', 'sensor'],
  'tps': ['TPS', 'stock throttle body (confirm)', 'sensor'],
  'clt': ['Coolant temp', 'stock ECT', 'sensor'],
  'iat': ['Intake air temp sensor', 'TBD, plenum', 'sensor'],
  'oilp': ['Oil pressure sensor', 'TBD, 0.5–4.5 V type', 'sensor'],
  'fuelp': ['Fuel pressure sensor', 'TBD, 0.5–4.5 V type', 'sensor'],
  'fuellvl': ['Fuel level sender (tank)', 'TBD float, 240–33 Ω, R1 470 Ω', 'sensor'],
  'oilt': ['Oil temp sensor', 'TBD, optional', 'sensor'],
  'knock': ['Knock sensor', 'TBD, optional', 'sensor'],
  'neutral': ['Neutral switch', 'gearbox', 'sensor'],
  'wbo': ['Wideband O2 sensor', 'TBD, LSU 4.9 type', 'wbo'],
  'inj1': ['Injector 1', 'stock primary, 12 Ω', 'inj'], 'inj2': ['Injector 2', 'stock primary, 12 Ω', 'inj'],
  'inj3': ['Injector 3', 'stock primary, 12 Ω', 'inj'], 'inj4': ['Injector 4', 'stock primary, 12 Ω', 'inj'],
  'ign1': ['Coil 1', 'stock stick coil', 'ign'], 'ign2': ['Coil 2', 'stock stick coil', 'ign'],
  'ign3': ['Coil 3', 'stock stick coil', 'ign'], 'ign4': ['Coil 4', 'stock stick coil', 'ign'],
  'pumprly': ['Fuel pump relay', 'TBD, contacts → pump (TBD), F3', 'aux'],
  'fanrly': ['Fan relay', 'TBD, contacts → fan (TBD), F4', 'aux']
}
# Selection status, 2026-10-30. S = selected, K = stock CBR600RR part (assumed kept),
# T = to be selected. Update as Tanner confirms parts.
STATUS_LABEL = { 'S': 'Selected', 'K': 'Stock CBR600RR (assumed)', 'T': 'To be selected' }
STATUS = {
  'EMU-B': 'S', 'EMU-G': 'S', 'BAT': 'S',
  'CKP': 'K', 'CMP': 'K', 'ECT': 'K', 'INJ1': 'K', 'INJ2': 'K', 'INJ3': 'K', 'INJ4': 'K', 'IGN1': 'K', 'IGN2': 'K', 'IGN3': 'K', 'IGN4': 'K', 'NEUT': 'K', 'TPS': 'K',
  'IAT': 'T', 'OILP': 'T', 'FUELP': 'T', 'FLVL': 'T', 'OILT': 'T', 'KNK': 'T', 'LSU': 'T', 'PUMP': 'T', 'FAN': 'T',
  'FB': 'T', 'K1': 'T', 'K2': 'T', 'K3': 'T', 'GR1': 'T', 'GR2': 'T', 'BRK': 'T', 'PMS': 'T', 'REG': 'T',
  'S1': '', 'S2': '', 'S3': '', 'GS': '', 'CAN': '', 'R1': ''
}
DEV_REF = { 'crank': 'CKP', 'cam': 'CMP', 'tps': 'TPS', 'clt': 'ECT', 'iat': 'IAT', 'oilp': 'OILP', 'fuelp': 'FUELP', 'fuellvl': 'FLVL', 'oilt': 'OILT', 'knock': 'KNK', 'neutral': 'NEUT', 'wbo': 'LSU',
  'inj1': 'INJ1', 'inj2': 'INJ2', 'inj3': 'INJ3', 'inj4': 'INJ4', 'ign1': 'IGN1', 'ign2': 'IGN2', 'ign3': 'IGN3', 'ign4': 'IGN4', 'pumprly': 'K2', 'fanrly': 'K3' }

# devices that take +5 V ref, sensor ground, or switched +12 V from the kill bus
NEEDS_5V = ['tps', 'oilp', 'fuelp', 'fuellvl']
NEEDS_SG = ['crank', 'cam', 'tps', 'clt', 'iat', 'oilp', 'fuelp', 'fuellvl', 'oilt']
NEEDS_KILL = ['wbo', 'inj1', 'inj2', 'inj3', 'inj4', 'ign1', 'ign2', 'ign3', 'ign4', 'pumprly']

STYLE = """<style>
      .br-wiring{--k:var(--ink,#12161d);--k2:var(--ink-2,#4a515c);--k3:var(--ink-3,#7a818c);--pn:var(--panel,#fff);--ru:var(--rule,#d9dce1);
        --pw:var(--crit,#d03b3b);--kl:var(--s2,#eb6834);--sg:var(--s3,#1baf7a);--rf:var(--s4,#eda100);--cn:var(--s1,#2a78d6);--wb:var(--s7,#6250d6);--gd:var(--ink-2,#4a515c)}
      .br-wiring text{fill:var(--k);font-size:13px}
      .br-wiring .s{fill:var(--k2);font-size:11px}
      .br-wiring .h{font-size:15px;font-weight:600}
      .br-wiring .z{fill:var(--k3);font-size:12px;letter-spacing:.08em;font-weight:600}
      .br-wiring .m{font-family:IBM Plex Mono,Menlo,monospace;font-size:12px}
      .br-wiring .box{fill:var(--pn);stroke:var(--k);stroke-width:1.4}
      .br-wiring .zone{fill:none;stroke:var(--ru);stroke-width:1}
      .br-wiring .w{fill:none;stroke-width:2}
      .br-wiring .sig{stroke:var(--k2)} .br-wiring .pw{stroke:var(--pw)} .br-wiring .kl{stroke:var(--kl)}
      .br-wiring .sgw{stroke:var(--sg)} .br-wiring .rfw{stroke:var(--rf)} .br-wiring .cnw{stroke:var(--cn)} .br-wiring .wbw{stroke:var(--wb)} .br-wiring .gdw{stroke:var(--gd)}
      .br-wiring .dash{stroke-dasharray:6 5}
      .br-wiring .dot{stroke:none}
      .br-wiring .tbd{stroke-dasharray:5 4}
    </style>"""


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;")


def is_tbd(ref):
    return STATUS.get(ref) == "T"


n = js_str  # numbers print as JavaScript prints them (75, not 75.0)


def schematic_svg():
    """Powertrain harness schematic (SVG), EMU Black in the middle, engine bay on the right."""
    W, top, rowH = 1600, 170, 26
    # EMU block rows: 2 rail rows, the signal rows, then 3 power/ground/CAN rows
    nRows = 2 + len(ROWS) + 3
    H = top + nRows * rowH + 150
    emuX, emuW, fwX, rail5, railSG, devX, devW, killX = 470, 250, 860, 905, 930, 1000, 330, 1395

    def y(i):
        return top + 20 + i * rowH

    def ySig(i):
        return y(i + 2)

    o = []
    o.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n(W)} {n(H)}" class="br-wiring" role="img" aria-label="BR27 powertrain harness schematic" font-family="IBM Plex Sans, Helvetica, Arial, sans-serif">')
    o.append(STYLE)
    # zones and title
    o.append(f'<rect class="zone" x="4" y="64" width="{n(fwX - 12)}" height="{n(H - 72)}" rx="8"/>')
    o.append(f'<rect class="zone" x="{n(fwX + 8)}" y="64" width="{n(W - fwX - 12)}" height="{n(H - 72)}" rx="8"/>')
    o.append('<text class="z" x="24" y="88">COCKPIT SIDE: UNDER THE SEAT, MAIN HOOP, DASH</text>')
    o.append(f'<text class="z" x="{n(fwX + 24)}" y="88">ENGINE BAY: BEHIND THE FIREWALL</text>')
    o.append('<text class="h" x="6" y="28">BR27 powertrain harness, EMU Black on 2012 CBR600RR</text>')
    o.append('<text class="s" x="6" y="48">Proposal, rev E, 2026-10-31 (firewall grommets instead of a bulkhead connector; rev D team wire colors; rev C fuel level sender). Dashed boxes are parts still to be selected. Pins from the EMU Black label (B = black 39-pin, G = grey 24-pin). Fuse sizes and gauges are proposals; check against the EMU Black manual before building.</text>')

    # firewall + grommet pass-through (rev E: grommets, no bulkhead connector)
    bhTop, bhBot = y(0) - 12, ySig(len(ROWS) - 1) + 12
    o.append(f'<line x1="{n(fwX)}" y1="64" x2="{n(fwX)}" y2="{n(H - 8)}" stroke="var(--k3)" stroke-width="3" class="dash"/>')
    o.append(f'<rect class="box tbd" x="{n(fwX - 14)}" y="{n(bhTop)}" width="28" height="{n(bhBot - bhTop)}" rx="4"/>')
    o.append(f'<rect x="{n(fwX - 62)}" y="{n(bhTop - 36)}" width="124" height="32" fill="var(--pn)"/>')
    o.append(f'<text class="s" x="{n(fwX)}" y="{n(bhTop - 22)}" text-anchor="middle">Firewall</text>')
    o.append(f'<text class="s" x="{n(fwX)}" y="{n(bhTop - 8)}" text-anchor="middle">grommet GR1 (TBD)</text>')

    # EMU block
    emuTop, emuBot = y(0) - 16, y(nRows - 1) + 16
    o.append(f'<rect class="box" x="{n(emuX)}" y="{n(emuTop)}" width="{n(emuW)}" height="{n(emuBot - emuTop)}" rx="6"/>')
    o.append(f'<text class="h" x="{n(emuX + 12)}" y="{n(emuTop - 10)}">EMU Black (under seat)</text>')

    def pin_row(yy, pins, lab):
        o.append(f'<text class="m" x="{n(emuX + 12)}" y="{n(yy + 4)}">{pins}</text><text x="{n(emuX + 128)}" y="{n(yy + 4)}">{esc(lab)}</text>')

    # rail rows (top of EMU) feed the +5 V and sensor ground rails in the engine bay
    pin_row(y(0), "B26 B34", "+5 V ref")
    pin_row(y(1), "B29 B38 B39", "Sensor ground")
    o.append(f'<line class="w rfw" x1="{n(emuX + emuW)}" y1="{n(y(0))}" x2="{n(rail5)}" y2="{n(y(0))}"/>')
    o.append(f'<line class="w sgw" x1="{n(emuX + emuW)}" y1="{n(y(1))}" x2="{n(railSG)}" y2="{n(y(1))}"/>')

    kill_taps, sg_taps, ref_taps = [], [], []
    seen = set()
    for i, (c, pin, lab, dev) in enumerate(ROWS):
        yy = ySig(i)
        cls = "wbw" if DEVICES[dev][2] == "wbo" else "sig"
        pin_row(yy, c + str(pin), lab)
        o.append(f'<line class="w {cls}" x1="{n(emuX + emuW)}" y1="{n(yy)}" x2="{n(devX)}" y2="{n(yy)}"/>')
        if dev not in seen:
            rows = [j for j, r in enumerate(ROWS) if r[3] == dev]
            y0, y1 = ySig(rows[0]) - 11, ySig(rows[-1]) + 11
            seen.add(dev)
            name, sub = DEVICES[dev][0], DEVICES[dev][1]
            tbd = " tbd" if is_tbd(DEV_REF.get(dev)) else ""
            o.append(f'<rect class="box{tbd}" x="{n(devX)}" y="{n(y0)}" width="{n(devW)}" height="{n(y1 - y0)}" rx="4"/>')
            o.append(f'<text x="{n(devX + 10)}" y="{n(y0 + 16)}">{esc(name)}</text><text class="s" x="{n(devX + devW - 10)}" y="{n(y0 + 16)}" text-anchor="end">{esc(sub)}</text>')
            if dev == "wbo":
                for k, t in enumerate(["Exhaust, ≥ 1 m from the head.", "LSU 4.9 pins: Vs 6, Ip 1, Rcal 5, VGND 2,",
                                       "heater − 3 (to G19), heater + 4 (kill bus).", "Twist Vs/Ip/Rcal/VGND; keep away from coils."]):
                    o.append(f'<text class="s" x="{n(devX + 10)}" y="{n(y0 + 36 + k * 15)}">{t}</text>')
            mid = (y0 + y1) / 2
            if dev in NEEDS_KILL:
                kill_taps.append(y1 - 8 if len(rows) > 1 else mid)
            if dev in NEEDS_SG:
                sg_taps.append(y1 - 4)
            if dev in NEEDS_5V:
                ref_taps.append(y0 + 4)

    # rails
    def rail(x, y0, taps, cls, col, label):
        o.append(f'<line class="w {cls}" x1="{n(x)}" y1="{n(y0)}" x2="{n(x)}" y2="{n(max(taps))}"/>')
        o.append(f'<circle class="dot" cx="{n(x)}" cy="{n(y0)}" r="3" fill="var({col})"/>')
        for t in taps:
            o.append(f'<line class="w {cls}" x1="{n(x)}" y1="{n(t)}" x2="{n(devX)}" y2="{n(t)}"/><circle class="dot" cx="{n(x)}" cy="{n(t)}" r="3" fill="var({col})"/>')
        o.append(f'<text class="s" x="{n(devX + 10)}" y="{n(y0 + 4)}">{label}</text>')

    rail(rail5, y(0), ref_taps, "rfw", "--rf", "+5 V ref rail → TPS, oil and fuel pressure, fuel level (via R1 470 Ω)")
    rail(railSG, y(1), sg_taps, "sgw", "--sg", "Sensor ground rail → sensors (VR shields at ECU end only)")

    # kill bus
    kTop, kBot = y(0), max(kill_taps)
    o.append(f'<line class="w kl" x1="{n(killX)}" y1="{n(kTop)}" x2="{n(killX)}" y2="{n(kBot)}" stroke-width="3"/>')
    for t in kill_taps:
        o.append(f'<line class="w kl" x1="{n(devX + devW)}" y1="{n(t)}" x2="{n(killX)}" y2="{n(t)}"/><circle class="dot" cx="{n(killX)}" cy="{n(t)}" r="3.5" fill="var(--kl)"/>')
    for i, t in enumerate(["KILL BUS +12 V", "kill relay via F2 20 A", "feeds injectors, coils,", "WBO heater, pump relay.", "EMU switches low side."]):
        o.append(f'<text class="s" x="{n(killX + 44)}" y="{n(kTop + 4 + i * 15)}">{t}</text>')

    # ---- power distribution, left column
    px, bw = 30, 150

    def blk(x, yy, w, h, t, s2, tbd=False):
        o.append(f'<rect class="box{" tbd" if tbd else ""}" x="{n(x)}" y="{n(yy)}" width="{n(w)}" height="{n(h)}" rx="4"/><text x="{n(x + 10)}" y="{n(yy + 18)}">{esc(t)}</text>')
        if s2:
            o.append(f'<text class="s" x="{n(x + 10)}" y="{n(yy + 34)}">{esc(s2)}</text>')

    by = top - 30
    blk(px, by, bw, 44, "Battery", "NOCO NLP14, 12.8 V")
    blk(px, by + 70, bw, 44, "Main breaker 100 A", "TBD, manual reset (T.9.2.2)", True)
    blk(px, by + 140, bw, 44, "PMS, 2-pole", "TBD, main hoop, right side", True)
    o.append(f'<line class="w pw" x1="{n(px + bw / 2)}" y1="{n(by + 44)}" x2="{n(px + bw / 2)}" y2="{n(by + 70)}" stroke-width="3"/>')
    o.append(f'<line class="w pw" x1="{n(px + bw / 2)}" y1="{n(by + 114)}" x2="{n(px + bw / 2)}" y2="{n(by + 140)}" stroke-width="3"/>')
    blk(px + 210, by, 200, 44, "Starter relay → starter", "heavy cable, own route")
    o.append(f'<line class="w pw" x1="{n(px + bw)}" y1="{n(by + 160)}" x2="{n(px + 310)}" y2="{n(by + 160)}"/><line class="w pw" x1="{n(px + 310)}" y1="{n(by + 160)}" x2="{n(px + 310)}" y2="{n(by + 44)}"/>')
    blk(px + 210, by + 70, 200, 44, "Regulator (sidepod)", "TBD, output via PMS pole 2", True)
    o.append(f'<line class="w pw dash" x1="{n(px + 230)}" y1="{n(by + 114)}" x2="{n(px + 230)}" y2="{n(by + 150)}"/><line class="w pw dash" x1="{n(px + 230)}" y1="{n(by + 150)}" x2="{n(px + bw)}" y2="{n(by + 150)}"/>')
    fbY, fbH = by + 215, 30 + len(FUSES) * 22
    blk(px, fbY, 410, fbH, "Fuse and relay box (under seat), TBD", "", True)
    for i, (f, a, what) in enumerate(FUSES):
        o.append(f'<text class="m" x="{n(px + 12)}" y="{n(fbY + 42 + i * 22)}">{f} {a}</text><text class="s" x="{n(px + 92)}" y="{n(fbY + 42 + i * 22)}">{esc(what)}</text>')
    o.append(f'<line class="w pw" x1="{n(px + bw / 2)}" y1="{n(by + 184)}" x2="{n(px + bw / 2)}" y2="{n(fbY)}" stroke-width="3"/>')
    o.append(f'<text class="s" x="{n(px + bw / 2 + 8)}" y="{n(by + 204)}">switched bus</text>')
    krY = fbY + fbH + 30
    blk(px, krY, 410, 64, "Kill relay (fuse box), TBD", "coil loop: CMS (dash) → BOTS (pedal box) → inertia switch", True)
    o.append(f'<text class="s" x="{n(px + 10)}" y="{n(krY + 52)}">Contacts F2 → kill bus. Any switch opens it: injectors, coils, pump lose +12 V.</text>')
    # kill bus run: out of the relay's left side, down, along the bottom, up to the engine bay rail
    kRunY = H - 26
    o.append(f'<polyline class="w kl" stroke-width="3" points="{n(px)},{n(krY + 32)} {n(px - 14)},{n(krY + 32)} {n(px - 14)},{n(kRunY)} {n(killX + 30)},{n(kRunY)} {n(killX + 30)},{n(kTop - 14)} {n(killX)},{n(kTop - 14)} {n(killX)},{n(kTop)}"/>')

    # bottom EMU rows: +12 V feed, grounds, CAN
    yP, yG, yC = y(nRows - 3), y(nRows - 2), y(nRows - 1)
    pin_row(yP, "B13 G18", "Battery / ign +12 V")
    pin_row(yG, "B27 B28 G17 G24", "Grounds")
    pin_row(yC, "B12 B25", "CAN H / CAN L")
    o.append(f'<polyline class="w pw" points="{n(px + 410)},{n(fbY + 38)} {n(px + 438)},{n(fbY + 38)} {n(px + 438)},{n(yP)} {n(emuX)},{n(yP)}"/>')
    o.append(f'<text class="s" x="{n(px + 416)}" y="{n(fbY + 32)}">F1</text>')
    o.append(f'<line class="w gdw" x1="{n(px)}" y1="{n(yG)}" x2="{n(emuX)}" y2="{n(yG)}"/>')
    o.append(f'<text class="s" x="{n(px)}" y="{n(yG - 6)}">Grounds → engine block star point, 16 AWG</text>')
    o.append(f'<line class="w cnw" x1="{n(px)}" y1="{n(yC)}" x2="{n(emuX)}" y2="{n(yC)}" stroke-width="2.5"/>')
    o.append(f'<text class="s" x="{n(px)}" y="{n(yC - 6)}">CAN stub → junction: front FL → FR → dash, rear RR → RL. 120 Ω at dash and RL.</text>')

    # legend
    lg = [["tbdbox", "Dashed box: part to be selected"], ["pw", "Battery / switched +12 V"], ["kl", "Kill bus +12 V"],
          ["sig", "EMU signal or low-side output"], ["wbw", "Wideband"], ["rfw", "+5 V ref"], ["sgw", "Sensor ground"],
          ["cnw", "CAN"], ["gdw", "Power ground"]]
    for i, (c, t) in enumerate(lg):
        lx, ly = devX + (i % 2) * 230, emuBot + 22 + (i // 2) * 18
        if c == "tbdbox":
            o.append(f'<rect class="box tbd" x="{n(lx)}" y="{n(ly - 11)}" width="26" height="13" rx="2"/><text class="s" x="{n(lx + 34)}" y="{n(ly)}">{t}</text>')
        else:
            o.append(f'<line class="w {c}" x1="{n(lx)}" y1="{n(ly - 4)}" x2="{n(lx + 26)}" y2="{n(ly - 4)}" stroke-width="3"/><text class="s" x="{n(lx + 34)}" y="{n(ly)}">{t}</text>')
    o.append("</svg>")
    return "".join(o)


def fuel_system_svg():
    """One-page view of how the fuel system connects: power and shutdown path to the
    pump, EMU outputs and sensors, the float level sender, CAN to the dash, and the
    fuel plumbing for context. Same pins and refs as the harness schematic."""
    W, H, fwX = 1600, 1010, 760
    o = []
    o.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n(W)} {n(H)}" class="br-wiring" role="img" aria-label="BR27 fuel system wiring" font-family="IBM Plex Sans, Helvetica, Arial, sans-serif">')
    o.append(STYLE)
    o.append("<style>.br-wiring .fl{stroke:var(--s5,#e87ba4);stroke-width:6;stroke-opacity:.55;fill:none;stroke-linecap:round}</style>")
    o.append(f'<rect class="zone" x="4" y="64" width="{n(fwX - 12)}" height="{n(H - 72)}" rx="8"/>')
    o.append(f'<rect class="zone" x="{n(fwX + 8)}" y="64" width="{n(W - fwX - 12)}" height="{n(H - 72)}" rx="8"/>')
    o.append('<text class="z" x="24" y="88">COCKPIT SIDE: UNDER THE SEAT, MAIN HOOP, DASH</text>')
    o.append(f'<text class="z" x="{n(fwX + 24)}" y="88">ENGINE BAY: BEHIND THE FIREWALL (TANK, PUMP, RAIL)</text>')
    o.append('<text class="h" x="6" y="28">BR27 fuel system: how it connects (EMU Black, 2012 CBR600RR)</text>')
    o.append('<text class="s" x="6" y="48">Proposal, rev E, 2026-10-31. Same pins and refs as the harness schematic and wire list. Dashed boxes are parts still to be selected. Pink band = fuel line (plumbing, for context).</text>')
    o.append(f'<line x1="{n(fwX)}" y1="64" x2="{n(fwX)}" y2="{n(H - 8)}" stroke="var(--k3)" stroke-width="3" class="dash"/>')
    o.append(f'<text class="s" x="{n(fwX + 6)}" y="112">Firewall: all wires through</text><text class="s" x="{n(fwX + 6)}" y="126">sealed grommet GR1 (T.1.8.6)</text>')

    def blk(x, yy, w, h, t, lines=None, tbd=False):
        o.append(f'<rect class="box{" tbd" if tbd else ""}" x="{n(x)}" y="{n(yy)}" width="{n(w)}" height="{n(h)}" rx="4"/><text x="{n(x + 10)}" y="{n(yy + 18)}">{esc(t)}</text>')
        for i, s in enumerate(lines or []):
            o.append(f'<text class="s" x="{n(x + 10)}" y="{n(yy + 34 + i * 15)}">{esc(s)}</text>')

    def ln(cls, pts, extra=None):
        o.append(f'<polyline class="w {cls}" points="{" ".join(",".join(n(v) for v in pt) for pt in pts)}" {extra or ""}/>')

    def dot(x, yy, col):
        o.append(f'<circle class="dot" cx="{n(x)}" cy="{n(yy)}" r="3.5" fill="var({col})"/>')

    def lab(x, yy, t, anchor=None):
        a = f' text-anchor="{anchor}"' if anchor else ""
        o.append(f'<text class="s" x="{n(x)}" y="{n(yy)}"{a}>{esc(t)}</text>')

    # power chain and shutdown
    blk(30, 110, 200, 44, "Battery", ["NOCO NLP14, 12.8 V"])
    blk(30, 180, 200, 44, "Main breaker 100 A", ["TBD, manual reset"], True)
    blk(30, 250, 200, 44, "PMS, 2-pole", ["TBD, main hoop (IC.9.3)"], True)
    ln("pw", [[130, 154], [130, 180]], 'stroke-width="3"'); ln("pw", [[130, 224], [130, 250]], 'stroke-width="3"')
    ln("pw", [[130, 294], [130, 330]], 'stroke-width="3"'); lab(138, 316, "switched bus")
    blk(30, 330, 200, 104, "Fuse/relay box FB, TBD", ["F1 5 A → EMU Black", "F2 20 A → kill relay contacts", "F3 10 A → pump relay (kill bus)", "K1, K2 live in this box"], True)
    blk(270, 330, 200, 104, "Kill relay K1", ["coil loop: CMS (dash) →", "BOTS (pedal box) → inertia sw.", "contacts: F2 → KILL BUS", "any switch open = no fuel, no spark"], True)
    ln("pw", [[230, 360], [270, 360]]); lab(238, 354, "F2")
    # kill bus
    kY = 742
    ln("kl", [[470, 420], [482, 420], [482, kY]], 'stroke-width="3"')
    ln("kl", [[290, kY], [1540, kY], [1540, 300]], 'stroke-width="3"'); dot(482, kY, "--kl")
    lab(560, kY - 8, "KILL BUS +12 V: dead when the PMS, CMS, BOTS or inertia switch opens (IC.9.2.2)")

    # pump relay K2
    blk(270, 560, 180, 92, "Pump relay K2", ["85 → EMU G13 (AUX 2, low side)", "86 ← kill bus", "30 ← F3 ← kill bus, 87 → pump"], True)
    ln("kl", [[300, 652], [300, kY]]); dot(300, kY, "--kl"); lab(304, 670, "86")
    ln("kl", [[350, 652], [350, kY]]); dot(350, kY, "--kl"); lab(354, 670, "30 via F3")
    ln("kl", [[420, 652], [420, 862], [820, 862]], 'stroke-width="3"'); lab(424, 670, "87")
    lab(560, 856, "PUMP_12V, 16 AWG")

    # dash MCU
    blk(30, 560, 210, 120, "Dash MCU (front)", ["fuel %, litres, laps left", "IMU slosh gate + fuel-used blend", "BR-W10 low fuel (< 1.0 L)", "BR-W11 sender open/short", "logs FUEL_LVL raw volts"], True)

    # EMU block
    ex, ew = 520, 200
    o.append(f'<rect class="box" x="{n(ex)}" y="130" width="{n(ew)}" height="580" rx="6"/>')
    o.append(f'<text class="h" x="{n(ex + 10)}" y="122">EMU Black (under seat)</text>')

    def pin(yy, p, t):
        o.append(f'<text class="m" x="{n(ex + 10)}" y="{n(yy + 4)}">{p}</text><text x="{n(ex + 76)}" y="{n(yy + 4)}">{esc(t)}</text>')

    pin(160, "B34", "+5 V ref"); pin(190, "B39", "Sensor ground"); pin(220, "B4", "Analog #2 fuel P")
    pin(250, "B35", "Analog #5 fuel lvl")
    pin(300, "G7", "Injector #1"); pin(325, "G15", "Injector #2"); pin(350, "G23", "Injector #3"); pin(375, "G6", "Injector #4")
    pin(430, "G13", "AUX 2 pump relay")
    o.append(f'<text class="s" x="{n(ex + 10)}" y="470">Pump: prime 2-3 s at key-on, then</text><text class="s" x="{n(ex + 10)}" y="485">on only while rpm &gt; 0 (EMU client).</text>')
    o.append(f'<text class="s" x="{n(ex + 10)}" y="515">Fuel level: B35 volts → % table,</text><text class="s" x="{n(ex + 10)}" y="530">sent to the dash in a CAN frame.</text>')
    pin(615, "B13 G18", "+12 V from F1")
    pin(645, "B27..G24", "Grounds → GS")
    pin(675, "B12 B25", "CAN H / L")
    # EMU left-side wires
    ln("sig", [[ex, 430], [494, 430], [494, 606], [450, 606]]); lab(456, 600, "G13")
    ln("pw", [[130, 434], [130, 470], [506, 470], [506, 615], [ex, 615]]); lab(138, 462, "F1 → B13, G18")
    ln("cnw", [[ex, 675], [460, 675], [460, 700], [240, 700], [240, 680]], 'stroke-width="2.5"')
    lab(30, 698, "CAN 2.0, 1 Mbps, via corner nodes")

    # engine bay: sensors and injectors
    dX, dW = 1180, 320
    rail5, railSG, sigX = 1050, 1080, 1020
    ln("rfw", [[ex + ew, 160], [rail5, 160], [rail5, 748]]); dot(rail5, 160, "--rf")
    ln("sgw", [[ex + ew, 190], [railSG, 190], [railSG, 830]]); dot(railSG, 190, "--sg")
    # fuel pressure sensor on the rail
    blk(dX, 196, dW, 48, "Fuel pressure sensor (on rail)", ["TBD, 0.5-4.5 V; +5 V, SGND, SIG"], True)
    ln("sig", [[ex + ew, 220], [dX, 220]])
    ln("rfw", [[rail5, 206], [dX, 206]]); dot(rail5, 206, "--rf")
    ln("sgw", [[railSG, 234], [dX, 234]]); dot(railSG, 234, "--sg")
    # injectors
    for i, yy in enumerate([300, 325, 350, 375]):
        o.append(f'<rect class="box" x="{n(dX)}" y="{n(yy - 11)}" width="{n(dW)}" height="22" rx="4"/><text x="{n(dX + 10)}" y="{n(yy + 4)}">Injector {i + 1}</text><text class="s" x="{n(dX + dW - 10)}" y="{n(yy + 4)}" text-anchor="end">stock primary, 12 Ω</text>')
        ln("sig", [[ex + ew, yy], [dX, yy]])
        ln("kl", [[dX + dW, yy], [1540, yy]]); dot(1540, yy, "--kl")
    lab(1548, 296, "+12 V")
    lab(1548, 311, "kill bus")
    # fuel rail (plumbing)
    o.append(f'<rect class="box" x="{n(dX)}" y="410" width="{n(dW)}" height="30" rx="4"/><text x="{n(dX + 10)}" y="430">Fuel rail (stock CBR600RR)</text>')
    for x in [1230, 1300, 1370, 1440]:
        ln("fl", [[x, 410], [x, 388]])

    # tank, pump, sender, plumbing
    o.append('<rect class="box" x="800" y="790" width="370" height="186" rx="10"/>')
    o.append('<text class="h" x="812" y="812">Fuel tank</text>')
    blk(820, 830, 150, 64, "Fuel pump", ["TBD: stock CBR module", "or external; F3 10 A"], True)
    blk(990, 830, 125, 64, "Level sender", ["float, reed tube", "240-33 Ω, FLVL"], True)
    # wire ends inside the tank outline (drawn after its white fill)
    ln("kl", [[795, 862], [820, 862]], 'stroke-width="3"'); ln("sig", [[sigX, 785], [sigX, 830]]); ln("sgw", [[railSG, 785], [railSG, 830]])
    ln("gdw", [[880, 894], [880, 936]]); lab(888, 932, "PUMP_GND → GS (16 AWG)")
    lab(812, 950, "Firewall to driver (IC.5.2.3). Filler neck, sight tube and")
    lab(812, 965, "fill line (IC.5.4), vent check valve (IC.5.6).")
    # sender wiring: signal from B35, R1 pull-up from +5 V, return to sensor ground
    ln("sig", [[ex + ew, 250], [sigX, 250], [sigX, 830]])
    o.append(f'<rect class="box" x="{n(rail5 - 8)}" y="748" width="16" height="28" rx="2"/>')
    lab(railSG + 10, 762, "R1 470 Ω, 0.25 W")
    lab(railSG + 10, 776, "pull-up in sender pigtail")
    ln("rfw", [[rail5, 776], [rail5, 782], [sigX, 782]]); dot(sigX, 782, "--k2")
    lab(sigX - 6, 560, "FUEL_LVL (B35)", "end")
    lab(sigX - 6, 574, "0.33 V full, 1.69 V empty", "end")
    # fuel line: pump → filter → rail
    ln("fl", [[1170, 862], [1260, 862]])
    blk(1260, 842, 120, 40, "Filter", [], True)
    ln("fl", [[1380, 862], [1430, 862], [1430, 440]])
    lab(1420, 600, "fuel feed: rated hose or", "end")
    lab(1420, 614, "braided line (IC.5.7, IC.6.1)", "end")

    # legend
    lg = [["pw", "Battery / switched +12 V"], ["kl", "Kill bus +12 V"], ["sig", "EMU signal / low-side output"], ["rfw", "+5 V ref"],
          ["sgw", "Sensor ground"], ["cnw", "CAN"], ["gdw", "Power ground"], ["fl", "Fuel line (plumbing)"]]
    for i, (c, t) in enumerate(lg):
        lx, ly = 30 + (i % 2) * 230, 790 + (i // 2) * 20
        o.append(f'<line class="w {c}" x1="{n(lx)}" y1="{n(ly - 4)}" x2="{n(lx + 26)}" y2="{n(ly - 4)}" stroke-width="3"/><text class="s" x="{n(lx + 34)}" y="{n(ly)}">{t}</text>')
    o.append(f'<rect class="box tbd" x="30" y="{n(790 + 4 * 20 - 11)}" width="26" height="13" rx="2"/><text class="s" x="64" y="{n(790 + 4 * 20)}">Dashed box: part to be selected</text>')
    o.append("</svg>")
    return "".join(o)


def bulkhead_count():
    # signal rows + 5V + SGND + kill bus feed
    return len(ROWS) + 2 + 1


# ---------------------------------------------------------------- wire list
# One row per wire, from-to, for harness tools (br27sim export-wiring).
# Connector refs: EMU-B / EMU-G = EMU Black black/grey, S1 +5 V splice, S2 sensor
# ground splice, S3 kill bus splice, FB fuse box, K1 kill relay, K2 pump relay,
# K3 fan relay, GS engine block ground star. Device pin names are functions until
# the mating connectors are chosen. Lengths are rough estimates (EMU under seat).
CONNECTORS = [
    ["EMU-B", "EMU Black 39-pin black connector", "Under seat", 39],
    ["EMU-G", "EMU Black 24-pin grey connector", "Under seat", 24],
    ["FB", "Fuse and relay box (F1-F5)", "Under seat", ""],
    ["K1", "Kill relay (30/85/86/87)", "Fuse box", 4],
    ["K2", "Fuel pump relay (30/85/86/87)", "Fuse box", 4],
    ["K3", "Fan relay (30/85/86/87)", "Fuse box", 4],
    ["GR1", "Firewall grommet(s), sealed (T.1.8.6.d): the whole powertrain harness passes through here (rev E, no bulkhead connector). Use split grommets or pin the connectors after passing the wires through", "Firewall", ""],
    ["GR2", "Grommets at every other panel pass-through: battery and charging cables, corner node and dash runs, sidepod (count set when routing is final)", "Various", ""],
    ["S1", "+5 V ref splice", "Engine bay", ""],
    ["S2", "Sensor ground splice", "Engine bay", ""],
    ["S3", "Kill bus +12 V splice", "Engine bay", ""],
    ["GS", "Ground star point (stud)", "Engine block", ""],
    ["CKP", "Crank VR sensor (stock)", "Engine", 2], ["CMP", "Cam VR sensor (stock)", "Engine head", 2],
    ["TPS", "Throttle position sensor", "Throttle body", 3], ["ECT", "Coolant temp sensor (stock)", "Engine", 2],
    ["IAT", "Intake air temp sensor", "Plenum", 2], ["OILP", "Oil pressure sensor 0.5-4.5 V", "Engine", 3],
    ["FUELP", "Fuel pressure sensor 0.5-4.5 V", "Fuel rail", 3], ["FLVL", "Fuel level sender, float type (proposed: reed-switch tube, 240-33 Ω, VDO 226-6xx class)", "Fuel tank, top flange", 2],
    ["R1", "Fuel level pull-up resistor, 470 Ω 0.25 W, in the sender pigtail", "Fuel tank", 2], ["OILT", "Oil temp sensor (optional)", "Engine", 2],
    ["KNK", "Knock sensor (optional)", "Block", 2], ["NEUT", "Neutral switch (stock)", "Gearbox", 1],
    ["LSU", "Wideband O2 sensor, LSU 4.9 type (EMU internal controller)", "Exhaust", 6],
    ["INJ1", "Injector cyl 1", "Throttle body", 2], ["INJ2", "Injector cyl 2", "Throttle body", 2],
    ["INJ3", "Injector cyl 3", "Throttle body", 2], ["INJ4", "Injector cyl 4", "Throttle body", 2],
    ["IGN1", "Coil cyl 1", "Head", 2], ["IGN2", "Coil cyl 2", "Head", 2], ["IGN3", "Coil cyl 3", "Head", 2], ["IGN4", "Coil cyl 4", "Head", 2],
    ["PUMP", "Fuel pump", "Tank", 2], ["FAN", "Radiator fan", "Sidepod", 2],
    ["CAN", "CAN junction in the electrical box: EMU stub (< 0.3 m) joins the front chain (FL, FR, dash) and rear chain (RR, RL)", "Electrical box", 2],
]


def components():
    """Every powertrain electrical part with its selection status (for the PDF and xlsx)."""
    extra = [["BAT", "Battery: NOCO NLP14 (4 Ah LiFePO4)", "Under seat", ""], ["BRK", "Main breaker, ~100 A manual reset (proposed)", "Next to PMS", ""],
             ["PMS", "Primary Master Switch, 2-pole (proposed)", "Main hoop, right side", ""], ["REG", "Regulator/rectifier, series MOSFET type (proposed)", "Sidepod", ""]]
    return [{"ref": ref, "desc": desc, "loc": loc, "pins": pins, "status": STATUS_LABEL.get(STATUS.get(ref)) or "Selected"}
            for ref, desc, loc, pins in extra + CONNECTORS if STATUS.get(ref) != ""]


def team_color(sig):
    """Team wire color code (BR27 Master Timeline, Wiring standards)."""
    if sig == "CAN_H":
        return "White"
    if sig == "CAN_L":
        return "Black"
    if sig == "+5V_REF":
        return "Blue"
    if re.search(r"GND|VR−", sig) and sig != "WBO_VGND":
        return "Black"
    if re.search(r"12V|KILL_IN|_FEED|IGN_SENSE", sig):
        return "Red"
    return "Yellow"


def wire_list():
    w = []
    # [from, fromPin, to, toPin, signal, awg, color, mm, group, through firewall?]
    # Colors follow the team code in the BR27 Master Timeline (rev D on): black ground, red power,
    # yellow signal, blue 5 V, CAN black = low / white = high. team_color() overrides the rev C
    # per-wire suggestions still passed as col; heat-shrink labels carry the wire ID.
    def add(f, fp, t, tp, sig, awg, col, mm, grp="", thru=False):
        w.append({"from": f, "fromPin": n(fp), "to": t, "toPin": n(tp), "signal": sig, "awg": awg, "color": team_color(sig), "mm": mm,
                  "group": grp or "", "via": "GR1" if thru else ""})

    def E(c, pin):
        return ["EMU-B", pin] if c == "B" else ["EMU-G", pin]

    # sensors
    sens = [["B", 8, "CKP", "+", "CRANK_VR+", 22, "White", 1400, "TSP1"], ["B", 21, "CMP", "+", "CAM_VR+", 22, "White", 1500, "TSP2"],
            ["B", 18, "TPS", "SIG", "TPS", 22, "Green", 1300], ["B", 5, "ECT", "SIG", "ECT", 22, "Tan", 1300], ["B", 32, "IAT", "SIG", "IAT", 22, "Tan/Black", 1200],
            ["B", 31, "OILP", "SIG", "OIL_P", 22, "Blue", 1400], ["B", 4, "FUELP", "SIG", "FUEL_P", 22, "Blue/White", 1200], ["B", 17, "OILT", "SIG", "OIL_T", 22, "Violet", 1400],
            ["B", 3, "KNK", "SIG", "KNOCK", 22, "White", 1400, "SH1"], ["B", 10, "NEUT", "SIG", "NEUTRAL", 22, "Light green", 1500]]
    for s in sens:
        c, pin, d, dp, sig, awg, col, mm = s[:8]
        add(*E(c, pin), d, dp, sig, awg, col, mm, s[8] if len(s) > 8 else "", True)
    # VR pair returns go back to the EMU sensor ground pin directly (twisted with the signal)
    add("EMU-B", 29, "CKP", "−", "CRANK_VR−", 22, "Black", 1400, "TSP1", True)
    add("EMU-B", 29, "CMP", "−", "CAM_VR−", 22, "Black", 1500, "TSP2", True)
    # +5 V ref and sensor ground through splices
    add("EMU-B", 26, "S1", "IN", "+5V_REF", 22, "Orange", 900, "", True)
    add("EMU-B", 34, "S1", "IN", "+5V_REF", 22, "Orange", 900, "", True)
    for d in ["TPS", "OILP", "FUELP"]:
        add("S1", "OUT", d, "+5V", "+5V_REF", 22, "Orange", 400)
    add("EMU-B", 38, "S2", "IN", "SGND", 22, "Brown", 900, "", True)
    add("EMU-B", 39, "S2", "IN", "SGND", 22, "Brown", 900, "", True)
    for d in ["TPS", "ECT", "IAT", "OILP", "FUELP", "OILT"]:
        add("S2", "OUT", d, "GND", "SGND", 22, "Brown", 400)
    # wideband, Bosch LSU 4.9 connector numbering (Rcal 5, VGND 2; the 4.2 swaps them). Fixed 2026-10-31.
    for c, pin, lp, sig, col in [["B", 6, 6, "WBO_VS", "Black"], ["B", 19, 1, "WBO_IP", "Red"], ["B", 22, 5, "WBO_RCAL", "Green"],
                                 ["B", 33, 2, "WBO_VGND", "Yellow"], ["G", 19, 3, "WBO_HTR−", "White"]]:
        htr = sig == "WBO_HTR−"
        add(*E(c, pin), "LSU", lp, sig, 18 if htr else 22, col, 1900, "" if htr else "TW1", True)
    # injectors and coils, low side from EMU, +12 V from kill splice
    for i, (c, pin, d) in enumerate([["G", 7, "INJ1"], ["G", 15, "INJ2"], ["G", 23, "INJ3"], ["G", 6, "INJ4"]]):
        add(*E(c, pin), d, "−", d + "_LS", 20, ["Blue/Red", "Blue/Yellow", "Blue/Green", "Blue/Black"][i], 1300, "", True)
    for i, (c, pin, d) in enumerate([["G", 8, "IGN1"], ["G", 16, "IGN2"], ["G", 9, "IGN3"], ["B", 14, "IGN4"]]):
        add(*E(c, pin), d, "−", d + "_LS", 20, ["Yellow/Red", "Yellow/Blue", "Yellow/Green", "Yellow/Black"][i], 1400, "", True)
    # kill bus
    add("FB", "F2", "K1", 30, "KILL_IN", 16, "Red", 150)
    add("K1", 87, "S3", "IN", "KILL_12V", 16, "Red/White", 900, "", True)
    for d in ["INJ1", "INJ2", "INJ3", "INJ4", "IGN1", "IGN2", "IGN3", "IGN4"]:
        add("S3", "OUT", d, "+", "KILL_12V", 20, "Red/White", 400)
    add("S3", "OUT", "LSU", 4, "KILL_12V", 18, "Red/White", 1000)
    # pump and fan relays (in the fuse box), pump +12 V from the kill bus side via F3
    add("EMU-G", 13, "K2", 85, "PUMP_RLY_LS", 20, "Pink", 200)
    add("K1", 87, "K2", 86, "KILL_12V", 20, "Red/White", 150)
    add("FB", "F3", "K2", 30, "PUMP_FEED", 16, "Red/White", 150)
    add("K2", 87, "PUMP", "+", "PUMP_12V", 16, "Red/Black", 1200)
    add("PUMP", "−", "GS", "STUD", "PUMP_GND", 16, "Black", 1200)
    add("EMU-G", 5, "K3", 85, "FAN_RLY_LS", 20, "Light blue", 200)
    add("FB", "F4", "K3", 86, "FAN_COIL_12V", 20, "Red", 150)
    add("FB", "F4", "K3", 30, "FAN_FEED", 14, "Red", 150)
    add("K3", 87, "FAN", "+", "FAN_12V", 14, "Red/Blue", 1100)
    add("FAN", "−", "GS", "STUD", "FAN_GND", 14, "Black", 1100)
    # ECU power, grounds, CAN
    add("FB", "F1", "EMU-B", 13, "ECU_12V", 18, "Red", 300)
    add("FB", "F1", "EMU-G", 18, "IGN_SENSE", 20, "Red/Yellow", 300)
    for c, pin, awg in [["B", 27, 16], ["B", 28, 18], ["G", 17, 16], ["G", 24, 16]]:
        add(*E(c, pin), "GS", "STUD", "ECU_GND", awg, "Black", 1200, "", True)
    add("EMU-B", 12, "CAN", "H", "CAN_H", 22, "Yellow", 200, "TW2")
    add("EMU-B", 25, "CAN", "L", "CAN_L", 22, "Green", 200, "TW2")
    # fuel level sender (rev C, appended so earlier wire IDs stay the same): EMU reads the
    # divider R1 (to +5 V) over the sender (to sensor ground). See the Fuel Level Sensor form.
    add("EMU-B", 35, "FLVL", "SIG", "FUEL_LVL", 22, "Grey", 1300, "", True)
    add("S1", "OUT", "R1", 1, "+5V_REF", 22, "Orange", 500)
    add("R1", 2, "FLVL", "SIG", "FUEL_LVL", 22, "Grey", 100)
    add("S2", "OUT", "FLVL", "GND", "SGND", 22, "Brown", 500)
    # pump and fan +12 V also cross the firewall through grommet GR1 (their grounds stay on the engine side)
    for r in w:
        if re.match(r"^(PUMP|FAN)_12V$", r["signal"]):
            r["via"] = "GR1"
    return [{"id": "W" + str(i + 1).zfill(3), **r} for i, r in enumerate(w)]


# JavaScript names the browser page uses -> Python functions
PY_NAMES = {"schematicSVG": "schematic_svg", "fuelSystemSVG": "fuel_system_svg", "bulkheadCount": "bulkhead_count",
            "components": "components", "wireList": "wire_list"}
