"""CAN bus: frame timing, the message list per bus, bus load, response times,
a frame-level discrete-event simulation, and the physical layer."""
import math

from ._js import INF, jmax, js_round, js_str, mulberry32, to_fixed
from .params import with_defaults

# Bus layouts. The EMU Black lists only classic CAN speeds (125k-1M), and a
# classic controller error-frames every FD frame it sees, so the FD options
# split the car into two buses with the dash MCU as the bridge. BR27 runs
# 'classic' (one CAN 2.0 bus) [Tanner 2026-10-27]; the others are what-ifs.
CAN_LAYOUTS = {
    "split": {"label": "Two buses: classic EMU bus + CAN FD chassis bus", "buses": ["pt", "ch"]},
    "classic": {"label": "One classic CAN bus for everything", "buses": ["all"]},
    "fdAll": {"label": "One CAN FD bus with the EMU on it", "buses": ["all"]},
}
BUS_INFO = {
    "pt": {"name": "Powertrain bus (classic CAN)", "ends": ["EMU Black", "Dash MCU"], "fd": False},
    "ch": {"name": "Chassis bus (CAN FD)", "ends": ["Dash MCU", "Node RL"], "fd": True},
    "all": {"name": "Car bus", "ends": ["Dash MCU", "Node RL"]},
}
FD_SIZES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64]


def fd_len(n):
    s = next((s for s in FD_SIZES if s >= n), None)
    return s or 64


def default_bus(p, bus):
    return bus or CAN_LAYOUTS[p["canLayout"]]["buses"][0]


def frame_time(p, nbytes, fd):
    """Frame duration in seconds. Classic: 11-bit ID. FD: arbitration and ACK/EOF
    at the nominal rate, data phase (ESI..CRC delimiter) at the data rate."""
    worst = p["stuffing"] == "worst"
    if not fd:
        nbytes = min(nbytes, 8)
        stuffable = 34 + 8 * nbytes
        stuff = math.floor((stuffable - 1) / 4) if worst else js_round(stuffable * 0.05)
        return {"bits": 47 + 8 * nbytes + stuff, "t": (47 + 8 * nbytes + stuff) / p["bitrate"]}
    n = fd_len(nbytes)
    arb_stuffable = 17  # SOF, ID, RRS, IDE, FDF, res, BRS
    arb = 17 + (math.floor((arb_stuffable - 1) / 4) if worst else 1)
    crc = 21 if n > 16 else 17
    data_stuffable = 5 + 8 * n  # ESI, DLC, data
    data = 5 + 8 * n + (math.floor((data_stuffable - 1) / 4) if worst else js_round(data_stuffable * 0.05)) + \
        4 + math.ceil((crc + 4) / 4) + crc + 1  # stuff count, fixed stuff bits, CRC, CRC delimiter
    tail = 1 + 1 + 7 + 3  # ACK, ACK delim, EOF, IFS
    return {"bits": arb + data + tail, "t": (arb + tail) / p["bitrate"] + data / p["fdDataRate"], "bytes": n}


def frame_bits(p, dlc=None):
    """Kept for the classic 8-byte figure quoted in the forms (135 bits worst case)."""
    return frame_time(p, 8 if dlc is None else dlc, False)["bits"]


def bus_is_fd(p, bus):
    return bus == "ch" or (bus == "all" and p["canLayout"] == "fdAll")


