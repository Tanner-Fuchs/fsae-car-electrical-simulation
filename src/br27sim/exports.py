"""Exports the powertrain harness: SVG drawings, an .xlsx from-to wire list, and a
printable sheet set (HTML, plus PDF when Playwright is installed).

    br27sim export-wiring [out_dir] [--pdf]
"""
import os
from pathlib import Path

from . import wiring as W

NAME = "BR27-Powertrain-Harness-RevF"

PRINT_CSS = """@page { size: 17in 11in; margin: 0.35in; }
body { font: 11px/1.35 Helvetica, Arial, sans-serif; color: #12161d; margin: 0; }
.p { page-break-after: always; } .p:last-child { page-break-after: auto; }
svg { width: 100%; height: auto; max-height: 10.2in; }
h2 { font-size: 16px; margin: 0 0 4px; } h3 { font-size: 13px; margin: 8px 0 4px; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
table { border-collapse: collapse; width: 100%; } th, td { border-bottom: 1px solid #d9dce1; padding: 2px 6px; text-align: left; vertical-align: top; }
th { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #4a515c; } td:first-child { font-family: Menlo, monospace; width: 28px; }
tr.sp td { color: #7a818c; } tr.tbd td:last-child { color: #8a5a00; font-weight: 600; } td:first-child { white-space: nowrap; } .note { color: #4a515c; margin: 2px 0 8px; } ul { margin: 4px 0 0 16px; padding: 0; }"""


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;")


def _pin_table(title, rows):
    body = "".join(f'<tr class="{"sp" if g == "spare" else ""}"><td>{pin}</td><td>{esc(fn)}</td><td>{esc(use or "—")}</td><td>{esc(wire)}</td></tr>'
                   for pin, fn, use, wire, g in rows)
    return (f'<div class="t"><h3>{title}</h3><table><thead><tr><th>Pin</th><th>EMU function</th><th>BR27 use</th><th>Wire</th></tr></thead>'
            f"<tbody>{body}</tbody></table></div>")


