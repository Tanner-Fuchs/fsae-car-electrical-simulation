"""CAD import: STL files of the frame and main components.

Export STLs from the car assembly (keep the assembly origin, so every part lands
where it sits on the car) and import them on the Car tab. The simulator then
draws them in the 3D view and uses each part's position for the harness and CAN
route lengths, which feed the CAN physical layer model.

Files and settings live in a folder outside the app, so updates never touch them:
  Windows: %LOCALAPPDATA%\\BR27Sim\\cad      Mac/Linux: ~/.br27sim/cad
  (set BR27SIM_DATA to use another folder, e.g. a shared team drive)

Simulator axes, metres: +x forward, +y up, +z to the driver's right.
"""
import json
import math
import os
import re
import struct
from pathlib import Path

UNITS = {"mm": 0.001, "cm": 0.01, "m": 1.0, "in": 0.0254}
# role "frame" = the chassis; "other" = shown only; anything else is a part id from the 3D car
DEFAULT_SETTINGS = {"units": "mm", "up": "z", "forward": "+x", "offset": [0.0, 0.0, 0.0], "hidePlaceholder": False}
SAFE_NAME = re.compile(r"[^A-Za-z0-9._ -]+")


def data_dir():
    if os.environ.get("BR27SIM_DATA"):
        base = Path(os.environ["BR27SIM_DATA"])
    elif os.name == "nt" and os.environ.get("LOCALAPPDATA"):
        base = Path(os.environ["LOCALAPPDATA"]) / "BR27Sim"
    else:
        base = Path.home() / ".br27sim"
    d = base / "cad"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _manifest_path():
    return data_dir() / "cad.json"


def load_manifest():
    p = _manifest_path()
    m = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    m.setdefault("settings", {})
    m["settings"] = {**DEFAULT_SETTINGS, **m["settings"]}
    m.setdefault("files", [])       # [{"name": "frame.stl", "role": "frame"}]
    m.setdefault("positions", {})   # part id -> [x, y, z] in simulator metres
    return m


def save_manifest(m):
    _manifest_path().write_text(json.dumps(m, indent=1), encoding="utf-8")


# ---------------------------------------------------------------- STL


def parse_stl(data):
    """Triangles of an STL file (binary or ASCII) as a flat list of floats, 9 per triangle."""
    if len(data) >= 84:
        n = struct.unpack_from("<I", data, 80)[0]
        if 84 + 50 * n == len(data):
            out = []
            for i in range(n):
                out.extend(struct.unpack_from("<9f", data, 84 + 50 * i + 12))
            return out
    text = data.decode("latin-1")
    nums = re.findall(r"vertex\s+(\S+)\s+(\S+)\s+(\S+)", text)
    if not nums or len(nums) % 3:
        raise ValueError("not a readable STL file (binary or ASCII)")
    return [float(v) for xyz in nums for v in xyz]


