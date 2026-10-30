"""Command line: br27sim serve | report | export-wiring"""
import argparse
import json
import sys

from . import __version__


def report(params):
    """Headline results of every model, as text."""
    from . import BATTERIES, alias_demo, can_physical, simulate_can_all, simulate_lap, simulate_power, simulate_shutdown
    from ._js import js_str, to_fixed as f

    lap = simulate_lap(params)
    s = lap["stats"]
    print(f"Lap        {f(s['lapTime'], 2)} s over {f(s['lapLen'], 0)} m, avg {f(s['avgKmh'], 1)} km/h, max {f(s['maxKmh'], 1)} km/h")
    print(f"Engine     peak {f(s['peakHp'], 1)} hp at {s['peakRpm']} rpm, restrictor chokes at {f(lap['chokeGs'], 1)} g/s, "
          f"max injector duty {f(s['maxDuty'], 1)} %, fuel {f(s['fuelPerLapL'], 3)} L/lap")
    pw = simulate_power(params, lap)
    ps, cr = pw["stats"], pw["crank"]
    print(f"12 V       {pw['laps']} laps, SOC {f(ps['endSoc'], 1)} % at the end (min {f(ps['minSoc'], 1)} %), "
          f"running {f(ps['runVmin'], 2)}-{f(ps['runVavg'], 2)} V, avg load {f(ps['avgLoadA'], 1)} A")
    print(f"Crank      min {f(cr['minV'], 2)} V, node 5 V min {f(cr['min5'], 2)} V, peak {f(cr['peakA'], 0)} A, "
          f"MCU reset: {'yes' if cr['mcuReset'] else 'no'}, ECU reset: {'yes' if cr['ecuReset'] else 'no'}")
    print(f"           {f(ps['noChargeMin'], 0)} min of running if the regulator dies" + (f"; {pw['bmsTrip']}" if pw["bmsTrip"] else ""))
    for b in BATTERIES:
        r = simulate_power({**(params or {}), "battery": b}, lap)
        print(f"  {b:8s} end SOC {f(r['stats']['endSoc'], 1):>5} %, crank " +
              ", ".join(f(x["v"], 2) + " V" for x in r["minCrankV"]) + (f"  {r['bmsTrip']}" if r["bmsTrip"] else ""))
    for c in simulate_can_all(params):
        st = c["stats"]
        print(f"CAN {c['bus']:4s}   {'FD' if c['fd'] else 'classic'}, {len(c['msgs'])} frames, {f(st['fps'], 0)} frames/s, "
              f"load {f(st['load'], 1)} % (measured {f(st['measuredLoad'], 1)} %), worst response {f(st['wcrtMax'], 2)} ms, "
              f"log {f(st['logMB30'], 1)} MB per 30 min")
        print("           load vs bitrate: " + ", ".join(f"{x['label']} {f(x['load'], 1)} %" for x in c["sweep"]))
        phy = can_physical(params, c["bus"])
        print(f"           trunk {js_str(phy['trunk'])} m (max {f(phy['maxLen'], 0)} m), " + ("; ".join(phy["issues"]) or "termination ok"))
    for which in ["cms", "pms"]:
        sd = simulate_shutdown(params, which)
        print(f"Shutdown   {which.upper()} opens: fuel/spark cut after {sd['cutMs']} ms, engine stopped at {sd['stopMs']} ms")
    for rate in [500, 200]:
        for filt in [False, True]:
            a = alias_demo(rate, filt, 11000)
            print(f"DAQ        {rate} Hz {'filtered  ' if filt else 'unfiltered'} error {f(a['rms'], 2)} rms, alias at {f(a['aliasHz'], 0)} Hz")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="br27sim", description="BR27 electrical system simulator")
    ap.add_argument("--version", action="version", version=__version__)
    sub = ap.add_subparsers(dest="cmd")
    s = sub.add_parser("serve", help="open the interactive simulator in your browser")
    s.add_argument("--port", type=int, default=8027)
    s.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 to reach it from another device on your network")
    s.add_argument("--no-browser", action="store_true")
    r = sub.add_parser("report", help="print headline results")
    r.add_argument("--set", nargs="*", default=[], metavar="KEY=VALUE",
                   help="override inputs, e.g. --set battery=agm finalDrive=3.5")
    e = sub.add_parser("export-wiring", help="write the harness SVGs, xlsx wire list and print sheets")
    e.add_argument("out_dir", nargs="?", default="wiring-out")
    e.add_argument("--pdf", action="store_true", help="also print a PDF (needs: pip install playwright && playwright install chromium)")
    a = ap.parse_args(argv)

    if a.cmd == "serve":
        from .server import serve
        serve(a.host, a.port, not a.no_browser)
    elif a.cmd == "report":
        params = {}
        for kv in a.set:
            k, _, v = kv.partition("=")
            try:
                params[k] = json.loads(v)
            except ValueError:
                params[k] = v
        report(params)
    elif a.cmd == "export-wiring":
        from .exports import export_wiring
        files, n = export_wiring(a.out_dir, a.pdf)
        for p in files:
            print("wrote", p)
        print(n, "wires")
    else:
        ap.print_help()
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
