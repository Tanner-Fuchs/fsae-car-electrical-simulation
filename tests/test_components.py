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