def stl_stats(tris):
    """Bounding box, centre and enclosed volume, in the file's own units."""
    xs, ys, zs = tris[0::3], tris[1::3], tris[2::3]
    lo, hi = [min(xs), min(ys), min(zs)], [max(xs), max(ys), max(zs)]
    vol = 0.0
    for i in range(0, len(tris), 9):
        ax, ay, az, bx, by, bz, cx, cy, cz = tris[i:i + 9]
        vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
    return {"triangles": len(tris) // 9, "min": lo, "max": hi, "volume": abs(vol)}


# ---------------------------------------------------------------- transform


def matrix(settings):
    """4x4 row-major matrix from CAD coordinates to simulator metres."""
    s = UNITS.get(settings.get("units"), 0.001)
    # up axis: CAD z-up turns into simulator y-up
    up = [[1, 0, 0], [0, 0, 1], [0, -1, 0]] if settings.get("up") == "z" else [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    # which CAD direction (after the up fix) points to the front of the car
    a = {"+x": 0, "-z": 90, "-x": 180, "+z": 270}.get(settings.get("forward"), 0)
    c, sn = round(math.cos(math.radians(a))), round(math.sin(math.radians(a)))
    yaw = [[c, 0, -sn], [0, 1, 0], [sn, 0, c]]
    r = [[sum(yaw[i][k] * up[k][j] for k in range(3)) * s for j in range(3)] for i in range(3)]
    o = settings.get("offset") or [0, 0, 0]
    return [r[0] + [o[0]], r[1] + [o[1]], r[2] + [o[2]], [0, 0, 0, 1]]


def apply(m, p):
    return [m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3] for i in range(3)]


def sim_box(m, lo, hi):
    """Axis-aligned box in simulator metres around the transformed CAD box."""
    corners = [apply(m, [x, y, z]) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    blo = [min(c[i] for c in corners) for i in range(3)]
    bhi = [max(c[i] for c in corners) for i in range(3)]
    return blo, bhi


# ---------------------------------------------------------------- library


_stats_cache = {}


def file_stats(name):
    p = data_dir() / name
    key = (name, p.stat().st_mtime_ns, p.stat().st_size)
    if key not in _stats_cache:
        _stats_cache[key] = stl_stats(parse_stl(p.read_bytes()))
    return _stats_cache[key]


def summary():
    """Everything the page needs: settings, the matrix, each file with its box, and part positions."""
    m = load_manifest()
    mat = matrix(m["settings"])
    s = UNITS.get(m["settings"]["units"], 0.001)
    files, positions = [], {}
    for f in m["files"]:
        if not (data_dir() / f["name"]).exists():
            continue
        st = file_stats(f["name"])
        lo, hi = sim_box(mat, st["min"], st["max"])
        center = [(a + b) / 2 for a, b in zip(lo, hi)]
        files.append({**f, "triangles": st["triangles"], "min": lo, "max": hi, "center": center,
                      "size": [b - a for a, b in zip(lo, hi)], "volumeL": st["volume"] * s ** 3 * 1000})
        if f["role"] not in ("frame", "other"):
            positions[f["role"]] = center
    positions.update(m["positions"])  # placed by hand wins over the STL centre
    return {"dir": str(data_dir()), "settings": m["settings"], "matrix": mat, "files": files, "positions": positions,
            "placed": list(m["positions"])}


def add_file(name, data, role="other"):
    name = SAFE_NAME.sub("_", Path(name).name) or "part.stl"
    if not name.lower().endswith(".stl"):
        name += ".stl"
    stl_stats(parse_stl(data))  # refuse anything that is not an STL
    (data_dir() / name).write_bytes(data)
    m = load_manifest()
    m["files"] = [f for f in m["files"] if f["name"] != name] + [{"name": name, "role": role}]
    save_manifest(m)
    return name


def update(change):
    """Apply one change from the page: settings, a file's role, removing a file, or a part position."""
    m = load_manifest()
    if "settings" in change:
        m["settings"].update({k: v for k, v in change["settings"].items() if k in DEFAULT_SETTINGS})
    if "role" in change:
        for f in m["files"]:
            if f["name"] == change["file"]:
                f["role"] = change["role"]
    if "remove" in change:
        m["files"] = [f for f in m["files"] if f["name"] != change["remove"]]
        p = data_dir() / SAFE_NAME.sub("_", Path(change["remove"]).name)
        if p.exists():
            p.unlink()
    if "position" in change:
        part, xyz = change["position"]["part"], change["position"].get("xyz")
        if xyz is None:
            m["positions"].pop(part, None)
        else:
            m["positions"][part] = [float(v) for v in xyz]
    if change.get("centerFrame"):
        # put the frame's centre on the car's centreline, between the axles, with its bottom 50 mm off the ground
        frame = next((f for f in m["files"] if f["role"] == "frame"), None)
        if frame:
            st = file_stats(frame["name"])
            m["settings"]["offset"] = [0.0, 0.0, 0.0]
            lo, hi = sim_box(matrix(m["settings"]), st["min"], st["max"])
            m["settings"]["offset"] = [-(lo[0] + hi[0]) / 2, 0.05 - lo[1], -(lo[2] + hi[2]) / 2]
    save_manifest(m)
    return summary()
