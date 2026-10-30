from openpyxl import load_workbook

from br27sim import wiring as W
from br27sim.exports import NAME, export_wiring


def test_wire_list():
    wires = W.wire_list()
    assert len(wires) == 71
    assert len({w["id"] for w in wires}) == len(wires)
    known = {c[0] for c in W.CONNECTORS} | {"PUMP", "FAN"}
    for w in wires:
        assert w["from"] in known and w["to"] in known, w


def test_every_used_emu_pin_has_a_wire():
    wired = {(w["from"], w["fromPin"]) for w in W.wire_list()} | {(w["to"], w["toPin"]) for w in W.wire_list()}
    for conn, rows in [("EMU-B", W.BLACK), ("EMU-G", W.GREY)]:
        for pin, _fn, use, _wire, group in rows:
            if group != "spare":
                assert (conn, str(pin)) in wired, f"{conn} pin {pin} ({use}) has no wire"


def test_drawings_are_svg():
    for svg in [W.schematic_svg(), W.fuel_system_svg()]:
        assert svg.startswith("<svg") and svg.endswith("</svg>")


def test_export(tmp_path):
    files, n = export_wiring(tmp_path)
    assert n == 71
    names = {p.name for p in files}
    assert {NAME + ".svg", NAME + ".xlsx", NAME + ".html"} <= names
    wb = load_workbook(tmp_path / (NAME + ".xlsx"))
    assert wb.sheetnames == ["Wires", "Connectors", "EMU pinout", "Fuses", "Notes"]
    assert wb["Wires"].max_row == 72
