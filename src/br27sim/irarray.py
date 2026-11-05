"""IR array tire temperature sensor, ray-traced onto the tire.

A thermopile array (MLX90640 / MLX90621 class) looks across the tread and gives a row
of temperatures from the inner to the outer edge. This model places the sensor around
the tire with x / y / z offsets and roll / pitch / yaw, casts rays through every pixel,
and averages what each pixel sees: tread (with a temperature profile across it),
sidewall, the track or the air behind.

Axes (tire frame, origin at the wheel centre, metres):
  x  forward (the sensor sits ahead of the tire and looks back at the tread)
  y  outward, away from the car (negative y is the inner edge)
  z  up
Sensor pose: roll turns it about its own look axis (tilts the pixel row), pitch tilts the
view up (+) or down, yaw swings the view toward the outer (+) or inner edge.
With the sensor on the chassis, the front tire turns under it when it steers; on the
upright the sensor turns with the tire.

Simplifications: pixel readings are a straight average of the temperatures each pixel
sees (no T^4 weighting), the tire is a plain cylinder (no tread crown or bulge), the
steering axis is vertical through the wheel centre, and only the pixel row through the
middle of the array is used.
"""
import math

from .params import with_defaults

IR_ARRAY_PRESETS = {
    "mlx90640_55": {"kind": "array", "label": "MLX90640 32×24, 55° × 35°", "pixels": 32, "hFovDeg": 55, "vFovDeg": 35 / 24,
                    "note": "Melexis MLX90640 BAB: 32 × 24 pixels; this uses the middle row [datasheet class]"},
    "mlx90640_110": {"kind": "array", "label": "MLX90640 32×24, 110° × 75°", "pixels": 32, "hFovDeg": 110, "vFovDeg": 75 / 24,
                     "note": "Melexis MLX90640 BAA wide-angle version; middle row [datasheet class]"},
    "mlx90621_60": {"kind": "array", "label": "MLX90621 16×4, 60° × 16°", "pixels": 16, "hFovDeg": 60, "vFovDeg": 4,
                    "note": "Melexis MLX90621 BAD: 16 × 4 pixels, the classic tire-temperature array [datasheet class]"},
    "single_5": {"label": "MLX90614, 5°", "kind": "single", "pixels": 1, "hFovDeg": 5, "vFovDeg": 5,
                 "note": "Melexis MLX90614 narrow (5°) version: one spot, one number [datasheet class]"},
    "single_10": {"label": "MLX90614, 10°", "kind": "single", "pixels": 1, "hFovDeg": 10, "vFovDeg": 10,
                  "note": "Melexis MLX90614 10° version: one spot, one number [datasheet class]"},
    "single_35": {"label": "MLX90614, 35°", "kind": "single", "pixels": 1, "hFovDeg": 35, "vFovDeg": 35,
                  "note": "Melexis MLX90614 35° version: one spot, one average across what it sees [datasheet class]"},
    "single_90": {"label": "MLX90614, 90°", "kind": "single", "pixels": 1, "hFovDeg": 90, "vFovDeg": 90,
                  "note": "Melexis MLX90614 standard 90° version: very wide spot [datasheet class]"},
    "custom": {"kind": "array", "label": "Custom", "pixels": 16, "hFovDeg": 60, "vFovDeg": 4, "note": "Set pixels and field of view below"},
}

IR_ARRAY_PROFILES = {
    "camber": "Inner edge hotter (negative camber)",
    "center": "Centre hotter (pressure too high)",
    "edges": "Edges hotter (pressure too low)",
    "even": "Even across the tread",
}

# Where the sensor sits. Each one sets a base position and look direction; the distance,
# the x / y / z shifts and roll / pitch / yaw are then adjustments around it.
IR_POSITIONS = {
    "front": "In front of the tire, looking back at the tread",
    "above": "Above the tire, looking down at the tread",
    "beside": "On the chassis beside the tire (inboard, ahead), looking out and back at the tread",
}
BESIDE_DEG = 45   # the beside mount looks 45° outward from straight back [assumption]

IR_ARRAY_DEFAULTS = {
    "kind": "array",      # single | array
    "preset": "mlx90640_55",
    "position": "front",
    "pixels": 32, "hFovDeg": 55, "vFovDeg": 35 / 24,
    "widthMM": 178,       # tread width, 7 in [Tanner 2026-11-04]
    "profile": "camber",
    "tempC": 70, "gradC": 12, "bgC": 35,
    "distMM": 180,        # tread to sensor along the mount's look line [assumption]
    "xMM": 0,             # shift forward
    "yMM": 0,             # shift sideways, + outward
    "zMM": 0,             # shift up
    "rollDeg": 0, "pitchDeg": 0, "yawDeg": 0,
    "steerDeg": 0, "mount": "chassis",
}

