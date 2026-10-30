"""DAQ aliasing demo: what a channel logs at a given rate, with and without filtering."""
import math

from ._js import js_round


def biquad_lp(fc, fs):
    w0 = 2 * math.pi * fc / fs
    Q = math.sqrt(0.5)
    al = math.sin(w0) / (2 * Q)
    c = math.cos(w0)
    a0 = 1 + al
    return {"b0": (1 - c) / 2 / a0, "b1": (1 - c) / a0, "b2": (1 - c) / 2 / a0, "a1": -2 * c / a0, "a2": (1 - al) / a0}


def alias_demo(rate_hz, filtered, rpm, dur_s=None):
    dur_s = dur_s or 0.5
    fv = rpm / 60 * 2  # 4-cyl second order vibration

    def truth(t):
        return 10 * math.sin(2 * math.pi * 1.5 * t) + 3 * math.sin(2 * math.pi * 14 * t)

    def x(t):
        return truth(t) + 4 * math.sin(2 * math.pi * fv * t + 0.3)

    out = {"truth": [], "logged": []}
    t = 0
    while t <= dur_s:
        out["truth"].append({"x": t * 1000, "y": truth(t)})
        t += 0.001
    if not filtered:
        t = 0
        while t <= dur_s:
            out["logged"].append({"x": t * 1000, "y": x(t)})
            t += 1 / rate_hz
    else:
        # RC (300 Hz) on the input at 40 kHz, ADC at 2 kHz, IIR at class cutoff, decimate
        fsim = 40000
        rc = 1 / (2 * math.pi * 300)
        a = (1 / fsim) / (rc + 1 / fsim)
        fc = 100 if rate_hz >= 500 else 45 if rate_hz >= 200 else rate_hz / 4
        q = biquad_lp(fc, 2000)
        y = x1 = x2 = y1 = y2 = 0
        n = 0
        dec = js_round(2000 / rate_hz)
        warm = 0.3
        i = 0
        while i <= (dur_s + warm) * fsim:
            t = i / fsim - warm
            y += a * (x(t) - y)
            if i % 20 == 0:
                xi = y
                yo = q["b0"] * xi + q["b1"] * x1 + q["b2"] * x2 - q["a1"] * y1 - q["a2"] * y2
                x2, x1, y2, y1 = x1, xi, y1, yo
                if t >= 0:
                    if n % dec == 0:
                        out["logged"].append({"x": t * 1000, "y": yo})
                    n += 1
            i += 1
    se = 0
    for pt in out["logged"]:
        se += math.pow(pt["y"] - truth(pt["x"] / 1000), 2)
    rms = math.sqrt(se / len(out["logged"]))
    alias_hz = abs(fv - js_round(fv / rate_hz) * rate_hz)
    return {"out": out, "rms": rms, "fv": fv, "aliasHz": alias_hz}
