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
    "needKmh": 3.218688,    # 2 mph, slowest speed that must read (pit lane, launch) [assumption]
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
    # true speed at the same instants as the CAN samples, so the traces line up point for point
    true_t = traces["hall"]["t"]
    true_v = [vs[min(len(vs) - 1, round(t / (ts[1] - ts[0])))] for t in true_t]

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


# ---------------------------------------------------------------- IR temperature sensors
# Single-pixel thermopile (MLX90614 class) aimed at the tire tread or the brake rotor.
# The sensor averages the infrared from everything inside its field of view: if the
# spot is bigger than the target it also sees the background and reads low.

IR_TARGETS = {
    "tire": {"label": "Tire tread", "widthMM": 152, "emis": 0.95, "tempC": 70, "gradC": 12, "bgC": 35,
             "note": "Hoosier 10 in tire, about 6 in of tread [assumption]; the background is track and air"},
    "rotor": {"label": "Brake rotor face", "widthMM": 32, "emis": 0.5, "tempC": 350, "gradC": 0, "bgC": 80,
              "note": "Rotor friction band [assumption]; the background is the wheel and upright. Bare steel and iron emissivity changes with wear and bluing"},
}

IR_DEFAULTS = {
    "target": "tire",
    "fovDeg": 35,          # full cone angle [assumption: MLX90614xCI]; 90, 35, 10 and 5 degree versions exist
    "distMM": 100,         # lens to target
    "offsetMM": 0,         # spot centre off the target centreline (camber, steer, mounting)
    "mount": "chassis",    # chassis (front tire steers under the sensor) | upright (sensor turns with the wheel)
    "steerDeg": 0,         # front road wheel angle; FSAE hairpins need about 25 degrees [assumption]
    "aimFwdMM": 150,       # how far ahead of (or behind) the steering axis the spot lands on the tread [assumption]
    "spots": 1,            # sensors across the target (1, or 3 for inner/middle/outer)
    "lensMM": 4,           # spot size at the lens [assumption]
    "emisSet": 0.95,       # emissivity set in the sensor
    "widthMM": None, "emis": None, "tempC": None, "gradC": None, "bgC": None,  # None = from the target
}


def ir_defaults(o=None):
    out = dict(IR_DEFAULTS)
    out.update({k: v for k, v in (o or {}).items() if v is not None or k not in out})
    t = IR_TARGETS.get(out["target"], IR_TARGETS["tire"])
    for k in ("widthMM", "emis", "tempC", "gradC", "bgC"):
        if out.get(k) is None:
            out[k] = t[k]
    return out


def ir_spot_mm(o, dist=None):
    d = o["distMM"] if dist is None else dist
    return o["lensMM"] + 2 * d * math.tan(math.radians(o["fovDeg"]) / 2)


def _ir_read(o, centre, dist=None, n=200):
    """What one sensor reads (degC) with its spot centred `centre` mm across the target.
    The target is a band across x, so the spot is summed in strips of x weighted by chord length."""
    K = 273.15
    D = ir_spot_mm(o, dist)
    w = o["widthMM"]
    bg4 = (o["bgC"] + K) ** 4
    sig = on = tot = 0.0
    for i in range(n):
        x = (i + 0.5) / n * 2 - 1
        h = math.sqrt(1 - x * x)  # chord length weight
        tot += h
        px = centre + x * D / 2
        if abs(px) <= w / 2:
            on += h
            # temperature across the tread: inner edge (negative x) hotter by gradC
            t = o["tempC"] - o["gradC"] * px / (w / 2) / 2 + K
            sig += h * (o["emis"] * t ** 4 + (1 - o["emis"]) * bg4)
        else:
            sig += h * bg4
    sig /= tot
    e = o["emisSet"]
    t4 = (sig - (1 - e) * bg4) / e
    return max(t4, 0) ** 0.25 - K, on / tot


def ir_steer_shift_mm(o, steer=None):
    """How far the tread slides across under a chassis-mounted sensor when the front wheel steers.
    The tread turns about the steering axis, so a spot `aimFwdMM` ahead of it moves sideways by aimFwd * tan(steer)."""
    if o.get("mount") != "chassis":
        return 0.0
    d = o["steerDeg"] if steer is None else steer
    return o["aimFwdMM"] * math.tan(math.radians(d))