def print_html():
    """The sheet set as one HTML page: schematic, fuel system, pinout, components."""
    fuses = "".join(f"<tr><td>{f[0]}</td><td>{f[1]}</td><td>{esc(f[2])}</td></tr>" for f in W.FUSES)
    comps = "".join(f'<tr class="{"tbd" if c["status"] == "To be selected" else ""}"><td>{c["ref"]}</td><td>{esc(c["desc"])}</td><td>{esc(c["loc"])}</td><td>{c["pins"]}</td><td>{c["status"]}</td></tr>'
                    for c in W.components())
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>{NAME}</title><style>{PRINT_CSS}</style></head><body>
<div class="p">{W.schematic_svg()}</div>
<div class="p">{W.fuel_system_svg()}</div>
<div class="p"><h2>EMU Black pinout and BR27 assignment, rev F (2026-10-31)</h2>
<p class="note">Pin functions copied from the label on the team's EMU Black. BR27 use is a proposal for the 2012 CBR600RR with cable throttle. Grey rows are unused. Check every pin against the EMU Black manual and assign the outputs in the EMU client before powering up.</p>
<div class="cols">{_pin_table('Black 39-pin connector (B)', W.BLACK)}<div>{_pin_table('Grey 24-pin connector (G)', W.GREY)}
<h3>Fuses (fuse and relay box under the seat)</h3><table><tbody>{fuses}</tbody></table>
<h3>Build notes</h3><ul>
<li>Injectors, coils, wideband heater and the pump relay take +12 V from the kill bus. The EMU only switches their ground side, so opening the CMS, BOTS or inertia switch kills fuel and spark in hardware (IC.9).</li>
<li>The EMU itself is fed from F1 ahead of the kill relay, so it keeps logging after a shutdown.</li>
<li>Crank and cam VR sensors: shielded twisted pair, shield grounded at the EMU sensor ground only.</li>
<li>Coil 4 is on the black connector (B14), not the grey one.</li>
<li>Fuel level (rev C): float sender in the tank to Analog #5 (B35). R1 470 Ω from +5 V to the signal, sender return to sensor ground (not the tank or chassis). Reads about 0.33 V full to 1.69 V empty; open circuit reads 5 V. Scale it in the EMU client and send it to the dash over CAN. See the Fuel Level Sensor Selection form.</li>
<li>Fuel pump: +12 V from the kill bus through F3 and the pump relay (EMU AUX 2, G13, low side), so the CMS, BOTS or inertia switch stops the pump (IC.9.2.2).</li>
<li>Firewall (rev F): the firewall is one sheet bent about 135°: a vertical back panel and a lower leg sloping forward-down to the floor. The battery and EMU sit in the wedge under the sloped leg on the engine side; the fuse/relay box and 5 V converters are part of the dash unit at the front. EMU-to-engine wires never cross the firewall. What crosses at sealed grommet GR1: the battery feed to the dash unit, F1 to the EMU, the kill bus, pump and fan +12 V, the EMU relay drive wires (G13, G5) and the CAN chain (wire list column "Firewall pass-through"). Every other panel pass-through gets a grommet (GR2).</li>
<li>CAN (2026-10-31): one chain, dash unit (120 Ω) → FR → FL → GR1 → CAN splice beside the EMU → RR → RL (120 Ω). The EMU joins on a ~0.1 m stub; turn its built-in selectable terminator OFF in the EMU client.</li>
</ul></div></div></div>
<div class="p"><h2>Powertrain electrical components and selection status</h2>
<p class="note">"Stock CBR600RR (assumed)" means the part is assumed to stay as it comes on the 2012 engine; confirm it. "To be selected" parts are shown generically in the schematic (dashed boxes) and their pinouts, connectors and wire counts may change once chosen. The full from-to wire list is in {NAME}.xlsx.</p>
<table><thead><tr><th>Ref</th><th>Component</th><th>Location</th><th>Pins</th><th>Status</th></tr></thead><tbody>{comps}</tbody></table>
</div>
</body></html>"""


def write_xlsx(path):
    """From-to wire list workbook for harness tools."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    status = {k: W.STATUS_LABEL.get(v, "") for k, v in W.STATUS.items()}
    head, hfill, tbd = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="0B6E8A"), PatternFill("solid", fgColor="FDF1D6")

    def sheet(wb, title, cols, rows, widths, tbd_col=None):
        ws = wb.create_sheet(title)
        ws.append(cols)
        for c in ws[1]:
            c.font, c.fill, c.alignment = head, hfill, Alignment(vertical="center")
        for r in rows:
            ws.append(r)
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions
        if tbd_col is not None:
            for row in ws.iter_rows(min_row=2):
                if "To be selected" in str(row[tbd_col].value or ""):
                    for c in row:
                        c.fill = tbd
        return ws

    wb = Workbook()
    wb.remove(wb.active)
    wires = [[w["id"], w["signal"], w["from"], w["fromPin"], w["to"], w["toPin"], w["awg"], w["color"], w["mm"], w["group"], w["via"],
              "To be selected" if "To be selected" in (status.get(w["from"], ""), status.get(w["to"], "")) else ""] for w in W.wire_list()]
    sheet(wb, "Wires", ["Wire ID", "Signal", "From connector", "From pin", "To connector", "To pin", "Gauge (AWG)", "Color (suggested)",
                        "Length est. (mm)", "Twist/shield group", "Firewall pass-through", "Part status"],
          wires, [9, 16, 15, 9, 14, 8, 11, 16, 14, 16, 15, 15], tbd_col=11)
    sheet(wb, "Connectors", ["Ref", "Description", "Location", "Pin count", "Status"],
          [[c["ref"], c["desc"], c["loc"], c["pins"], c["status"]] for c in W.components()] +
          [[r, d, "", "", "Splice / ground point"] for r, d in [("S1", "+5 V ref splice"), ("S2", "Sensor ground splice"), ("S3", "Kill bus +12 V splice"),
                                                              ("GS", "Ground star point (engine block stud)"), ("CAN", "CAN bus to node RL"),
                                                              ("R1", "Fuel level pull-up resistor, 470 Ω 0.25 W, in the sender pigtail")]],
          [8, 60, 22, 10, 26], tbd_col=4)
    sheet(wb, "EMU pinout", ["Connector", "Pin", "EMU function", "BR27 use", "Wire"],
          [["EMU-B (black 39)", *r[:4]] for r in W.BLACK] + [["EMU-G (grey 24)", *r[:4]] for r in W.GREY],
          [18, 6, 24, 58, 28])
    sheet(wb, "Fuses", ["Fuse", "Rating", "Feeds"], W.FUSES, [8, 10, 60])
    ws = wb.create_sheet("Notes")
    for line in [
        "BR27 powertrain harness, rev F, 2026-10-31 (bent firewall: battery and EMU under its sloped lower leg on the engine side, fuse/relay box in the dash unit; wires from the box to the engine side cross at grommet GR1, see the Firewall pass-through column; rev E grommets instead of a bulkhead connector; rev D team wire color code; rev C fuel level sender W068-W071). Proposal: check every pin against the EMU Black manual before building.",
        "Wires sheet is a from-to list, one row per wire. Map its columns to your harness tool's import fields (connector, pin, gauge, color, length).",
        "Device pin names (SIG, +5V, GND, +, -) are functions until the mating connectors are chosen; LSU and relay pins use their real numbers.",
        "Rows shaded yellow touch a part that is still to be selected; their pins and wire counts may change.",
        "Lengths are rough estimates (EMU under the sloped firewall leg, fuse/relay box in the dash unit); replace them with CAD routing lengths.",
        "Injectors, coils, wideband heater and pump relay coil take +12 V from the kill bus (S3); the EMU switches the low side.",
        "Crank and cam VR pairs (TSP1, TSP2) are shielded twisted pairs; ground shields at the EMU sensor ground only.",
    ]:
        ws.append([line])
    ws.column_dimensions["A"].width = 130
    wb.save(path)
    return len(wires)


def write_pdf(html, path):
    """Prints the sheet set to a 17x11 in PDF with Playwright's Chromium."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit("PDF export needs Playwright:  pip install playwright  then  playwright install chromium\n"
                         "(or open the .html file in a browser and print it to PDF, 17 x 11 in landscape)")
    with sync_playwright() as pw:
        b = pw.chromium.launch(**({"executable_path": os.environ["BR27SIM_CHROMIUM"]} if os.environ.get("BR27SIM_CHROMIUM") else {}))
        page = b.new_page()
        page.set_content(html, wait_until="load")
        m = "0.35in"
        page.pdf(path=str(path), width="17in", height="11in", print_background=True,
                 margin={"top": m, "bottom": m, "left": m, "right": m})
        b.close()


def export_wiring(out_dir="wiring-out", pdf=False):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    written = []
    for name, svg in [(NAME + ".svg", W.schematic_svg()), (NAME + "-Fuel-System.svg", W.fuel_system_svg())]:
        (out / name).write_text(svg, encoding="utf-8")
        written.append(out / name)
    html = print_html()
    (out / (NAME + ".html")).write_text(html, encoding="utf-8")
    written.append(out / (NAME + ".html"))
    n = write_xlsx(out / (NAME + ".xlsx"))
    written.append(out / (NAME + ".xlsx"))
    if pdf:
        write_pdf(html, out / (NAME + ".pdf"))
        written.append(out / (NAME + ".pdf"))
    return written, n