def can_messages(params, bus=None):
    """Messages per bus. Corner nodes (FL/FR/RL/RR) sit at each wheel; IMU and GPS
    connect to the dash MCU [Tanner]. Rates from the Sample Rates form."""
    p = with_defaults(params)
    bus = default_bus(p, bus)
    fd = bus_is_fd(p, bus)
    m = []

    def add(id_, name, node, hz, nbytes):
        if p["nodeOffline"] == node:
            return
        m.append({"id": id_, "name": name, "node": node, "hz": hz, "bytes": fd_len(nbytes) if fd else min(nbytes, 8)})

    chassis = bus in ("ch", "all")
    engine = bus in ("pt", "all")
    if chassis:
        pot = "pot, " if p["suspPots"] else ""
        fast_hz = 500 if p["suspPots"] else 200
        corners = [["FL", pot + "wheel speed, brake F, steering"], ["FR", pot + "wheel speed"],
                   ["RL", pot + "wheel speed, brake R"], ["RR", pot + "wheel speed"]]
        # brake light state: event on change + 50 Hz, just below the fault bands
        add(0x0A0, "Brake light state + F/R pressure", "RL", 50, 8)
        for i, (c, what) in enumerate(corners):
            if fd and p["packSusp"]:
                add(0x100 + i, f"{c} fast: {what} (2 samples)", c, fast_hz / 2, 16)
            else:
                add(0x100 + i, f"{c} fast: {what}", c, fast_hz, 8)
            add(0x10C + i, f"{c} temps", c, 10, 8)
            add(0x701 + i, f"Heartbeat {c}", c, 10, 8)
        if not p["imuGpsOnCan"]:
            pass  # logged directly by the dash MCU; LoRa to the pit is off-CAN too
        elif fd:
            add(0x120, "IMU 6-axis (via dash MCU)", "Dash", 200, 12)
            add(0x128, "GPS position, speed, heading", "Dash", 20, 16)
        else:
            add(0x120, "IMU accel (via dash MCU)", "Dash", 200, 8)
            add(0x121, "IMU gyro (via dash MCU)", "Dash", 200, 8)
            add(0x128, "GPS position", "Dash", 20, 8)
            add(0x129, "GPS speed/heading", "Dash", 20, 8)
        for i in range(p["extraFrames"]):
            add(0x130 + i, f"Extra channel frame {i + 1}", "X", 200, 8)
        # Dash MCU (logger) sends values only it has to the nodes: GPS/wheel-fused speed,
        # gear and rpm decoded from the EMU stream, lap/logging state. Nodes already hear
        # every raw frame on the shared bus, so nothing is re-sent as-is.
        fwd = ["Dash to nodes: speed, gear, rpm", "Dash to nodes: lap, logging, mode"]
        for i in range(p["dashFwdFrames"]):
            add(0x140 + i, fwd[i] if i < len(fwd) else f"Dash to nodes: frame {i + 1}", "Dash", p["dashFwdHz"], 8)
        add(0x7F0, "Logger time sync", "Dash", 10, 8)
    if engine:
        for i in range(p["emuFrames"]):
            add(0x600 + i, f"EMU Black stream {i + 1}", "EMU", p["emuRate"], 8)
        add(0x650, "Dash buttons, shift light", "Dash", 10, 8)
    add(0x705, "Heartbeat dash MCU", "Dash", 10, 8)
    m.sort(key=lambda x: x["id"])
    return m


def bus_load(p, msgs, fd, nominal=None):
    q = {**p, "bitrate": nominal} if nominal else p
    busy_per_s = fps = 0
    for m in msgs:
        busy_per_s += m["hz"] * frame_time(q, m["bytes"], fd)["t"]
        fps += m["hz"]
    return {"fps": fps, "load": busy_per_s * 100}


def response_times(p, msgs, fd):
    """Worst-case response time analysis for non-preemptive CAN (Davis et al. 2007, simplified)."""
    tbit = 1 / p["bitrate"]
    jit = p["jitterUs"] * 1e-6
    Cs = [frame_time(p, m["bytes"], fd)["t"] for m in msgs]
    out = []
    for i, m in enumerate(msgs):
        B = max(Cs[i + 1:]) if i < len(msgs) - 1 else 0
        w, prev, it = B, -1, 0
        while abs(w - prev) > 1e-9 and it < 200:
            it += 1
            prev = w
            w = B
            for j in range(i):
                w += math.ceil((prev + jit + tbit) / (1 / msgs[j]["hz"])) * Cs[j]
            if w > 1:
                break
        Rw = jit + w + Cs[i]
        out.append({"id": m["id"], "name": m["name"], "wcrt": Rw * 1000, "deadline": 1000 / m["hz"], "ok": Rw < 1 / m["hz"]})
    return out


