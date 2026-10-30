"""The model still gives the numbers in tests/golden.json.

golden.json was first generated from the JavaScript model behind the published
page, so passing means the Python port matches it. If you change the model on
purpose, run `python tools/make_golden.py` to accept the new numbers, and say
why in the commit message.
"""
import json
import math
from pathlib import Path

import pytest

from fingerprint import fingerprint, run_cases

HERE = Path(__file__).resolve().parent
CASES = json.loads((HERE / "cases.json").read_text())
GOLDEN = json.loads((HERE / "golden.json").read_text(encoding="utf-8"))


def compare(want, got, path, errs):
    if isinstance(want, bool) or isinstance(got, bool):
        if want != got:
            errs.append(f"{path}: expected {want!r}, got {got!r}")
    elif isinstance(want, (int, float)) and isinstance(got, (int, float)):
        if not math.isclose(want, got, rel_tol=1e-9, abs_tol=1e-9):
            errs.append(f"{path}: expected {want!r}, got {got!r}")
    elif isinstance(want, dict) and isinstance(got, dict):
        for k in sorted(want.keys() | got.keys()):
            if k not in got or k not in want:
                errs.append(f"{path}.{k}: only in {'golden' if k in want else 'model'}")
            else:
                compare(want[k], got[k], f"{path}.{k}", errs)
    elif isinstance(want, list) and isinstance(got, list) and len(want) == len(got):
        for i, (a, b) in enumerate(zip(want, got)):
            compare(a, b, f"{path}[{i}]", errs)
    elif want != got:
        errs.append(f"{path}: expected {want!r}, got {got!r}")


@pytest.mark.parametrize("name", list(CASES))
def test_matches_golden(name):
    got = fingerprint(run_cases({name: CASES[name]})[name])
    errs = []
    compare(GOLDEN[name], got, name, errs)
    assert not errs, "\n".join(errs[:20])
