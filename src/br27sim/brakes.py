"""Brake pressure: pedal, balance (bias) bar, master cylinders, the two pressure sensors and the brake light.

The driver pushes the pedal; the pedal ratio multiplies the force onto the balance bar, which
splits it between the front and rear master cylinders. The bias knob (a cable adjuster that
screws the bar's pivot sideways) sets the split. Each master cylinder turns its share of the
force into line pressure (force / bore area). A pressure sensor on each circuit
(0 to 1,500 psi, 0.5 to 4.5 V [form: Brake Pressure Sensors]) is read by a corner node and sent
on CAN; the rear node turns the brake light on above a threshold, with hysteresis.

Pedal force from pedal travel is a simple stiffening curve after the free play: a real system
gets most of its pressure in the last part of the travel. Caliper, rotor and pad numbers are typical FSAE
parts until the brake system is chosen.
"""
import math

from .params import with_defaults

PSI_PER_BAR = 14.5038

BRAKE_DEFAULTS = {
    "pedalPct": 60,          # pedal travel now, % of full travel
    "freePct": 10,           # free play before the master cylinders build pressure [assumption]
    "maxPedalN": 1000,       # driver's force at full travel, a hard stop [assumption]
    "pedalRatio": 5.0,       # pedal ratio [assumption, typical FSAE 4-6]
    "mcFrontIn": 0.625,      # front master cylinder bore, 5/8 in [assumption]
    "mcRearIn": 0.700,       # rear master cylinder bore, 0.70 in [assumption]
    "biasTurns": 0.0,        # bias knob turns from centre, + = more front
    "pctPerTurn": 1.5,       # front share change per knob turn [assumption: 10-32 thread on a 3 in bar]
    "turnsMax": 8,
    "sensorMaxPsi": 1500,    # [form: Brake Pressure Sensors, 0-1,500 psi, 0.5-4.5 V]
    "adcBits": 12,
    "lightOnPsi": 3.0 * PSI_PER_BAR,    # brake light on (about 3 bar) [assumption, same as the car model]
    "lightOffPsi": 2.0 * PSI_PER_BAR,   # and off again (about 2 bar), hysteresis against flicker
    "hardPsi": 300,          # hard braking flag [form: Brake Pressure Sensors]
    # what the pressure does at the wheels [assumption: same caliper and rotor front and rear]
    "caliperFrontMM2": 507,   # piston area on one side of each front caliper (one 1 in piston a side) [assumption]
    "caliperRearMM2": 380,    # rear caliper, one 22 mm piston a side [assumption]
    "padMu": 0.45,
    "rotorFrontMM": 85,       # effective radius where the pads grip
    "rotorRearMM": 80,
    "tireMu": 1.5,            # track grip: the VD Tire Model Data #1 lab mu_x ~2.4 scaled by about 2/3 for real asphalt [assumption]
    "cgHeightMM": 275,        # middle CG candidate [form: VD Tire Model Data #1]
    "wheelbaseMM": 1625,      # [Master Timeline Chapter One]
    "frontStaticPct": 45,     # [Master Timeline Chapter One]
}


def brake_defaults(b=None):
    out = dict(BRAKE_DEFAULTS)
    out.update({k: v for k, v in (b or {}).items() if v is not None})
    return out


def _area_in2(bore_in):
    return math.pi / 4 * bore_in * bore_in


def front_share(b):
    """Share of the pushrod force the balance bar sends to the front master cylinder."""
    return max(0.2, min(0.8, 0.5 + b["biasTurns"] * b["pctPerTurn"] / 100))


def pedal_force(b, pct):
    u = (pct - b["freePct"]) / (100 - b["freePct"])
    return 0.0 if u <= 0 else b["maxPedalN"] * min(1.0, u) ** 1.6


def pressures(b, pct):
    """Front and rear line pressure (psi) at this pedal travel."""
    f_lbf = pedal_force(b, pct) * b["pedalRatio"] / 4.44822
    fs = front_share(b)
    return f_lbf * fs / _area_in2(b["mcFrontIn"]), f_lbf * (1 - fs) / _area_in2(b["mcRearIn"])


def sensor(b, psi):
    """Sensor volts and the ADC code the node reads."""
    v = 0.5 + 4.0 * max(0.0, min(psi, b["sensorMaxPsi"])) / b["sensorMaxPsi"]
    code = round(v / 5.0 * (2 ** b["adcBits"] - 1))   # ratiometric 5 V ADC reference [assumption]
    return v, code


def _axle(b, pf, pr, mass, tire_r):
    """Brake force on each axle (N) and the car's deceleration (g) if no wheel locks."""
    bar_f, bar_r = pf / PSI_PER_BAR * 1e5, pr / PSI_PER_BAR * 1e5      # Pa
    # clamp force on each rotor = pressure x piston area on one side; two pad faces; two wheels per axle
    ff = 2 * 2 * bar_f * b["caliperFrontMM2"] * 1e-6 * b["padMu"] * b["rotorFrontMM"] / 1000 / tire_r
    fr = 2 * 2 * bar_r * b["caliperRearMM2"] * 1e-6 * b["padMu"] * b["rotorRearMM"] / 1000 / tire_r
    return ff, fr, (ff + fr) / (mass * 9.81)


