from br27sim import JS_API
from br27sim.pi import BOARDS, lora_airtime, simulate_pi


def rows(r, key):
    return {x["ramGB"]: x for x in r["rows"] if x["key"] == key}


def test_every_board_has_a_row():
    r = simulate_pi()
    keys = {x["key"] for x in r["rows"]}
    assert keys == set(BOARDS)
    assert "simulatePi" in JS_API


def test_pi5_2gb_fits_default_setup():
    r = simulate_pi()
    assert r["fps"] > 1000
    assert rows(r, "pi5")[2]["ok"]


def test_more_ram_same_use_lower_percent():
    p5 = rows(simulate_pi(), "pi5")
    assert p5[2]["usedMB"] == p5[8]["usedMB"] and p5[8]["ramPct"] < p5[2]["ramPct"]


def test_slower_board_busier():
    r = simulate_pi()
    assert rows(r, "pi3")[1]["busiest"] > rows(r, "pi4")[2]["busiest"] > rows(r, "pi5")[2]["busiest"]


def test_python_costs_more_than_c():
    py, c = simulate_pi(None, {"lang": "python"})["sel"], simulate_pi(None, {"lang": "c"})["sel"]
    assert py["busiest"] > c["busiest"] and py["usedMB"] > c["usedMB"]


def test_chromium_desktop_breaks_1gb():
    r = simulate_pi(None, {"renderer": "chromium", "os": "desktop"})
    assert not rows(r, "pi4")[1]["ok"]


def test_pico_needs_spi_screen():
    assert not rows(simulate_pi(), "pico")[None]["ok"]
    r = simulate_pi(None, {"display": "480x320", "board": "pico"})
    assert r["sel"]["key"] == "pico" and r["sel"]["usedKB"] < 264


def test_lora_airtime_known_value():
    # SF7, 125 kHz, 4/5, 8 preamble, explicit header, CRC: 10 bytes is about 41 ms (Semtech calculator)
    assert 38 < lora_airtime(10, 7, 125) < 44
    assert lora_airtime(32, 12, 125) > 1000
