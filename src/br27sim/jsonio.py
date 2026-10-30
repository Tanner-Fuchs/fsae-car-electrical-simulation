"""Turn model results into JSON the way JavaScript's JSON.stringify would."""
import json
import math


def to_jsonable(x):
    """Drop functions, turn Infinity/NaN into null (as JSON.stringify does)."""
    if isinstance(x, dict):
        return {str(k): to_jsonable(v) for k, v in x.items() if not callable(v)}
    if isinstance(x, (list, tuple)):
        return [None if callable(v) else to_jsonable(v) for v in x]
    if isinstance(x, float) and (math.isinf(x) or math.isnan(x)):
        return None
    return x


def dumps(x):
    return json.dumps(to_jsonable(x), ensure_ascii=False, separators=(",", ":"), allow_nan=False)
