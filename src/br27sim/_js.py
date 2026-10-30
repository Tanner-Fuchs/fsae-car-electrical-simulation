"""Small helpers that reproduce JavaScript number behaviour.

The model was first written in JavaScript (the published iPad page). These keep
the Python port giving the same numbers and the same text, so the browser page
shows identical results whichever engine runs it.
"""
from decimal import ROUND_HALF_UP, Decimal
import math

INF = float("inf")


def js_round(x):
    """Math.round: halves go up (Python's round() goes to the even number)."""
    return math.floor(x + 0.5)


def to_fixed(x, digits=0):
    """Number.prototype.toFixed."""
    if x is None:
        return "null"
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return "NaN" if math.isnan(x) else ("Infinity" if x > 0 else "-Infinity")
    if x == 0:
        x = 0.0  # (-0).toFixed() has no minus sign
    q = Decimal(1).scaleb(-digits)
    return format(Decimal(x).quantize(q, rounding=ROUND_HALF_UP), "f")


def js_str(x):
    """How a number prints inside a JS template string: 6.0 -> '6', 0.5 -> '0.5'."""
    if isinstance(x, bool):
        return "true" if x else "false"
    if isinstance(x, float):
        if math.isinf(x):
            return "Infinity" if x > 0 else "-Infinity"
        if x.is_integer() and abs(x) < 1e21:
            return str(int(x))
        return repr(x)
    return str(x)


def clamp(x, a, b):
    return max(a, min(b, x))


def interp(table, x):
    if x <= table[0][0]:
        return table[0][1]
    for i in range(1, len(table)):
        if x <= table[i][0]:
            x0, y0 = table[i - 1]
            x1, y1 = table[i]
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return table[-1][1]


def soft_min(a, b, n=4):
    return (a * b) / math.pow(math.pow(a, n) + math.pow(b, n), 1 / n)


def mulberry32(seed):
    """Seeded random numbers in [0, 1), bit-for-bit the same as the JS version."""
    state = [seed & 0xFFFFFFFF]
    M = 0xFFFFFFFF

    def rnd():
        s = (state[0] + 0x6D2B79F5) & M
        state[0] = s
        t = ((s ^ (s >> 15)) * (1 | s)) & M
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & M)) & M) ^ t
        return ((t ^ (t >> 14)) & M) / 4294967296

    return rnd


def jmax(xs):
    """Math.max(...xs): -Infinity for an empty list, nulls count as 0."""
    xs = [0 if x is None else x for x in xs]
    return max(xs) if xs else -INF


def jmin(xs):
    xs = [0 if x is None else x for x in xs]
    return min(xs) if xs else INF