def simulate_can(params, bus=None):
    """Discrete-event simulation of one bus: periodic releases with random
    phase and jitter, global priority arbitration, optional bit errors."""
    p = with_defaults(params)
    bus = default_bus(p, bus)
    fd = bus_is_fd(p, bus)
    msgs = can_messages(p, bus)
    rnd = mulberry32(27)
    sim_s = p["canSimMs"] / 1000
    ft = {m["id"]: frame_time(p, m["bytes"], fd) for m in msgs}
    rel = []
    for m in msgs:
        T = 1 / m["hz"]
        phase = rnd() * T
        t = phase
        while t < sim_s:
            rel.append({"t": t + rnd() * p["jitterUs"] * 1e-6, "m": m})
            t += T
    # sporadic (event) frames such as fault broadcasts: [{id, name, node, bytes, times: [s]}]
    sporadic = p.get("sporadic") or []
    for sp in sporadic:
        ft[sp["id"]] = frame_time(p, sp["bytes"], fd)
        for ts in sp["times"]:
            rel.append({"t": ts, "m": sp, "sporadic": True})
    rel.sort(key=lambda r: r["t"])
    pend = {}
    stat = {}
    for m in msgs + sporadic:
        stat[m["id"]] = {"id": m["id"], "name": m["name"], "node": m["node"], "hz": m.get("hz") or 0, "bytes": m["bytes"],
                         "n": 0, "sum": 0, "max": 0, "overruns": 0, "errors": 0}
    trace, sp_lat = [], []
    busiest = {"n": 0, "t": 0.4}
    queue_at_trace = None
    win = 0.01
    nw = math.ceil(sim_s / win)
    busy_w = [0.0] * nw
    t, ri, err_frames = 0, 0, 0
    busy = [0]
    trace_from, trace_to = p.get("traceFrom"), p.get("traceTo")

    def add_busy(t0, dur):
        a = t0
        end = t0 + dur
        while a < end:
            w = math.floor(a / win)
            if (w + 1) * win <= a:
                w += 1  # float edge exactly on a window boundary
            w_end = min(end, (w + 1) * win)
            if w < nw:
                busy_w[w] += w_end - a
            a = w_end
        busy[0] += dur

    while ri < len(rel) or pend:
        if not pend:
            t = max(t, rel[ri]["t"])
        while ri < len(rel) and rel[ri]["t"] <= t:
            r = rel[ri]
            ri += 1
            if r["m"]["id"] in pend:
                stat[r["m"]["id"]]["overruns"] += 1
            pend[r["m"]["id"]] = r
        if not pend:
            continue
        if p.get("findBusy") and 0.1 < t < sim_s - 0.1 and len(pend) > busiest["n"]:
            busiest = {"n": len(pend), "t": t}
        if trace_from is not None and queue_at_trace is None and t >= trace_from:
            queue_at_trace = sorted(({"id": r["m"]["id"], "name": r["m"]["name"], "node": r["m"]["node"],
                                      "waitingUs": (t - r["t"]) * 1e6} for r in pend.values()), key=lambda q: q["id"])
        best_id = min(pend)
        r = pend.pop(best_id)
        f = ft[best_id]
        p_err = 1 - math.pow(1 - p["ber"], f["bits"])
        if p_err > 0 and rnd() < p_err:
            # error part-way through, error frame (~23 nominal bits incl. IFS), then retry
            dur = f["t"] * rnd() + 23 / p["bitrate"]
            add_busy(t, dur)
            t += dur
            err_frames += 1
            stat[best_id]["errors"] += 1
            pend[best_id] = r
            continue
        add_busy(t, f["t"])
        if trace_from is not None and t + f["t"] >= trace_from - 0.0005 and t <= trace_to:
            trace.append({"id": best_id, "name": r["m"]["name"], "node": r["m"]["node"], "start": t, "end": t + f["t"],
                          "released": r["t"], "sporadic": bool(r.get("sporadic"))})
        t += f["t"]
        if r.get("sporadic"):
            sp_lat.append({"id": best_id, "released": r["t"], "done": t, "latencyMs": (t - r["t"]) * 1000})
        if t > sim_s + 0.05:
            break
        s = stat[best_id]
        lat = (t - r["t"]) * 1000
        s["n"] += 1
        s["sum"] += lat
        s["max"] = max(s["max"], lat)
    load_win = [b / win * 100 for b in busy_w]
    per = []
    for s in stat.values():
        if s["hz"] > 0:
            s["mean"] = s["sum"] / s["n"] if s["n"] else 0
            s["period"] = 1000 / s["hz"]
            per.append(s)
    bl = bus_load(p, msgs, fd)
    if fd:
        sweep = [{"label": f"{js_str(n / 1e6)}/{js_str(d / 1e6)} Mbps",
                  "load": bus_load({**p, "fdDataRate": d}, msgs, True, n)["load"]}
                 for n, d in [[500000, 2000000], [1000000, 2000000], [1000000, 5000000], [1000000, 8000000]]]
    else:
        sweep = [{"label": "1 Mbps" if br >= 1e6 else js_str(br / 1000) + " kbps", "load": bus_load(p, msgs, False, br)["load"]}
                 for br in [125000, 250000, 500000, 1000000]]
    by_node = {}
    for m in msgs:
        by_node[m["node"]] = by_node.get(m["node"], 0) + m["hz"] * ft[m["id"]]["t"] * 100
    rta = response_times(p, msgs, fd)
    bytes_per_s = 0
    for m in msgs:
        bytes_per_s += m["hz"] * (m["bytes"] + 8)  # payload + ID/len/timestamp
    # the logger also stores IMU (200 Hz, 12 B) and GPS (20 Hz, 16 B) read directly, when they are not on the bus
    direct_bytes = 0 if (p["imuGpsOnCan"] or bus not in ("all", "ch")) else 200 * (12 + 8) + 20 * (16 + 8)
    return {
        "p": p, "bus": bus, "fd": fd, "info": BUS_INFO[bus], "msgs": msgs, "per": per, "loadWin": load_win,
        "winMs": win * 1000, "sweep": sweep, "byNode": by_node, "rta": rta,
        "emuOnFd": fd and any(m["node"] == "EMU" for m in msgs),
        "trace": trace, "spLat": sp_lat, "queueAtTrace": queue_at_trace or [], "busiest": busiest,
        "stats": {
            "fps": bl["fps"], "load": bl["load"], "bits": frame_bits(p), "measuredLoad": busy[0] / sim_s * 100,
            "peakWin": jmax(load_win), "maxLatency": jmax([s["max"] for s in per]),
            "overruns": sum(s["overruns"] for s in per), "errFrames": err_frames,
            "wcrtMax": jmax([r["wcrt"] for r in rta]), "unschedulable": len([r for r in rta if not r["ok"]]),
            "logKBs": (bytes_per_s + direct_bytes) / 1024, "logMB30": (bytes_per_s + direct_bytes) * 1800 / 1048576,
            "frame200Pct": 200 * frame_time(p, 8, fd)["t"] * 100,
        },
    }


