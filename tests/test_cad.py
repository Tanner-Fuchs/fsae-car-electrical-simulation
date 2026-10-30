"""STL import: parsing, the CAD-to-simulator transform, and the saved settings."""
import struct

import pytest

from br27sim import cad


def box(x0, y0, z0, x1, y1, z1):
    v = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    faces = [(0, 1, 3), (0, 3, 2), (4, 6, 7), (4, 7, 5), (0, 4, 5), (0, 5, 1), (2, 3, 7), (2, 7, 6), (0, 2, 6), (0, 6, 4), (1, 5, 7), (1, 7, 3)]
    return [(v[a], v[b], v[c]) for a, b, c in faces]


def binary_stl(tris):
    out = b"\0" * 80 + struct.pack("<I", len(tris))
    for t in tris:
        out += struct.pack("<12fH", 0, 0, 0, *t[0], *t[1], *t[2], 0)
    return out


def ascii_stl(tris):
    s = "solid t\n"
    for t in tris:
        s += " facet normal 0 0 0\n  outer loop\n" + "".join(f"   vertex {x} {y} {z}\n" for x, y, z in t) + "  endloop\n endfacet\n"
    return (s + "endsolid t\n").encode()


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("BR27SIM_DATA", str(tmp_path))


def test_binary_and_ascii_give_the_same_box():
    b = cad.stl_stats(cad.parse_stl(binary_stl(box(0, 0, 0, 100, 200, 300))))
    a = cad.stl_stats(cad.parse_stl(ascii_stl(box(0, 0, 0, 100, 200, 300))))
    for st in (a, b):
        assert st["triangles"] == 12
        assert st["min"] == [0, 0, 0] and st["max"] == [100, 200, 300]
        assert st["volume"] == pytest.approx(100 * 200 * 300)


def test_not_an_stl_is_refused():
    with pytest.raises(ValueError):
        cad.add_file("notes.stl", b"hello")


def test_z_up_mm_maps_to_simulator_axes():
    m = cad.matrix({"units": "mm", "up": "z", "forward": "+x", "offset": [0, 0, 0]})
    # CAD: x forward, y left, z up (mm)  ->  sim: x forward, y up, z right (m)
    assert cad.apply(m, [1000, 0, 0]) == pytest.approx([1, 0, 0])
    assert cad.apply(m, [0, 0, 1000]) == pytest.approx([0, 1, 0])
    assert cad.apply(m, [0, 1000, 0]) == pytest.approx([0, 0, -1])


def test_forward_axis_turns_the_model():
    m = cad.matrix({"units": "m", "up": "y", "forward": "-x", "offset": [0, 0, 0]})
    assert cad.apply(m, [-1, 0, 0]) == pytest.approx([1, 0, 0])


def test_parts_set_positions_and_hand_placement_wins():
    cad.add_file("BR27 frame.stl", binary_stl(box(0, -300, 100, 2000, 300, 1000)), "frame")
    cad.add_file("battery.stl", binary_stl(box(1100, 80, 80, 1250, 160, 170)), "battery")
    s = cad.summary()
    assert {f["name"] for f in s["files"]} == {"BR27 frame.stl", "battery.stl"}
    assert s["positions"]["battery"] == pytest.approx([1.175, 0.125, -0.12])
    s = cad.update({"position": {"part": "battery", "xyz": [0, 0.2, 0]}})
    assert s["positions"]["battery"] == [0, 0.2, 0] and s["placed"] == ["battery"]
    s = cad.update({"position": {"part": "battery", "xyz": None}})
    assert s["placed"] == []


def test_center_frame():
    cad.add_file("frame.stl", binary_stl(box(0, -300, 100, 2000, 300, 1000)), "frame")
    s = cad.update({"centerFrame": True})
    f = s["files"][0]
    assert f["center"][0] == pytest.approx(0) and f["center"][2] == pytest.approx(0)
    assert f["min"][1] == pytest.approx(0.05)


def test_remove():
    cad.add_file("x.stl", binary_stl(box(0, 0, 0, 1, 1, 1)))
    assert cad.update({"remove": "x.stl"})["files"] == []
    assert not (cad.data_dir() / "x.stl").exists()
