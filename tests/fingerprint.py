"""Shared by the golden-value test and tools/make_golden.py."""
import math

import br27sim
from br27sim.jsonio import to_jsonable


def run_cases(cases):
    """Run each case: {"name": [js_function_name, [args...]]}. {"__lap__": params} means "the lap for these params"."""
    out = {}
    for name, (fn, args) in cases.items():
        a = [br27sim.simulate_lap(x["__lap__"]) if isinstance(x, dict) and "__lap__" in x else x for x in args]
        out[name] = to_jsonable(br27sim.JS_API[fn](*a))
    return out


def fingerprint(x):
    """Keeps scalars; long number series become count/sum/min/max/first/last."""
    if isinstance(x, dict):
        return {k: fingerprint(v) for k, v in x.items()}
    if isinstance(x, list):
        nums = [v for v in x if isinstance(v, (int, float)) and not isinstance(v, bool)]
        if len(x) > 12 and len(nums) >= len(x) * 0.5:
            return {"n": len(x), "sum": math.fsum(nums), "min": min(nums), "max": max(nums), "first": x[0], "last": x[-1]}
        if len(x) > 40:
            return {"n": len(x), "first": fingerprint(x[0]), "last": fingerprint(x[-1])}
        return [fingerprint(v) for v in x]
    return x
