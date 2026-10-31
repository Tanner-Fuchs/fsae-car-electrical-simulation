"""Component simulations: try a part choice before buying it.

Wheel speed: a Hall effect or a variable reluctance (VR) sensor reading a tone ring
with N teeth, read by a corner node and sent on CAN at the wheel speed rate.

Hall effect: powered (3 wires), digital square-wave output whose size does not
depend on speed, so it reads down to 0 km/h. It only works up to a maximum air gap
and needs teeth wide enough for its sensing face.

VR: passive coil (2 wires, no power). Output is an AC voltage proportional to how
fast the teeth pass, so at low speed it is too small to detect over ignition noise.
It needs a conditioning chip (MAX9926 / LM1815 class) to turn it into edges.

The node measures speed from the edges, either by timing the period between
edges ("period") or by counting edges in each CAN sample window ("count").

All sensor numbers below are typical datasheet-class values, tagged [assumption]
until the team picks a part.
"""
import math

from ._js import mulberry32
from .params import with_defaults

WHEEL_DEFAULTS = {
    "sensor": "hall",       # hall | vr
    "teeth": 30,            # dedicated 30-tooth tone rings [form: Sensor Mounting Locations]
    "ringMM": 120,          # tone ring outer diameter [assumption]
    "gapMM": 1.0,           # air gap, sensor face to tooth tip [assumption]
    "rateHz": 200,          # wheel speed CAN rate [form: Sample Rates per Channel]
    "method": "period",     # period | count
    "needKmh": 3,           # slowest speed that must read (pit lane, launch) [assumption]
    "timerMHz": 1.0,        # input capture timer tick [assumption, STM32 timer prescaled]
    "timeoutMs": 100,       # no edge for this long reads 0 km/h [assumption]
    "pitchErrPct": 0.5,     # tooth-to-tooth spacing error of the ring, 1 sigma [assumption, laser cut]
    # Hall effect gear tooth sensor [assumption: Honeywell GT101 / ZF GS100 class]
    "hallMaxGapMM": 2.0,
    "hallMinToothMM": 2.0,  # minimum tooth (and slot) width along the ring
    "hallMA": 10,           # supply current
    # VR sensor [assumption: generic 2-wire wheel speed VR]
    "vrMvPerHz": 3.0,       # peak mV per Hz of tooth rate at 0.5 mm gap with full-size teeth
    "vrGapDecayMM": 0.6,    # amplitude falls by e for each this many mm of extra gap
    "vrPoleMM": 4.0,        # pole piece diameter; teeth narrower than this lose signal
    "vrThreshMV": 50,       # conditioning chip arming threshold [assumption: MAX9926 class]
    "vrNoiseMV": 30,        # ignition noise picked up on the harness, peak [assumption]
}


def wheel_defaults(w=None):
    out = dict(WHEEL_DEFAULTS)
    out.update(w or {})
    return out


def _circ(p):
    return math.pi * p["tireD"]  # metres per wheel turn


def tooth_hz(p, w, kmh):
    return w["teeth"] * (kmh / 3.6) / _circ(p)


def tooth_width_mm(w):
    """Tooth (and slot) width along the ring, half the tooth pitch."""
    return math.pi * w["ringMM"] / w["teeth"] / 2


def vr_geometry(w):
    """Fraction of full VR signal left when teeth get narrower than the pole piece.
    Smooth fit to the 'tooth width >= pole diameter' rule [assumption]."""
    r = tooth_width_mm(w) / w["vrPoleMM"]
    return math.tanh(1.5 * r * r)


def vr_mv(w, hz):
    """Peak VR output (mV) at a tooth rate."""
    return w["vrMvPerHz"] * hz * vr_geometry(w) * math.exp(-(w["gapMM"] - 0.5) / w["vrGapDecayMM"])


def vr_detect_mv(w):
    """Signal needed for clean edges: the arming threshold plus the noise on top of it."""
    return w["vrThreshMV"] + w["vrNoiseMV"]


def hall_ok(w):
    """Why a Hall sensor cannot read this ring, or '' if it can."""
    if w["gapMM"] > w["hallMaxGapMM"]:
        return f"air gap {w['gapMM']:.1f} mm is past the sensor's {w['hallMaxGapMM']:.1f} mm maximum"
    if tooth_width_mm(w) < w["hallMinToothMM"]:
        return f"teeth are {tooth_width_mm(w):.1f} mm wide, under the sensor's {w['hallMinToothMM']:.1f} mm minimum"
    return ""