RIM_R = 0.127   # 10 in wheel
SUB = 5         # rays per pixel side
DOFS = [
    ("distMM", "Distance", "mm", [100, 140, 180, 220, 260], 40, 320),
    ("xMM", "X shift", "mm", [-40, -20, 0, 20, 40], -60, 60),
    ("yMM", "Y shift", "mm", [-40, -20, 0, 20, 40], -60, 60),
    ("zMM", "Z shift", "mm", [-40, -20, 0, 20, 40], -60, 60),
    ("rollDeg", "Roll", "°", [-30, -15, 0, 15, 30], -45, 45),
    ("pitchDeg", "Pitch", "°", [-30, -15, 0, 15, 30], -45, 45),
    ("yawDeg", "Yaw", "°", [-20, -10, 0, 10, 20], -45, 45),
    ("steerDeg", "Front wheel steer", "°", [-25, -12, 0, 12, 25], -30, 30),
]


def _opts(o):
    out = dict(IR_ARRAY_DEFAULTS)
    out.update({k: v for k, v in (o or {}).items() if v is not None})
    pre = IR_ARRAY_PRESETS.get(out["preset"])
    if pre and pre["kind"] != out["kind"]:
        out["preset"] = "single_35" if out["kind"] == "single" else "mlx90640_55"
        pre = IR_ARRAY_PRESETS[out["preset"]]
    if out.get("position") not in IR_POSITIONS:
        out["position"] = "front"
    if pre and out["preset"] != "custom":
        out.update(pixels=pre["pixels"], hFovDeg=pre["hFovDeg"], vFovDeg=pre["vFovDeg"])
    out["pixels"] = max(1, min(64, int(out["pixels"])))
    return out


def tread_temp(o, y):
    """True tread temperature at y (metres, + outward) across the tread."""
    w = o["widthMM"] / 2000
    u = max(-1.0, min(1.0, y / w))
    t, g = o["tempC"], o["gradC"]
    p = o["profile"]
    if p == "camber":
        return t - g / 2 * u
    if p == "center":
        return t + g / 2 - g * u * u
    if p == "edges":
        return t - g / 2 + g * u * u
    return t


def _rot(o):
    """Sensor-to-tire rotation matrix (columns: look, across, up) and the sensor position, tire frame."""
    r, p, yw = (math.radians(o[k]) for k in ("rollDeg", "pitchDeg", "yawDeg"))
    yw = -yw   # + yaw aims outward (+y)
    cr, sr, cp, spp, cy, sy = math.cos(r), math.sin(r), math.cos(p), math.sin(p), math.cos(yw), math.sin(yw)
    rx = [[1, 0, 0], [0, cr, -sr], [0, sr, cr]]
    ry = [[cp, 0, spp], [0, 1, 0], [-spp, 0, cp]]
    rz = [[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]]
    m = _mm(rz, _mm(ry, rx))
    return m


def _base(position, R):
    """Base rotation, base look direction and the tread point it aims at, for a mount position."""
    if position == "above":
        a = math.radians(-90)                      # pitch down: look straight down at the top of the tread
        c, s = math.cos(a), math.sin(a)
        return [[c, 0, s], [0, 1, 0], [-s, 0, c]], [0.0, 0.0, -1.0], [0.0, 0.0, R]
    if position == "beside":
        a = math.radians(-BESIDE_DEG)              # yaw outward, sitting inboard and ahead
        c, s = math.cos(a), math.sin(a)
        look = [-c, -s, 0.0]
        return [[c, -s, 0], [s, c, 0], [0, 0, 1]], look, [R, 0.0, 0.0]
    return [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [-1.0, 0.0, 0.0], [R, 0.0, 0.0]


def _mm(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def _mv(m, v):
    return [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
            m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
            m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]]


def _rz(a):
    c, s = math.cos(a), math.sin(a)
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]]


def _trace(p, d, R, w):
    """Nearest thing the ray hits: ('tread', y, point) / ('side', y, point) / ('track'|'air', None, point)."""
    best = (math.inf, "air", None)
    a = d[0] * d[0] + d[2] * d[2]
    if a > 1e-12:
        b = 2 * (p[0] * d[0] + p[2] * d[2])
        c = p[0] * p[0] + p[2] * p[2] - R * R
        disc = b * b - 4 * a * c
        if disc >= 0:
            t = (-b - math.sqrt(disc)) / (2 * a)
            if t > 1e-9 and abs(p[1] + t * d[1]) <= w and t < best[0]:
                best = (t, "tread", p[1] + t * d[1])
    if abs(d[1]) > 1e-12:
        for side in (w, -w):
            t = (side - p[1]) / d[1]
            if 1e-9 < t < best[0]:
                x, z = p[0] + t * d[0], p[2] + t * d[2]
                rr = x * x + z * z
                if rr <= R * R:
                    best = (t, "side" if rr >= RIM_R * RIM_R else "wheel", side)
    if d[2] < -1e-12:
        t = (-R - p[2]) / d[2]
        if 1e-9 < t < best[0]:
            best = (t, "track", None)
    t, kind, y = best
    pt = None if t == math.inf else [p[0] + t * d[0], p[1] + t * d[1], p[2] + t * d[2]]
    return kind, y, pt