def _spot_centres(o, steer=None):
    n = int(o["spots"])
    w = o["widthMM"]
    off = o["offsetMM"] + ir_steer_shift_mm(o, steer)
    return [off + (k + 0.5) / n * w - w / 2 for k in range(n)]


def simulate_ir(o=None):
    o = ir_defaults(o)
    w = o["widthMM"]
    centres = _spot_centres(o)
    spots = []
    for c in centres:
        meas, fill = _ir_read(o, c)
        # the true temperature under the middle of this spot
        true = o["tempC"] - o["gradC"] * max(-1, min(1, c / (w / 2))) / 2
        spots.append({"centre": c, "meas": meas, "fill": fill, "true": true})
    D = ir_spot_mm(o)
    zone = w / int(o["spots"])
    # distance at which the spot just fits its zone
    fit = (zone - o["lensMM"]) / (2 * math.tan(math.radians(o["fovDeg"]) / 2)) if zone > o["lensMM"] else 0
    dists = list(range(20, 401, 10))
    fovs = [5, 10, 35, 90]
    by_dist = {f: [{"d": d, "meas": _ir_read(dict(o, fovDeg=f), centres[len(centres) // 2], d)[0],
                    "spot": ir_spot_mm(dict(o, fovDeg=f), d)} for d in dists] for f in fovs}
    if o["fovDeg"] not in fovs:
        by_dist[o["fovDeg"]] = [{"d": d, "meas": _ir_read(o, centres[len(centres) // 2], d)[0], "spot": ir_spot_mm(o, d)} for d in dists]
    offs = [x - 60 for x in range(0, 121, 4)]
    by_off = [{"off": x, "meas": _ir_read(dict(o, offsetMM=x), _spot_centres(dict(o, offsetMM=x))[len(centres) // 2])[0]} for x in offs]
    # front wheel steer: chassis mount vs upright mount, middle sensor
    mid = len(centres) // 2
    steers = list(range(-30, 31, 2))
    by_steer = [{"deg": d,
                 "chassis": _ir_read(o, _spot_centres(dict(o, mount="chassis"), d)[mid])[0],
                 "upright": _ir_read(o, _spot_centres(dict(o, mount="upright"), d)[mid])[0]} for d in steers]
    # steer at which the chassis-mounted middle spot starts to leave the target
    half = (w - D) / 2
    lose = math.degrees(math.atan(max(0.0, half - abs(o["offsetMM"])) / o["aimFwdMM"])) if o["aimFwdMM"] > 0 else 90.0
    return {"o": o, "target": IR_TARGETS.get(o["target"], IR_TARGETS["tire"]), "spotMM": D, "tireD": with_defaults()["tireD"],
            "steerShiftMM": ir_steer_shift_mm(o), "bySteer": by_steer, "loseDeg": lose if D < w else 0.0, "zoneMM": zone, "fitDistMM": fit,
            "spots": spots, "byDist": by_dist, "byOff": by_off, "fovs": sorted(by_dist)}


# ---------------------------------------------------------------- steering angle potentiometer

STEER_DEFAULTS = {
    "mount": "column",      # column (rotary pot on the steering shaft) | rack (linear pot on the rack)
    "lockDeg": 110,         # steering wheel angle at full lock, each way [assumption]
    "cFactorMM": 90,        # rack travel per steering wheel turn [assumption]
    "potDeg": 340,          # rotary pot electrical travel [assumption: 340 degree single-turn]
    "potMM": 75,            # linear pot electrical travel [assumption]
    "gear": 1.0,            # pot turns per steering shaft turn (gear or belt between them)
    "adcBits": 12,          # STM32G431 ADC
    "noiseLsb": 2.0,        # ADC + wiring noise, rms counts [assumption]
    "linPct": 1.0,          # pot linearity, % of full scale [assumption: carbon track; conductive plastic is ~0.25 %]
    "ratiometric": True,    # pot fed from the ADC reference, so supply changes cancel
    "supplyPct": 2.0,       # 5 V rail change if not ratiometric [assumption]
    "backlashDeg": 0.5,     # free play in the coupling, at the steering wheel [assumption]
    "rateHz": 200,          # steering angle CAN rate [form: Sample Rates per Channel]
}


def steer_defaults(s=None):
    out = dict(STEER_DEFAULTS)
    out.update(s or {})
    return out


def _steer_frac(s, deg):
    """Steering wheel angle -> position along the pot's electrical travel (0..1), unclipped."""
    if s["mount"] == "rack":
        mm = deg / 360 * s["cFactorMM"]
        return 0.5 + mm / s["potMM"]
    return 0.5 + deg * s["gear"] / s["potDeg"]


def steer_span_deg(s):
    """Steering wheel degrees across the pot's whole electrical travel."""
    return 360 * s["potMM"] / s["cFactorMM"] if s["mount"] == "rack" else s["potDeg"] / s["gear"]


def simulate_steering(s=None):
    s = steer_defaults(s)
    span = steer_span_deg(s)
    counts = 2 ** s["adcBits"]
    used = 2 * s["lockDeg"] / span           # fraction of the pot used lock to lock
    lsb_deg = span / counts                  # steering degrees per ADC count
    noise_deg = s["noiseLsb"] * lsb_deg
    lin_deg = s["linPct"] / 100 * span
    sup_deg = 0 if s["ratiometric"] else s["supplyPct"] / 100 * s["lockDeg"]  # worst at full lock
    budget = math.sqrt((lsb_deg / math.sqrt(12)) ** 2 + noise_deg ** 2 + lin_deg ** 2 + sup_deg ** 2 + (s["backlashDeg"] / 2) ** 2)
    clips = used > 1
    # gear that would use 80 % of the pot lock to lock
    if s["mount"] == "rack":
        good = {"potMM": 2 * s["lockDeg"] / 360 * s["cFactorMM"] / 0.8}
    else:
        good = {"gear": 0.8 * s["potDeg"] / (2 * s["lockDeg"])}

    # a slalom then a quick correction, measured by the node
    rnd = mulberry32(11)
    T = 1 / s["rateHz"]
    t, truth, meas = [], [], []
    held = 0.0
    sup = 1.0
    for k in range(int(4 / T)):
        tk = k * T
        a = 0.85 * s["lockDeg"] * math.sin(2 * math.pi * 0.6 * tk) + (0.5 * s["lockDeg"] if 2.6 < tk < 2.9 else 0)
        a = max(-s["lockDeg"] * 1.05, min(s["lockDeg"] * 1.05, a))
        # backlash: the pot only moves once the free play is taken up
        if a - held > s["backlashDeg"] / 2:
            held = a - s["backlashDeg"] / 2
        elif held - a > s["backlashDeg"] / 2:
            held = a + s["backlashDeg"] / 2
        f = _steer_frac(s, held)
        f = f + s["linPct"] / 100 * math.sin(2 * math.pi * f) * 0.9  # S-shaped linearity error
        if not s["ratiometric"]:
            sup = 1 + s["supplyPct"] / 100 * math.sin(2 * math.pi * 1.7 * tk)
            f *= sup
        f = max(0.0, min(1.0, f))
        code = max(0, min(counts - 1, round(f * (counts - 1) + s["noiseLsb"] * _gauss(rnd))))
        frac = code / (counts - 1)
        back = (frac - 0.5) * (360 * s["potMM"] / s["cFactorMM"] if s["mount"] == "rack" else s["potDeg"] / s["gear"])
        t.append(tk)
        truth.append(a)
        meas.append(back)
    err = [m - a for m, a in zip(meas, truth)]
    return {"s": s, "spanDeg": span, "usedPct": used * 100, "lsbDeg": lsb_deg, "noiseDeg": noise_deg, "linDeg": lin_deg,
            "supplyDeg": sup_deg, "budgetDeg": budget, "clips": clips, "good": good,
            "maxErr": max(abs(e) for e in err), "trace": {"t": t, "truth": truth, "meas": meas, "err": err}}
