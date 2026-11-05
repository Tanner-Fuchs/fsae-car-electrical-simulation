from br27sim import ir_array_frames


def test_frames_cover_steer_range():
    f = ir_array_frames({"mount": "chassis"})
    assert [x["deg"] for x in (f[0], f[30], f[-1])] == [-30, 0, 30]
    assert f[30]["coverPct"] > f[0]["coverPct"]          # turning the tire under a chassis sensor loses an edge
    up = ir_array_frames({"mount": "upright"})
    assert abs(up[0]["coverPct"] - up[30]["coverPct"]) < 1e-6
