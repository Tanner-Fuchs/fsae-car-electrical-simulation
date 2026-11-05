from br27sim import ir_array_frames


def test_frames_cover_steer_range():
    f = ir_array_frames({"mount": "chassis"})
    assert [x["deg"] for x in (f[0], f[30], f[-1])] == [-30, 0, 30]
    assert f[30]["coverPct"] > f[0]["coverPct"]          # turning the tire under a chassis sensor loses an edge
    up = ir_array_frames({"mount": "upright"})
    assert abs(up[0]["coverPct"] - up[30]["coverPct"]) < 1e-6


def test_zone_averages_steer_correction():
    from br27sim import simulate_ir_array
    r = simulate_ir_array({"mount": "chassis", "steerDeg": 15})
    tru, z = r["zoneTrue"], r["zones"]
    assert tru[0] > tru[2]                                   # camber profile: inner hotter
    assert abs(z["steer"][0] - tru[0]) < 2                   # steering-corrected map tracks the inner third
    assert abs(z["fixed"][0] - tru[0]) > 10                  # the fixed map reads the track instead
    up = simulate_ir_array({"mount": "upright", "steerDeg": 15})["zones"]
    assert up["fixed"] == up["steer"]
