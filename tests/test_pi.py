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
    assert not rows(simulate_pi(None, {"display": "5in-dsi"}), "pico")[None]["ok"]
    r = simulate_pi(None, {"display": "480x320", "board": "pico"})
    assert r["sel"]["key"] == "pico" and r["sel"]["usedKB"] < 264


def test_lora_airtime_known_value():
    # SF7, 125 kHz, 4/5, 8 preamble, explicit header, CRC: 10 bytes is about 41 ms (Semtech calculator)
    assert 38 < lora_airtime(10, 7, 125) < 44
    assert lora_airtime(32, 12, 125) > 1000


def test_tire_zones_add_can_frames():
    from br27sim import simulate_pi
    off, on = simulate_pi(o={"tireZones": False}), simulate_pi(o={"tireZones": True})
    assert on["fps"] == off["fps"] + 40
    assert sum("I/C/O" in m["name"] for m in on["msgs"]) == 4


def test_teensy_needs_eve_screen_and_boots_fast():
    assert not rows(simulate_pi(None, {"display": "5in-dsi"}), "teensy41")[None]["ok"]          # DSI screen: no
    t = rows(simulate_pi(None, {"display": "5in-eve", "bufS": 1}), "teensy41")[None]
    assert t["ok"] and t["bootS"] < 1 and t["usedKB"] < 1024 * 0.7
    assert not rows(simulate_pi(None, {"display": "5in-eve"}), "pi5")[2]["ok"]   # a Pi can't use the EVE screen here


def test_power_cut_hold_up_and_read_only_root():
    stock = rows(simulate_pi(), "pi5")[2]["cut"]
    assert not stock["clean"] and not stock["osSafe"]
    ro = rows(simulate_pi(None, {"rootRO": True}), "pi5")[2]["cut"]
    assert ro["osSafe"] and not ro["clean"]
    sc = rows(simulate_pi(None, {"holdUp": "supercap"}), "pi5")[2]["cut"]
    assert sc["clean"] and sc["osSafe"]
    t = rows(simulate_pi(None, {"display": "5in-eve", "holdUp": "cap"}), "teensy41")[None]["cut"]
    assert t["clean"] and t["osSafe"] and t["lostS"] == 0


def test_tuned_boot_is_faster():
    assert rows(simulate_pi(None, {"bootTuned": True}), "pi5")[2]["bootS"] < rows(simulate_pi(), "pi5")[2]["bootS"]


def test_hmi_uart_screen_works_on_every_board():
    r = simulate_pi(None, {"display": "5in-hmi", "bufS": 1})
    t, p5 = rows(r, "teensy41")[None], rows(r, "pi5")[2]
    assert t["ok"] and p5["ok"] and t["busiest"] < 10
    assert any("cd/m" in w for w in t["warns"])
    import br27sim.pi as pim
    old, pim.HMI_BAUD = pim.HMI_BAUD, 115200
    fast = simulate_pi(None, {"display": "5in-hmi", "fps": 30})
    pim.HMI_BAUD = old
    assert any("UART" in w for w in rows(fast, "teensy41")[None]["warns"])