def min_speed_kmh(p, w, sensor):
    """Lowest speed that reads as moving."""
    timeout_hz = 1000 / w["timeoutMs"]  # one tooth per timeout
    floor = timeout_hz * _circ(p) / w["teeth"] * 3.6
    if sensor == "hall":
        return floor if not hall_ok(w) else math.inf
    per_hz = vr_mv(w, 1.0)
    if per_hz <= 0:
        return math.inf
    hz = vr_detect_mv(w) / per_hz
    return max(floor, hz * _circ(p) / w["teeth"] * 3.6)


def resolution_kmh(p, w, kmh, method):
    """Smallest speed step one CAN sample can show at this speed."""
    T = 1 / w["rateHz"]
    pitch_m = _circ(p) / w["teeth"]
    if method == "count":
        return pitch_m / T * 3.6
    f = tooth_hz(p, w, kmh)
    if f <= 0:
        return math.inf
    edges = max(1, math.floor(f * T))
    span = edges / f
    return kmh * (1 / (w["timerMHz"] * 1e6)) / span


def update_hz(p, w, kmh, method):
    """How often the value really changes (a new edge per sample, or slower)."""
    if method == "count":
        return w["rateHz"]
    return min(w["rateHz"], tooth_hz(p, w, kmh))


def noise_kmh(p, w, kmh, method):
    """1 sigma speed noise from uneven tooth spacing, averaged over the edges in one sample."""
    if method == "count":
        return 0.0
    f = tooth_hz(p, w, kmh)
    edges = max(1, math.floor(f / w["rateHz"]))
    return kmh * w["pitchErrPct"] / 100 / math.sqrt(edges) * math.sqrt(2)


# ---------------------------------------------------------------- time simulation


def _scenario():
    """Pit-lane roll-out (0 to 50 km/h and back to a stop), then the start of a lap."""
    t, v = [], []
    dt = 0.001
    prof = [(0.0, 0), (0.5, 0), (1.0, 3), (2.0, 6), (4.5, 50), (5.5, 50), (7.5, 0), (8.5, 0)]
    for i in range(int(8.5 / dt)):
        ti = i * dt
        for (t0, v0), (t1, v1) in zip(prof, prof[1:]):
            if t0 <= ti < t1:
                v.append(v0 + (v1 - v0) * (ti - t0) / (t1 - t0))
                break
        t.append(ti)
    return t, v


def _edges(p, w, ts, vs, sensor, rnd):
    """Edge times as the ring turns, with uneven teeth and the VR missing small signals."""
    pitch = _circ(p) / w["teeth"]
    spacing = [pitch * (1 + w["pitchErrPct"] / 100 * _gauss(rnd)) for _ in range(w["teeth"])]
    edges = []
    x, nxt, k = 0.0, spacing[0], 0
    dead = hall_ok(w) if sensor == "hall" else ""
    for i in range(1, len(ts)):
        dt = ts[i] - ts[i - 1]
        v = (vs[i] + vs[i - 1]) / 2 / 3.6
        x0, x = x, x + v * dt
        while x >= nxt:
            te = ts[i - 1] + (nxt - x0) / v if v > 0 else ts[i]
            k += 1
            nxt += spacing[k % w["teeth"]]
            if dead:
                continue
            if sensor == "vr":
                mv = vr_mv(w, tooth_hz(p, w, v * 3.6))
                need = vr_detect_mv(w)
                # below the threshold: nothing; inside the noise band: some edges lost
                if mv < w["vrThreshMV"] or (mv < need and rnd() > (mv - w["vrThreshMV"]) / max(1e-9, need - w["vrThreshMV"])):
                    continue
            edges.append(te)
    return edges, pitch


def _gauss(rnd):
    u, v = max(rnd(), 1e-12), rnd()
    return math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * v)


def _measure(w, edges, pitch, t_end, method):
    """What the node sends on CAN at each sample."""
    T = 1 / w["rateHz"]
    tick = 1 / (w["timerMHz"] * 1e6)
    q = lambda t: math.floor(t / tick) * tick  # capture timer
    out_t, out_v = [], []
    j, last, prev = 0, None, 0.0
    n = int(t_end / T)
    for s in range(1, n + 1):
        ts = s * T
        first = j
        while j < len(edges) and edges[j] <= ts:
            j += 1
        new = edges[first:j]
        if method == "count":
            v = len(new) * pitch / T * 3.6
        elif new:
            start = last if last is not None else (new[0] if len(new) > 1 else None)
            cnt = len(new) if last is not None else len(new) - 1
            v = cnt * pitch / (q(new[-1]) - q(start)) * 3.6 if start is not None and cnt > 0 and q(new[-1]) > q(start) else prev
            last = new[-1]
        elif last is None or ts - last > w["timeoutMs"] / 1000:
            v = 0.0
        else:
            # no new edge: the wheel is at most this fast, so the value comes down as it slows
            v = min(prev, pitch / (ts - last) * 3.6)
        if new and method == "count":
            last = new[-1]
        out_t.append(ts)
        out_v.append(v)
        prev = v
    return out_t, out_v


