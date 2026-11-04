from br27sim import JS_API
from br27sim.brakes import BRAKE_DEFAULTS, PSI_PER_BAR, pressures, sensor, simulate_brakes, brake_defaults


def test_no_pressure_in_free_play():
    b = brake_defaults()
    assert pressures(b, b["freePct"]) == (0.0, 0.0)
    r = simulate_brakes(None, {"pedalPct": 5})
    assert not r["lightOn"] and r["frontPsi"] == 0


def test_pressure_rises_with_travel():
    r = simulate_brakes()
    front = [s["front"] for s in r["sweep"]]
    assert all(b >= a for a, b in zip(front, front[1:]))
    assert front[-1] > 1000


def test_bias_knob_moves_share_forward():
    lo = simulate_brakes(None, {"biasTurns": -4})["brakeFrontPct"]
    mid = simulate_brakes()["brakeFrontPct"]
    hi = simulate_brakes(None, {"biasTurns": 4})["brakeFrontPct"]
    assert lo < mid < hi


def test_total_push_conserved_by_bar():
    b = brake_defaults({"biasTurns": 3})
    import math
    f, r = pressures(b, 70)
    a = lambda d: math.pi / 4 * d * d
    total_lbf = f * a(b["mcFrontIn"]) + r * a(b["mcRearIn"])
    from br27sim.brakes import pedal_force
    assert abs(total_lbf - pedal_force(b, 70) * b["pedalRatio"] / 4.44822) < 1e-6


def test_sensor_scale():
    b = brake_defaults()
    assert sensor(b, 0)[0] == 0.5
    assert abs(sensor(b, b["sensorMaxPsi"])[0] - 4.5) < 1e-9
    assert sensor(b, 5000)[0] == 4.5       # clipped


def test_light_hysteresis():
    r = simulate_brakes()
    L = r["light"]
    assert L[0]["on"] is False and L[-1]["on"] is False
    # on going down at lightOnPsi, off coming up only below lightOffPsi
    first_on = next(x for x in L if x["on"])
    assert first_on["psi"] >= r["b"]["lightOnPsi"]
    half = len(L) // 2
    still_on = [x for x in L[half:] if x["on"]]
    assert min(x["psi"] for x in still_on) > r["b"]["lightOffPsi"]
    assert r["lightOnPedalPct"] is not None and r["lightOnPedalPct"] < 30


def test_realistic_decel_and_lockup():
    r = simulate_brakes(None, {"pedalPct": 60})
    assert 0.6 < r["decelG"] < 1.5
    assert r["lockPedalPct"] is not None and 50 < r["lockPedalPct"] < 95
    # too much rear bias locks the rears first
    assert simulate_brakes(None, {"biasTurns": -8})["lockFirst"] == "rear"
    assert simulate_brakes(None, {"biasTurns": 8})["lockFirst"] == "front"


def test_best_knob_inside_range():
    r = simulate_brakes()
    assert -r["b"]["turnsMax"] < r["bestTurns"] < r["b"]["turnsMax"]


def test_api_and_defaults():
    assert "simulateBrakes" in JS_API
    assert abs(BRAKE_DEFAULTS["lightOnPsi"] - 3 * PSI_PER_BAR) < 1e-9
