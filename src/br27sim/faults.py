"""Fault code system.

Each node (or the dash MCU, for faults derived from the EMU Black stream) runs
the same state machine per code:
  OK -> PENDING (condition true) -> ACTIVE (true for debounce) -> CLEARING
  (false) -> OK (false for clear time). Latching codes stay ACTIVE until reset.
While ACTIVE the source broadcasts an 8-byte fault frame: on every state
change at once, then repeating at the band's rate. CAN ID bands put faults
ahead of all data, critical first [proposal, not yet in the CAN ID map].
"""
import math

from ._js import to_fixed
from .can import CAN_LAYOUTS, bus_is_fd, can_messages, response_times, simulate_can
from .params import with_defaults

FAULT_BANDS = {
    "critical": {"label": "Critical", "base": 0x080, "repeatHz": 10, "dash": "Red alert + buzzer", "color": "--crit"},
    "warning": {"label": "Warning", "base": 0x090, "repeatHz": 2, "dash": "Amber alert", "color": "--warn"},
    "info": {"label": "Info", "base": 0x7E0, "repeatHz": 1, "dash": "Logged, icon on dash", "color": "--accent"},
}


def ramp(t, a, b, t0, t1):
    return a if t < t0 else b if t > t1 else a + (b - a) * (t - t0) / (t1 - t0)


sin = math.sin

