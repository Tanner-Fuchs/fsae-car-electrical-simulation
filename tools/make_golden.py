"""Writes tests/golden.json: a compact fingerprint of every model output.

tests/test_golden.py checks the model still gives these numbers, so an edit that
changes results by accident shows up. When you change the model on purpose:

    python tools/make_golden.py            # accept the Python model's new numbers
    python tools/make_golden.py --js sim.js  # or take them from the JavaScript page model (needs Node.js)
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))
from fingerprint import fingerprint, run_cases  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--js", help="path to the JavaScript sim.js to take the numbers from")
    a = ap.parse_args()
    cases = json.loads((ROOT / "tests" / "cases.json").read_text())
    if a.js:
        raw = json.loads(subprocess.check_output(["node", str(HERE / "snapshot.js"), a.js]))
    else:
        raw = run_cases(cases)
    out = {k: fingerprint(raw[k]) for k in cases}
    (ROOT / "tests" / "golden.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote tests/golden.json ({len(out)} cases) from {'JavaScript ' + a.js if a.js else 'the Python model'}")


if __name__ == "__main__":
    main()
