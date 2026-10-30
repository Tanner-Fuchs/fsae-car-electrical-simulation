"""Physics sanity checks: results move the way they should when inputs change."""
import br27sim


def test_defaults_are_not_shared():
    a = br27sim.with_defaults({})
    a["nodeLoad5V"]["FL"] = 9
    a["gears"][0] = 9
    assert br27sim.DEFAULTS["nodeLoad5V"]["FL"] == 0.22
    assert br27sim.DEFAULTS["gears"][0] == 2.666


def test_restrictor_limits_power():
    big = br27sim.simulate_lap({"restrictorMM": 25})["stats"]["peakKW"]
    std = br27sim.simulate_lap({})["stats"]["peakKW"]
    assert big > std
    assert 40 < std < 60  # about 66 hp restricted


def test_dead_regulator_drains_battery():
    lap = br27sim.simulate_lap({})
    ok = br27sim.simulate_power({}, lap)["stats"]["endSoc"]
    dead = br27sim.simulate_power({"regFault": "open", "regFaultMin": 15}, lap)["stats"]["endSoc"]
    assert dead < ok - 20


def test_bigger_battery_cranks_higher():
    lap = br27sim.simulate_lap({})
    v4 = br27sim.simulate_power({"battery": "lfp4"}, lap)["minCrankV"][0]["v"]
    v8 = br27sim.simulate_power({"battery": "lfp8"}, lap)["minCrankV"][0]["v"]
    assert v8 > v4


def test_can_load_halves_when_bitrate_doubles():
    a = br27sim.simulate_can({"bitrate": 500000})["stats"]["load"]
    b = br27sim.simulate_can({"bitrate": 1000000})["stats"]["load"]
    assert abs(a / b - 2) < 1e-9


def test_classic_frame_is_135_bits_worst_case():
    assert br27sim.frame_bits(br27sim.with_defaults({})) == 135


def test_missing_terminator_is_flagged():
    phy = br27sim.can_physical({"termEnd2": False}, "all")
    assert phy["terms"] == 1 and phy["issues"]


def test_fault_beats_data_in_arbitration():
    r = br27sim.arbitrate(0x080, 0x100)
    assert r["decided"]["winner"] == 0x080


def test_kill_switches_cut_fuel_and_spark_but_not_ecu():
    for sw in ["cms", "bots", "inertia"]:
        s = br27sim.shutdown_state({sw: True})
        assert not s["feeds"]["injectors"] and not s["feeds"]["fuelPump"] and s["feeds"]["ecu"]
    assert not br27sim.shutdown_state({"pms": True})["feeds"]["ecu"]


def test_fault_ids_are_unique_and_in_band():
    ids = [f["id"] for f in br27sim.FAULTS]
    assert len(ids) == len(set(ids))
    for f in br27sim.FAULTS:
        base = br27sim.FAULT_BANDS[f["sev"]]["base"]
        assert base <= f["id"] < base + 16