# scenario(t) returns the monitored signal over a 6 s test; fault injected at 2 s
FAULTS = [
    {"code": "BR-C01", "name": "Low oil pressure", "sev": "critical", "src": "Dash MCU (from EMU stream)", "unit": "bar", "thr": 1.0, "dir": "below",
     "cond": "oil pressure < 1.0 bar while rpm > 3000", "debounceMs": 500, "clearMs": 1000, "latch": True,
     "action": "EMU Black engine protection cuts the engine (set in the EMU). Dash red alert. Driver stops.",
     "scenario": lambda t: ramp(t, 4.2, 0.4, 2, 2.6) + 0.15 * sin(40 * t)},
    {"code": "BR-C02", "name": "Coolant over-temperature", "sev": "critical", "src": "Dash MCU (from EMU stream)", "unit": "°C", "thr": 110, "dir": "above",
     "cond": "coolant > 110 °C", "debounceMs": 2000, "clearMs": 5000, "hyst": 5, "latch": False,
     "action": "EMU rev limit drops to 8000 rpm, fan forced on. Dash red alert.",
     "scenario": lambda t: ramp(t, 96, 117, 1.5, 2.5) + 0.4 * sin(3 * t)},
    {"code": "BR-C03", "name": "Battery over-voltage", "sev": "critical", "src": "Dash MCU", "unit": "V", "thr": 15.0, "dir": "above",
     "cond": "bus voltage > 15.0 V (regulator failed shorted)", "debounceMs": 200, "clearMs": 2000, "latch": True,
     "action": "Dash red alert: stop and check the regulator before the lithium battery is damaged.",
     "scenario": lambda t: ramp(t, 14.4, 15.8, 2, 2.4) + 0.05 * sin(25 * t)},
    {"code": "BR-C04", "name": "Shutdown circuit opened", "sev": "critical", "src": "Dash MCU (kill relay sense input)", "unit": "V", "thr": 6, "dir": "below",
     "cond": "kill relay coil voltage < 6 V with master switch on", "debounceMs": 20, "clearMs": 500, "latch": False,
     "action": "Engine already stopped in hardware. Fault records which event it was for the log.",
     "scenario": lambda t: 13.9 if t < 2 else 0.1},
    {"code": "BR-C05", "name": "Crank trigger sync lost", "sev": "critical", "src": "Dash MCU (from EMU stream)", "unit": "errors/s", "thr": 2, "dir": "above",
     "cond": "EMU trigger error counter rising > 2 per second", "debounceMs": 300, "clearMs": 3000, "latch": True,
     "action": "Engine misfires or stops. Dash red alert; check the crank and cam VR wiring and shields.",
     "scenario": lambda t: 0 if t < 2 else 6 + 2 * sin(9 * t)},
    {"code": "BR-W01", "name": "Not charging", "sev": "warning", "src": "Dash MCU", "unit": "V", "thr": 12.8, "dir": "below",
     "cond": "bus voltage < 12.8 V while rpm > 3000", "debounceMs": 5000, "clearMs": 3000, "latch": False,
     "action": "Dash amber alert. About 13 min of running left on the 4 Ah battery.",
     "scenario": lambda t: ramp(t, 14.4, 12.6, 1.8, 2.3) - 0.04 * t},
    {"code": "BR-W02", "name": "Lean at full throttle", "sev": "warning", "src": "Dash MCU (from EMU stream)", "unit": "λ", "thr": 0.95, "dir": "above",
     "cond": "lambda > 0.95 while MAP > 85 kPa", "debounceMs": 300, "clearMs": 1000, "latch": False,
     "action": "Dash amber alert, shift light flashes. Check fuel pressure and the fuel table.",
     "scenario": lambda t: ramp(t, 0.88, 0.99, 2, 2.5) + 0.01 * sin(30 * t)},
    {"code": "BR-W03", "name": "Corner node offline", "sev": "warning", "src": "Dash MCU (heartbeat monitor)", "unit": "ms since heartbeat", "thr": 500, "dir": "above",
     "cond": "no heartbeat from FL, FR, RL or RR for 500 ms", "debounceMs": 0, "clearMs": 300, "latch": False,
     "action": "Dash amber alert naming the node. Its channels show as missing in the log.",
     "scenario": lambda t: math.fmod(t * 1000, 100) if t < 2 else (t - 2) * 1000},
    {"code": "BR-W04", "name": "Sensor open or short", "sev": "warning", "src": "Corner node", "unit": "V", "thr": 4.75, "dir": "above",
     "cond": "any analog input < 0.25 V or > 4.75 V", "debounceMs": 100, "clearMs": 500, "latch": False,
     "action": "Channel marked invalid in the log. Dash amber alert with the channel name.",
     "scenario": lambda t: 2.3 + 0.6 * sin(8 * t) if t < 2 else 4.98},
    {"code": "BR-W05", "name": "Wheel speed implausible", "sev": "warning", "src": "Corner node", "unit": "km/h difference", "thr": 15, "dir": "above",
     "cond": "one wheel differs from the others by > 15 km/h for 1 s", "debounceMs": 1000, "clearMs": 1000, "latch": False,
     "action": "Logged. Usually a loose sensor or tone ring gap.",
     "scenario": lambda t: 2 + sin(5 * t) if t < 2 else 45},
    {"code": "BR-W06", "name": "CAN error passive", "sev": "warning", "src": "Any node", "unit": "TEC", "thr": 127, "dir": "above",
     "cond": "transmit error counter > 127", "debounceMs": 0, "clearMs": 2000, "latch": False,
     "action": "Node still talks but cannot flag errors. Dash amber alert, check that node's wiring.",
     "scenario": lambda t: 0 if t < 2 else min(255, (t - 2) * 120)},
    {"code": "BR-W07", "name": "Node 5 V rail low", "sev": "warning", "src": "Corner node", "unit": "V", "thr": 4.75, "dir": "below",
     "cond": "5 V sensor supply < 4.75 V", "debounceMs": 50, "clearMs": 500, "latch": False,
     "action": "Ratiometric sensors read wrong. Logged and flagged on the dash.",
     "scenario": lambda t: 5.0 if t < 2 else 4.55},
    {"code": "BR-W08", "name": "Brake light output fault", "sev": "warning", "src": "Node RL (output current sense)", "unit": "mA", "thr": 50, "dir": "below",
     "cond": "brake light commanded on but current < 50 mA (open LED string or blown fuse)", "debounceMs": 100, "clearMs": 500, "latch": False, "commandedOnly": True,
     "action": "Dash amber alert. Fix before the next run: a dead brake light fails tech (T.3.4).",
     "scenario": lambda t: ((280 if sin(2.2 * t) > 0 else 0) + 5) if t < 2 else 3},
    {"code": "BR-W09", "name": "Brake pressure sensor fault", "sev": "warning", "src": "Node FL / RL", "unit": "V", "thr": 0.25, "dir": "below",
     "cond": "front or rear brake pressure signal < 0.25 V (open) or > 4.75 V (short)", "debounceMs": 50, "clearMs": 500, "latch": False,
     "action": "Brake light falls back to the other circuit. Dash amber alert.",
     "scenario": lambda t: 0.6 + 0.4 * max(0, sin(3 * t)) if t < 2 else 0.05},
    {"code": "BR-W10", "name": "Low fuel", "sev": "warning", "src": "Dash MCU (fuel level from EMU + fuel used)", "unit": "L", "thr": 1.0, "dir": "below",
     "cond": "filtered fuel estimate < 1.0 L (about 9 laps at 0.106 L/lap)", "debounceMs": 5000, "clearMs": 10000, "latch": True,
     "action": "Dash amber alert with laps of fuel left. Pit or finish the stint. [proposal, Fuel Level Sensor form]",
     "scenario": lambda t: ramp(t, 1.4, 0.8, 1, 3) + 0.25 * sin(6 * t)},
    {"code": "BR-W11", "name": "Fuel level sender fault", "sev": "warning", "src": "Dash MCU (EMU analog #5 volts)", "unit": "V", "thr": 2.5, "dir": "above",
     "cond": "sender signal > 2.5 V (open circuit) or < 0.15 V (short to ground)", "debounceMs": 2000, "clearMs": 2000, "latch": False,
     "action": "Dash falls back to fuel used from injector pulse width. Logged; check the sender plug. [proposal]",
     "scenario": lambda t: 1.0 + 0.1 * sin(5 * t) if t < 2 else 4.95},
    {"code": "BR-I01", "name": "SD card write stall", "sev": "info", "src": "Dash MCU (logger)", "unit": "ms buffer", "thr": 250, "dir": "above",
     "cond": "write buffer older than 250 ms", "debounceMs": 0, "clearMs": 1000, "latch": False,
     "action": "Logged with a gap marker. Replace the card if it repeats.",
     "scenario": lambda t: 20 + 10 * sin(7 * t) if t < 2 else 400},
    {"code": "BR-I02", "name": "GPS no fix", "sev": "info", "src": "Dash MCU (GPS)", "unit": "satellites", "thr": 4, "dir": "below",
     "cond": "fewer than 4 satellites for 3 s", "debounceMs": 3000, "clearMs": 3000, "latch": False,
     "action": "Track map and lap timing fall back to the beacon or wheel speed.",
     "scenario": lambda t: 9 if t < 2 else 2},
]
# CAN IDs: each band's base, then one up per code in that band
for _i, _f in enumerate(FAULTS):
    _f["id"] = FAULT_BANDS[_f["sev"]]["base"] + len([g for g in FAULTS[:_i] if g["sev"] == _f["sev"]])