def simulate_wheel_speed(params=None, w=None, lap=None):
    p = with_defaults(params)
    w = wheel_defaults(w)
    method = w["method"]
    top = max(lap["series"]["v"]) if lap else 110.0
    corner_min = min(lap["series"]["v"]) if lap else 30.0

    # one sensor reading a slow roll-out and stop
    ts, vs = _scenario()
    traces = {}
    for sensor in ("hall", "vr"):
        edges, pitch = _edges(p, w, ts, vs, sensor, mulberry32(7))
        mt, mv = _measure(w, edges, pitch, ts[-1], method)
        traces[sensor] = {"t": mt, "v": mv}
    true_t = ts[::20]
    true_v = vs[::20]

    # sweep over speed at the chosen tooth count
    speeds = [x * 1.0 for x in range(0, 131, 2)]
    sweep = []
    for k in speeds:
        f = tooth_hz(p, w, k)
        sweep.append({"kmh": k, "hz": f, "vrMv": vr_mv(w, f),
                      "resPeriod": resolution_kmh(p, w, k, "period") if k > 0 else None,
                      "resCount": resolution_kmh(p, w, k, "count"),
                      "noise": noise_kmh(p, w, k, "period") if k > 0 else None,
                      "updPeriod": update_hz(p, w, k, "period")})

    # sweep over tooth count
    by_teeth = []
    for n in range(4, 101, 2):
        wn = dict(w, teeth=n)
        by_teeth.append({
            "teeth": n, "toothMM": tooth_width_mm(wn),
            "minHall": min_speed_kmh(p, wn, "hall"), "minVr": min_speed_kmh(p, wn, "vr"),
            "fullRateKmh": w["rateHz"] * _circ(p) / n * 3.6,  # below this the value updates slower than CAN
            "resCount": resolution_kmh(p, wn, 20, "count"),
            "noise20": noise_kmh(p, wn, 20, "period"),
            "hzTop": tooth_hz(p, wn, top), "hallOk": not hall_ok(wn), "vrGeo": vr_geometry(wn),
        })

    # what this choice means
    min_h, min_v = min_speed_kmh(p, w, "hall"), min_speed_kmh(p, w, "vr")
    full_rate = w["rateHz"] * _circ(p) / w["teeth"] * 3.6

    # teeth that read down to needKmh and give a new value every CAN sample through the slowest corner
    key = "minHall" if w["sensor"] == "hall" else "minVr"
    good = [r for r in by_teeth if r[key] <= w["needKmh"] and r["fullRateKmh"] <= corner_min]
    rec = {"lo": good[0]["teeth"], "hi": good[-1]["teeth"]} if good else None
    best_vr = min(by_teeth, key=lambda r: r["minVr"])

    return {
        "w": w, "tireD": p["tireD"], "topKmh": top, "cornerMinKmh": corner_min,
        "toothMM": tooth_width_mm(w), "hzTop": tooth_hz(p, w, top),
        "hallProblem": hall_ok(w), "vrGeo": vr_geometry(w),
        "minHall": min_h, "minVr": min_v, "fullRateKmh": full_rate,
        "resPeriod20": resolution_kmh(p, w, 20, "period"), "resCount": resolution_kmh(p, w, 20, "count"),
        "noise20": noise_kmh(p, w, 20, "period"), "noiseTop": noise_kmh(p, w, top, "period"),
        "vrMvAt5": vr_mv(w, tooth_hz(p, w, 5)), "vrMvTop": vr_mv(w, tooth_hz(p, w, top)),
        "detectMv": vr_detect_mv(w),
        "rollout": {"truthT": true_t, "truthV": true_v, "hall": traces["hall"], "vr": traces["vr"]},
        "sweep": sweep, "byTeeth": by_teeth, "rec": rec,
        "bestVr": {"teeth": best_vr["teeth"], "kmh": best_vr["minVr"]},
    }
