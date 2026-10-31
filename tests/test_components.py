import math

from br27sim import simulate_lap
from br27sim.components import min_speed_kmh, resolution_kmh, simulate_wheel_speed, tooth_hz, wheel_defaults
from br27sim.params import with_defaults

P = with_defaults({})


def test_tooth_rate():
    # 30 teeth, 406 mm tire, 36 km/h = 10 m/s -> 7.84 wheel turns/s -> 235 Hz
    assert math.isclose(tooth_hz(P, wheel_defaults(), 36), 30 * 10 / (math.pi * 0.406))


def test_hall_reads_slower_than_vr():
    w = wheel_defaults()
    assert min_speed_kmh(P, w, "hall") < min_speed_kmh(P, w, "vr")


def test_vr_worse_with_bigger_gap_and_more_noise():
    w = wheel_defaults()
    assert min_speed_kmh(P, dict(w, gapMM=2.0), "vr") > min_speed_kmh(P, w, "vr")
    assert min_speed_kmh(P, dict(w, vrNoiseMV=100), "vr") > min_speed_kmh(P, w, "vr")


def test_hall_stops_past_its_gap_or_with_tiny_teeth():
    w = wheel_defaults()
    assert min_speed_kmh(P, dict(w, gapMM=2.5), "hall") == math.inf
    assert min_speed_kmh(P, dict(w, teeth=100, ringMM=60), "hall") == math.inf


def test_counting_teeth_is_much_coarser_than_timing():
    w = wheel_defaults()
    assert resolution_kmh(P, w, 20, "count") > 100 * resolution_kmh(P, w, 20, "period")


def test_rollout_traces():
    r = simulate_wheel_speed({}, {}, simulate_lap({}))
    ro = r["rollout"]
    at = lambda tr, t: tr["v"][min(range(len(tr["t"])), key=lambda i: abs(tr["t"][i] - t))]
    # 1.2 s: rolling at 3.6 km/h; the Hall sensor sees it, the VR does not
    assert at(ro["hall"], 1.2) > 2 and at(ro["vr"], 1.2) == 0
    # 5 s: both read 50 km/h within 1 km/h
    assert abs(at(ro["hall"], 5.0) - 50) < 1 and abs(at(ro["vr"], 5.0) - 50) < 1
    # stopped at the end
    assert ro["hall"]["v"][-1] == 0 and ro["vr"]["v"][-1] == 0
    assert r["rec"] and r["rec"]["lo"] <= 30 <= r["rec"]["hi"]


from br27sim.components import ir_spot_mm, ir_defaults, simulate_ir, simulate_steering  # noqa: E402


def test_ir_spot_grows_with_distance_and_fov():
    o = ir_defaults()
    assert ir_spot_mm(o, 200) > ir_spot_mm(o, 100)
    assert ir_spot_mm(dict(o, fovDeg=90), 100) > ir_spot_mm(dict(o, fovDeg=10), 100)


def test_ir_reads_true_when_spot_fits_and_low_when_it_does_not():
    near = simulate_ir({"fovDeg": 10, "distMM": 100, "gradC": 0})["spots"][0]
    assert abs(near["meas"] - 70) < 0.1 and near["fill"] == 1
    far = simulate_ir({"fovDeg": 90, "distMM": 300, "gradC": 0})["spots"][0]
    assert far["meas"] < 55  # sees the 35 C track around the tire


def test_ir_wrong_emissivity_reads_low_on_rotor():
    r = simulate_ir({"target": "rotor", "fovDeg": 5, "distMM": 50, "emisSet": 0.95})
    assert r["spots"][0]["meas"] < 300  # rotor is 350 C with emissivity 0.5


def test_ir_three_spots_see_camber():
    s = simulate_ir({"spots": 3, "fovDeg": 10})["spots"]
    assert s[0]["meas"] > s[1]["meas"] > s[2]["meas"]


def test_steering_range_and_clipping():
    assert not simulate_steering({})["clips"]
    r = simulate_steering({"lockDeg": 250})  # 500 degrees on a 340 degree pot
    assert r["clips"] and r["usedPct"] > 100
    assert r["maxErr"] > 20


def test_steering_errors_follow_their_causes():
    base = simulate_steering({})
    assert simulate_steering({"linPct": 0.25})["budgetDeg"] < base["budgetDeg"]
    assert simulate_steering({"ratiometric": False, "supplyPct": 5})["supplyDeg"] > 0
    assert simulate_steering({"adcBits": 16})["lsbDeg"] < base["lsbDeg"]