def simulate_can_all(params=None):
    p = with_defaults(params)
    return [simulate_can(p, b) for b in CAN_LAYOUTS[p["canLayout"]]["buses"]]


def can_physical(params, bus=None):
    """Physical layer for one bus. Both ends carry 120 ohm; nodes hang on stubs."""
    p = with_defaults(params)
    bus = default_bus(p, bus)
    fd = bus_is_fd(p, bus)
    trunk = p["trunkPtM"] if bus == "pt" else p["trunkChM"] if bus == "ch" else p["trunkAllM"]
    emu_term = bus not in ("pt", "ch") and p["emuTerm"]  # only on the single-bus layouts, where the EMU is mid-bus
    terms = len([x for x in [p["termEnd1"], p["termEnd2"], p["termExtra"], emu_term] if x])
    r_total = 120 / terms if terms else INF
    tbit_ns = 1e9 / p["bitrate"]
    ns_per_m = 5
    max_len = (p["samplePoint"] * tbit_ns - 2 * p["trxLoopNs"]) / (2 * ns_per_m)
    fast_rate = p["fdDataRate"] if fd else p["bitrate"]
    max_stub = min(0.3, 0.6e6 / fast_rate) if fd else 0.3e6 / fast_rate  # common stub guidelines [assumption]
    Z0 = 120

    def gam(r):
        return 1 if r == INF else (r - Z0) / (r + Z0)

    g_near = gam((60 if (p["termExtra"] or emu_term) else 120) if p["termEnd1"] else INF)
    g_far = gam(120 if p["termEnd2"] else INF)
    td = trunk * ns_per_m
    rise = 15 if fd else 40
    wave = {"t": [], "v": []}

    def step(x):
        return 0 if x <= 0 else 1 if x >= rise else x / rise

    span = 1e9 / fast_rate
    tn = 0
    while tn <= span:
        # lattice diagram: recessive edge launched at end 1, seen at end 2
        v, amp, t_arr, k = 0, 1, td, 0
        v += amp * step(tn - t_arr)
        amp *= g_far
        v += amp * step(tn - t_arr)
        while True:
            k += 1
            if not (k - 1 < 30 and abs(amp) > 1e-3):
                break
            amp *= g_near
            t_arr += 2 * td
            v += amp * step(tn - t_arr) * (1 + g_far)
            amp *= g_far
        wave["t"].append(tn)
        wave["v"].append(1 - v / (1 + g_far))
        tn += span / 200
    issues = []
    name = BUS_INFO[bus]["name"]
    if terms < 2:
        issues.append(f"{name}: no termination, the bus will not work." if terms == 0
                      else f"{name}: only one 120 Ω terminator, expect ringing and errors.")
    if terms > 2:
        fix = "Switch off the EMU Black built-in terminator; the EMU is mid-bus." if emu_term else "Remove the extra one."
        issues.append(f"{name}: {terms} terminators ({to_fixed(120 / terms, 0)} Ω). {fix}")
    if trunk > max_len:
        issues.append(f"{name}: {js_str(trunk)} m trunk is longer than the {to_fixed(max_len, 0)} m allowed at this bitrate.")
    if p["stubM"] > max_stub:
        issues.append(f"{name}: {js_str(p['stubM'])} m stubs exceed the {to_fixed(max_stub, 2)} m guideline at {js_str(fast_rate / 1e6)} Mbps.")
    return {"bus": bus, "fd": fd, "ends": BUS_INFO[bus]["ends"], "trunk": trunk, "terms": terms, "rTotal": r_total,
            "maxLen": max_len, "maxStub": max_stub, "wave": wave, "issues": issues, "propNs": td,
            "samplePointNs": (0.75 if fd else p["samplePoint"]) * span, "bitNs": span}


def arbitrate(id_a, id_b):
    """11-bit arbitration between two IDs: returns the bit where the loser backs off."""
    bits = []
    decided = None
    for b in range(10, -1, -1):
        a, c = (id_a >> b) & 1, (id_b >> b) & 1
        bits.append({"bit": b, "a": a, "b": c, "bus": a & c})
        if decided is None and a != c:
            decided = {"bit": b, "winner": id_a if a == 0 else id_b}
    return {"bits": bits, "decided": decided}