def find_fault(code):
    return next((x for x in FAULTS if x["code"] == code), FAULTS[0])


def fault_logic(code):
    """Run one code's state machine over its test scenario at 100 Hz."""
    f = find_fault(code)
    dt = 0.01
    out = {"t": [], "v": [], "state": []}
    # fault appears at ~2 s; non-latching faults recover later so the clear logic shows
    t_rec = 2 + f["debounceMs"] / 1000 + 1.5
    dur = max(6, t_rec) if f["latch"] else t_rec + f["clearMs"] / 1000 + 1.5

    def sig(t):
        return f["scenario"](t) if (f["latch"] or t < t_rec) else f["scenario"](min(1.9, 1.0 + (t - t_rec)))

    state, since, set_at, clear_at = "OK", 0, None, None
    hyst = f.get("hyst") or 0
    t = 0
    while t <= dur + 1e-4:
        v = sig(t)
        on = v > f["thr"] if f["dir"] == "above" else v < f["thr"]
        off = v < f["thr"] - hyst if f["dir"] == "above" else v > f["thr"] + hyst
        if state == "OK" and on:
            state, since = "PENDING", t
        elif state == "PENDING":
            if not on:
                state = "OK"
            elif (t - since) * 1000 >= f["debounceMs"]:
                state, set_at = "ACTIVE", t
        elif state == "ACTIVE" and off and not f["latch"]:
            state, since = "CLEARING", t
        elif state == "CLEARING":
            if on:
                state = "ACTIVE"
            elif (t - since) * 1000 >= f["clearMs"]:
                state, clear_at = "OK", t
        out["t"].append(float(to_fixed(t, 2))); out["v"].append(v); out["state"].append(state)
        t += dt
    first_true = next((tt for tt, s in zip(out["t"], out["state"]) if s != "OK"), None)
    return {"f": f, "series": out, "setAt": set_at, "clearAt": clear_at, "firstTrue": first_true,
            "band": FAULT_BANDS[f["sev"]], "dur": dur, "tRec": None if f["latch"] else t_rec}


