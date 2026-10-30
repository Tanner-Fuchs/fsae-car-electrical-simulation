"""IC.9 shutdown circuit: which feeds are live, and what happens after a switch opens.

IC.9.1.1: Primary Master Switch, Cockpit Main Switch, BOTS, inertia switch
(BSPD only with ETC, BR27 uses a cable throttle). The CMS, BOTS and inertia
switch are in series with the kill relay coil; the relay contacts feed
injectors, coils and the fuel pump. The ECU is fed after the master switch
but ahead of the kill relay [form: ECU CBR600RR Engine Integration].
"""
from .params import with_defaults

SHUTDOWN_SWITCHES = [
    {"id": "breaker", "name": "Main breaker", "rule": "T.9.2.2", "direct": True},
    {"id": "pms", "name": "Primary Master Switch", "rule": "IC.9.3", "direct": True},
    {"id": "cms", "name": "Cockpit Main Switch", "rule": "IC.9.4"},
    {"id": "bots", "name": "Brake Over Travel Switch", "rule": "T.3.3"},
    {"id": "inertia", "name": "Inertia switch", "rule": "T.9.4"},
]


def shutdown_state(open_=None):
    o = open_ or {}
    battery = not o.get("pms") and not o.get("breaker")
    loop = battery and not o.get("cms") and not o.get("bots") and not o.get("inertia")
    return {
        "battery": battery, "killRelay": loop,
        "feeds": {
            "ecu": battery, "dash": battery, "nodes": battery, "logger": battery, "fan": battery,
            "injectors": loop, "coils": loop, "fuelPump": loop, "charging": battery,
        },
        "engineRuns": loop,
    }


def simulate_shutdown(params, which, rpm0=None):
    """Time response after one switch opens at t = 0 with the engine at rpm0."""
    with_defaults(params)
    rpm0 = rpm0 or 6000
    relay_drop_ms = 8  # relay release time [assumption]
    out = {"t": [], "rpm": [], "relay": [], "ign": [], "ecu": [], "can": []}
    rpm = rpm0
    direct = which == "pms"
    cut_at = 0.5 if direct else relay_drop_ms  # power gone from injectors/coils
    stop_ms = None
    for ms in range(-50, 2501, 5):
        fired = ms < cut_at
        if not fired and rpm > 0:
            # car stationary, gearbox in neutral: friction and pumping only [assumption]
            rpm = max(0, rpm - (2500 + 0.8 * rpm) * 0.005)
            if rpm == 0 and stop_ms is None:
                stop_ms = ms
        out["t"].append(ms); out["rpm"].append(rpm)
        out["relay"].append((1 if ms < 0 else 0) if direct else (1 if ms < relay_drop_ms else 0))
        out["ign"].append(1 if fired else 0)
        out["ecu"].append(0 if direct and ms >= 0 else 1)
        out["can"].append(0 if direct and ms >= 0 else 1)
    return {"which": which, "series": out, "cutMs": cut_at, "stopMs": stop_ms, "ecuLogs": not direct}