def _read(o, sub=SUB, rays=False):
    R = with_defaults()["tireD"] / 2
    w = o["widthMM"] / 2000
    st = math.radians(o["steerDeg"])
    base, look0, aim = _base(o["position"], R)
    m = _mm(base, _rot(o))
    d0 = o["distMM"] / 1000
    pos = [aim[k] - look0[k] * d0 + [o["xMM"], o["yMM"], o["zMM"]][k] / 1000 for k in range(3)]
    to_tire = _rz(-st) if o["mount"] == "chassis" else _rz(0)
    # chassis mount: the tire turned under a fixed sensor; work in the tire's own frame
    p_t = _mv(to_tire, pos)
    n, H, V = o["pixels"], math.radians(o["hFovDeg"]), math.radians(o["vFovDeg"])
    side_t = (o["tempC"] + o["bgC"]) / 2   # sidewall, cooler than the tread [assumption]
    pixels, tread_y = [], []
    to_out = _rz(st)  # tire frame -> chassis frame for drawing (tire drawn turned by the steer)
    for i in range(n):
        a0 = -H / 2 + i * H / n
        tot, on, ys = 0.0, 0, []
        centre = None
        for si in range(sub):
            a = a0 + (si + 0.5) * H / n / sub
            for sj in range(sub):
                b = -V / 2 + (sj + 0.5) * V / sub
                d = _mv(to_tire, _mv(m, [-1.0, math.tan(a), math.tan(b)]))
                kind, y, pt = _trace(p_t, d, R, w)
                if kind == "tread":
                    tot += tread_temp(o, y); on += 1; ys.append(y)
                elif kind == "side":
                    tot += side_t
                else:
                    tot += o["bgC"]
        # centre ray of the pixel, for the drawings
        ac = a0 + H / n / 2
        d = _mv(to_tire, _mv(m, [-1.0, math.tan(ac), 0.0]))
        kind, y, pt = _trace(p_t, d, R, w)
        n_r = sub * sub
        px = {"i": i, "angleDeg": math.degrees(ac), "meas": tot / n_r, "treadFrac": on / n_r,
              "yMM": (sum(ys) / len(ys) * 1000) if ys else None, "hit": kind}
        tread_y += ys
        if rays:
            end = pt if pt is not None else [p_t[k] + 0.35 * d[k] / math.sqrt(sum(c * c for c in d)) for k in range(3)]
            px["end"] = _mv(to_out, end)
            px["sMM"] = (math.atan2(pt[2], pt[0]) * R * 1000) if kind == "tread" else None
        pixels.append(px)
    full = [p for p in pixels if p["treadFrac"] >= 0.9]
    cover = (max(tread_y) - min(tread_y)) / (2 * w) if tread_y else 0.0
    true_io = tread_temp(o, -w) - tread_temp(o, w)
    est_io = (full[0]["meas"] - full[-1]["meas"]) if len(full) >= 2 else None
    # the array reads the pixel nearest each edge, not the edge itself: compare like with like
    exp_io = (tread_temp(o, full[0]["yMM"] / 1000) - tread_temp(o, full[-1]["yMM"] / 1000)) if len(full) >= 2 else None
    out = {"pixels": pixels, "coverPct": cover * 100, "onTread": len(full),
           "mixed": sum(1 for p in pixels if 0.1 < p["treadFrac"] < 0.9),
           "trueIO": true_io, "estIO": est_io, "edgeIO": exp_io,
           "mmPerPx": (abs(full[-1]["yMM"] - full[0]["yMM"]) / (len(full) - 1)) if len(full) >= 2 else None,
           "seenFromMM": min(tread_y) * 1000 if tread_y else None, "seenToMM": max(tread_y) * 1000 if tread_y else None}
    if rays:
        out["sensor"] = _mv(to_out, p_t)
        out["axes"] = [_mv(to_out, _mv(to_tire, _mv(m, v))) for v in ([-1, 0, 0], [0, 1, 0], [0, 0, 1])]
    return out


