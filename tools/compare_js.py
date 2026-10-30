"""Checks the Python model against the JavaScript model it was ported from.

Needs Node.js and a copy of the JS model:
    python tools/compare_js.py path/to/sim.js
Every case in tests/cases.json is run in both and compared value by value.
"""
import json
import math
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "src"))
import br27sim  # noqa: E402
from br27sim.jsonio import to_jsonable  # noqa: E402


def run_py(cases):
    out = {}
    for name, (fn, args) in cases.items():
        a = [br27sim.simulate_lap(x["__lap__"]) if isinstance(x, dict) and "__lap__" in x else x for x in args]
        out[name] = to_jsonable(br27sim.JS_API[fn](*a))
    return out


def diff(a, b, path, errs, rel=1e-9):
    if len(errs) > 30:
        return
    if isinstance(a, bool) or isinstance(b, bool):
        if a != b:
            errs.append(f"{path}: js={a!r} py={b!r}")
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if not math.isclose(a, b, rel_tol=rel, abs_tol=1e-9):
            errs.append(f"{path}: js={a!r} py={b!r}")
    elif isinstance(a, dict) and isinstance(b, dict):
        if set(a) != set(b):
            errs.append(f"{path}: keys js-only={sorted(set(a) - set(b))} py-only={sorted(set(b) - set(a))}")
        for k in a.keys() & b.keys():
            diff(a[k], b[k], f"{path}.{k}", errs, rel)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            errs.append(f"{path}: length js={len(a)} py={len(b)}")
        for i, (x, y) in enumerate(zip(a, b)):
            diff(x, y, f"{path}[{i}]", errs, rel)
    elif a != b:
        errs.append(f"{path}: js={a!r} py={b!r}")


def main():
    sim_js = sys.argv[1]
    cases = json.loads((HERE.parent / "tests" / "cases.json").read_text())
    js = json.loads(subprocess.check_output(["node", str(HERE / "snapshot.js"), sim_js]))
    py = run_py(cases)
    bad = 0
    for name in cases:
        errs = []
        diff(js[name], py[name], name, errs)
        if errs:
            bad += 1
            print(f"FAIL {name}")
            for e in errs[:12]:
                print("   ", e)
        else:
            print(f"ok   {name}")
    print(f"\n{len(cases) - bad}/{len(cases)} cases match")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
