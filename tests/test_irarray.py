from br27sim.irarray import IR_ARRAY_DEFAULTS, simulate_ir_array


def test_default_array_spans_tread():
    r = simulate_ir_array({})
    assert r["o"]["pixels"] == 32
    assert r["coverPct"] > 95 and r["onTread"] >= 28
    # camber profile: inner hotter, read close to the true edge difference
    assert r["estIO"] > 0 and abs(r["estIO"] - r["edgeIO"]) < 0.5


def test_too_close_misses_edges():
    r = simulate_ir_array({"distMM": 60})
    assert r["coverPct"] < 60


def test_yaw_and_offset_push_row_off_tread():
    base = simulate_ir_array({})["onTread"]
    assert simulate_ir_array({"yawDeg": 20})["onTread"] < base
    assert simulate_ir_array({"yMM": 50})["onTread"] < base


def test_roll_narrows_span_and_pitch_misses_tire():
    assert simulate_ir_array({"rollDeg": 45})["coverPct"] < simulate_ir_array({})["coverPct"] - 10
    assert simulate_ir_array({"pitchDeg": 45})["onTread"] == 0


def test_upright_mount_ignores_steer():
    a = simulate_ir_array({"mount": "upright", "steerDeg": 25})
    b = simulate_ir_array({"mount": "upright"})
    assert [round(p["meas"], 6) for p in a["pixels"]] == [round(p["meas"], 6) for p in b["pixels"]]
    assert simulate_ir_array({"steerDeg": 25})["onTread"] < b["onTread"]


def test_single_pixel_and_defaults_unchanged():
    r = simulate_ir_array({"kind": "single", "preset": "single_35", "distMM": 100})
    assert len(r["pixels"]) == 1
    assert IR_ARRAY_DEFAULTS["preset"] == "mlx90640_55"


def test_position_presets_reach_the_tread():
    for pos in ("front", "above", "beside"):
        r = simulate_ir_array({"position": pos})
        assert r["onTread"] > 10, pos
        r1 = simulate_ir_array({"position": pos, "kind": "single", "preset": "single_10", "distMM": 100})
        assert r1["pixels"][0]["treadFrac"] > 0.95, pos


def test_kind_picks_matching_preset():
    assert simulate_ir_array({"kind": "single"})["o"]["preset"] == "single_35"
    assert simulate_ir_array({"kind": "array", "preset": "single_10"})["o"]["preset"] == "mlx90640_55"