def simulate_ir_array(o=None):
    o = _opts(o)
    R = with_defaults()["tireD"] / 2
    w = o["widthMM"] / 2000
    r = _read(o, rays=True)
    truth = [{"yMM": (-w + 2 * w * k / 40) * 1000, "T": tread_temp(o, -w + 2 * w * k / 40)} for k in range(41)]
    h = math.radians(o["hFovDeg"]) / 2
    need = (w / math.tan(h) * 1000) if o["pixels"] > 1 else None
    spot = 2 * o["distMM"] * math.tan(h)    # spot (or row) width at the tread, straight on
    sweeps = {}
    for key, label, unit, vals, lo, hi in DOFS:
        prof = []
        for v in vals:
            q = dict(o); q[key] = v
            rr = _read(q, sub=3)
            prof.append({"v": v, "meas": [p["meas"] for p in rr["pixels"]], "coverPct": rr["coverPct"], "onTread": rr["onTread"]})
        line = []
        for k in range(13):
            v = lo + (hi - lo) * k / 12
            q = dict(o); q[key] = v
            rr = _read(q, sub=3)
            err = abs(rr["estIO"] - rr["edgeIO"]) if rr["estIO"] is not None else None
            line.append({"v": v, "coverPct": rr["coverPct"], "onTread": rr["onTread"], "ioErr": err,
                         "onTreadPct": rr["pixels"][0]["treadFrac"] * 100 if o["pixels"] == 1 else None})
        sweeps[key] = {"label": label, "unit": unit, "now": o[key], "profiles": prof, "line": line}
    ref = _read(dict(o, steerDeg=0))
    zones = zone_averages(o, r, ref)
    zsweep = []
    for deg in range(-25, 26, 2):
        rr = _read(dict(o, steerDeg=deg), sub=3)
        z = zone_averages(o, rr, ref)
        zsweep.append({"deg": deg, "fixed": z["fixed"], "steer": z["steer"]})
    return {"o": o, "preset": IR_ARRAY_PRESETS.get(o["preset"], IR_ARRAY_PRESETS["custom"]),
            "zones": zones, "zoneTrue": zone_truth(o), "zoneSweep": zsweep,
            "tireR": R, "rimR": RIM_R, "halfW": w, "truth": truth, "needXMM": need, "spotMM": spot,
            "trueAvg": sum(p["T"] for p in truth) / len(truth), **r, "sweeps": sweeps}


def ir_array_frames(o=None):
    """The pixel row at each whole steer angle from -30 to +30 deg, for the steering sweep animation."""
    o = _opts(o)
    out = []
    ref = _read(dict(o, steerDeg=0))
    for deg in range(-30, 31):
        q = dict(o); q["steerDeg"] = deg
        r = _read(q, rays=True)
        r["deg"] = deg
        r["zones"] = zone_averages(o, r, ref)
        out.append(r)
    return out


ZONES = ("inner", "centre", "outer")


def _zone(y, w):
    """Which third of the tread y (metres, + outward) is in: 0 inner, 1 centre, 2 outer."""
    return 0 if y < -w / 3 else (1 if y <= w / 3 else 2)


def zone_truth(o):
    """True average tread temperature over each third of the tread."""
    w = o["widthMM"] / 2000
    out = []
    for z in range(3):
        ys = [-w + 2 * w * (z + (k + 0.5) / 20) / 3 for k in range(20)]
        out.append(sum(tread_temp(o, y) for y in ys) / len(ys))
    return out


def _avg(r, zmap):
    tot, n = [0.0, 0.0, 0.0], [0, 0, 0]
    for p, z in zip(r["pixels"], zmap):
        if z is not None:
            tot[z] += p["meas"]; n[z] += 1
    return [tot[k] / n[k] if n[k] else None for k in range(3)], n


def zone_map(r, w):
    """Pixel -> zone, from where each clean pixel lands on the tread (None = not on the tread)."""
    return [_zone(p["yMM"] / 1000, w) if p["treadFrac"] >= 0.9 and p["yMM"] is not None else None for p in r["pixels"]]


def zone_averages(o, r, ref):
    """Inner / centre / outer averages two ways.

    fixed: the pixel-to-zone map is set once with the wheel straight (ref) and used at every steer
    angle, which is what a logger does if it ignores steering.
    steer: the map is looked up for the current steering angle (from the steering sensor), so each
    pixel is binned by where it lands on the tread now; pixels that left the tread are dropped.
    """
    w = o["widthMM"] / 2000
    fmap, smap = zone_map(ref, w), zone_map(r, w)
    fixed, fn = _avg(r, fmap)
    steer, sn = _avg(r, smap)
    return {"fixed": fixed, "fixedN": fn, "steer": steer, "steerN": sn, "fixedMap": fmap, "steerMap": smap}