def ideal_front(b, g):
    """Front share of braking that uses both axles' grip fully at this deceleration."""
    return b["frontStaticPct"] / 100 + b["cgHeightMM"] / b["wheelbaseMM"] * g


def _locks(b, ff, fr, g, mass):
    """Which axles ask for more grip than they have, with the load moved forward by braking."""
    nf = mass * 9.81 * ideal_front(b, min(g, b["tireMu"]))
    nr = mass * 9.81 - nf
    return ff > b["tireMu"] * nf, fr > b["tireMu"] * max(nr, 1e-6)


def simulate_brakes(p=None, b=None):
    p = with_defaults(p or {})
    b = brake_defaults(b)
    mass, tire_r = p["massKg"], p["tireD"] / 2
    fs = front_share(b)
    pf, pr = pressures(b, b["pedalPct"])
    ff, fr, g = _axle(b, pf, pr, mass, tire_r)
    gg = min(g, b["tireMu"])
    lock_f, lock_r = _locks(b, ff, fr, g, mass)
    share = ff / (ff + fr) if ff + fr > 0 else fs

    # pressure, volts and light along the pedal travel
    sweep = []
    for k in range(0, 101):
        a, c = pressures(b, k)
        f1, r1, g1 = _axle(b, a, c, mass, tire_r)
        lf, lr = _locks(b, f1, r1, g1, mass)
        sweep.append({"pct": k, "front": a, "rear": c, "vF": sensor(b, a)[0], "vR": sensor(b, c)[0],
                      "g": g1, "N": pedal_force(b, k), "lockF": lf, "lockR": lr})
    first = next((s for s in sweep if s["lockF"] or s["lockR"]), None)
    lock_first = None if first is None else ("both" if first["lockF"] and first["lockR"] else "front" if first["lockF"] else "rear")
    # brake light: press slowly to full and release, with hysteresis on the higher of the two sensors
    light, on, t = [], False, 0
    for k in list(range(0, 101, 2)) + list(range(100, -1, -2)):
        a, c = pressures(b, k)
        hi = max(a, c)
        if not on and hi >= b["lightOnPsi"]:
            on = True
        elif on and hi <= b["lightOffPsi"]:
            on = False
        light.append({"step": t, "pct": k, "psi": hi, "on": on})
        t += 1
    on_pct = next((s["pct"] for s in sweep if max(s["front"], s["rear"]) >= b["lightOnPsi"]), None)
    # bias knob: front share and where each axle locks first
    by_turn = []
    for k in range(-b["turnsMax"] * 2, b["turnsMax"] * 2 + 1):
        q = dict(b)
        q["biasTurns"] = k / 2
        a, c = pressures(q, 100)
        f1, r1, g1 = _axle(q, a, c, mass, tire_r)
        by_turn.append({"turns": k / 2, "frontPct": front_share(q) * 100, "brakeFrontPct": f1 / (f1 + r1) * 100 if f1 + r1 else 50})
    # best knob setting: brake share equal to the ideal share at the grip limit
    ideal_lim = ideal_front(b, b["tireMu"]) * 100
    best = min(by_turn, key=lambda r: abs(r["brakeFrontPct"] - ideal_lim))
    v_f, code_f = sensor(b, pf)
    v_r, code_r = sensor(b, pr)
    return {
        "b": b, "frontShare": fs, "pedalN": pedal_force(b, b["pedalPct"]), "pushN": pedal_force(b, b["pedalPct"]) * b["pedalRatio"],
        "frontPsi": pf, "rearPsi": pr, "vFront": v_f, "vRear": v_r, "codeFront": code_f, "codeRear": code_r,
        "lightOn": max(pf, pr) >= b["lightOnPsi"], "hard": max(pf, pr) >= b["hardPsi"],
        "clipFront": pf > b["sensorMaxPsi"], "clipRear": pr > b["sensorMaxPsi"],
        "decelG": g, "brakeFrontPct": share * 100, "idealFrontPct": ideal_front(b, gg) * 100, "idealLimPct": ideal_lim,
        "lockFront": lock_f, "lockRear": lock_r, "bestTurns": best["turns"],
        "lockPedalPct": first["pct"] if first else None, "lockFirst": lock_first, "lockG": first["g"] if first else None,
        "lightOnPedalPct": on_pct, "sweep": sweep, "light": light, "byTurn": by_turn,
        "psiPerCount": b["sensorMaxPsi"] / 4.0 * 5.0 / (2 ** b["adcBits"] - 1),
    }