def simulate_fault(params, code, bus=None, inject_ms=None):
    """Put one fault frame on the busy bus at inject_ms and trace arbitration.
    Also runs the same fault at the lowest priority for comparison."""
    p = with_defaults(params)
    f = find_fault(code)
    if inject_ms is None:
        # inject just before the busiest arbitration moment, when the most frames are queued
        b = simulate_can({**p, "findBusy": True}, bus)["busiest"]
        inject_ms = b["t"] * 1000 - 0.001
    t0 = inject_ms / 1000
    band = FAULT_BANDS[f["sev"]]
    times = [t0 + k / band["repeatHz"] for k in range(5)]
    sim_ms = max(p["canSimMs"], inject_ms + 600)

    def run(id_):
        return simulate_can({**p, "canSimMs": sim_ms,
                             "sporadic": [{"id": id_, "name": f"{f['code']} {f['name']}", "node": "Fault", "bytes": 8,
                                           "times": [x for x in times if x * 1000 < sim_ms - 50]}],
                             "traceFrom": t0, "traceTo": t0 + 0.0025}, bus)

    hi = run(f["id"])
    lo = run(0x7FF)
    fd = bus_is_fd(p, bus or CAN_LAYOUTS[p["canLayout"]]["buses"][0])
    # worst case for the fault frame: one blocking frame + all higher-priority frames
    msgs = can_messages(p, bus)
    all_ = sorted(msgs + [{"id": f["id"], "hz": band["repeatHz"], "bytes": 8, "name": f["code"]}], key=lambda m: m["id"])
    rta = next((r for r in response_times(p, all_, fd) if r["id"] == f["id"]), None)
    all_lo = sorted(msgs + [{"id": 0x7FF, "hz": band["repeatHz"], "bytes": 8, "name": f["code"]}], key=lambda m: m["id"])
    rta_lo = next((r for r in response_times(p, all_lo, fd) if r["id"] == 0x7FF), None)
    first = hi["spLat"][0] if hi["spLat"] else None
    first_lo = lo["spLat"][0] if lo["spLat"] else None
    logic = fault_logic(code)
    detect_ms = f["debounceMs"]
    dash_frame_ms = 20  # dash redraw at 50 Hz [assumption]
    return {
        "f": f, "band": band, "injectMs": inject_ms, "hi": hi, "lo": lo, "rta": rta, "rtaLo": rta_lo,
        "latencyMs": first["latencyMs"] if first else None, "latencyLoMs": first_lo["latencyMs"] if first_lo else None,
        "toDashMs": detect_ms + (rta["wcrt"] if rta else 0) + dash_frame_ms,
        "trace": hi["trace"], "queue": hi["queueAtTrace"], "logic": logic,
    }
