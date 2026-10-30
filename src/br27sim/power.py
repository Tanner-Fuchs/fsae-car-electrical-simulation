"""12 V system: battery, stator/regulator, loads and the breaker through an endurance run,
plus the 1 ms cranking model."""
import math

from ._js import INF, clamp, interp, jmax, jmin, js_round, js_str, to_fixed
from .engine import EngineModel, simulate_lap
from .params import BATT_LIMITS, BATTERIES, LHV, OCV, with_defaults


def stator_a(p, rpm):
    if rpm < 1000:
        return 0
    return p["statorSat"] * (1 - math.exp(-(rpm - 1000) / p["statorK"]))


def bucks(p, vin):
    # LT8609S node supply behind a reverse-polarity FET (~0.1 V). Near
    # dropout the 5 V rail follows the input minus ~0.25 V.
    v5 = clamp(vin - 0.35, 0, 5.0)
    v33 = clamp(v5 - 0.3, 0, 3.3)
    return {"v5": v5, "v33": v33, "mcuOk": v33 >= 3.0}


def simulate_power(params=None, lap=None):
    """Key on, crank, staging, two stints with a driver change, cool-down, at 10 Hz."""
    p = with_defaults(params)
    lap = lap or simulate_lap(p)
    bat = BATTERIES.get(p["battery"]) or BATTERIES["lfp4"]
    ocv_tab = OCV[bat["chem"]]
    lim = BATT_LIMITS[bat["chem"]]
    eng = EngineModel(p)
    dt = 0.1

    # resample the lap to 10 Hz
    s = lap["series"]
    lp = {"rpm": [], "duty": [], "dwell": [], "v": [], "cool": []}
    for k in range(0, len(s["t"]), 10):
        lp["rpm"].append(s["rpm"][k]); lp["duty"].append(s["duty"][k]); lp["dwell"].append(s["dwell"][k])
        lp["v"].append(s["v"][k] / 3.6); lp["cool"].append(s["coolKW"][k])
    lap_steps = len(lp["rpm"])
    laps = max(2, js_round(p["endurKm"] * 1000 / lap["lapLen"]))
    stint1 = math.ceil(laps / 2)
    stint2 = laps - stint1

    # build the event timeline
    phases = [
        {"name": "Key on", "dur": 20, "key": True, "engine": False},
        {"name": "Crank (cold)", "dur": 1.5, "key": True, "engine": False, "crank": True},
        {"name": "Staging idle", "dur": p["stagingMin"] * 60, "key": True, "engine": True, "idle": True},
        {"name": "Stint 1", "dur": stint1 * lap_steps * dt, "key": True, "engine": True, "laps": stint1},
        {"name": "Driver change", "dur": p["changeMin"] * 60, "key": p["keyOnDuringChange"], "engine": False},
        {"name": "Crank (hot)", "dur": 2.0, "key": True, "engine": False, "crank": True},
        {"name": "Stint 2", "dur": stint2 * lap_steps * dt, "key": True, "engine": True, "laps": stint2},
        {"name": "Cool-down idle", "dur": 60, "key": True, "engine": True, "idle": True},
    ]

    R = (bat["rMOhm"] + p["cableMOhm"]) / 1000
    R1 = bat["r1MOhm"] / 1000
    soc, vpol, Tc, fan, alive, bms_trip = p["soc0"], 0, p["ambientC"], False, True, ""
    engine_running = False
    T = {k: [] for k in ["t", "v", "ibat", "soc", "iload", "ireg", "istat", "rpm", "cool", "fan", "v5", "phase"]}
    events = []
    warn = {"lowV": 0, "highV": 0, "overchargeS": 0}
    t, min_crank_v, lap_step, reg_heat_j, reg_heat_s = 0, [], 0, 0, 0
    fan_on_s, race_s, load_a_sum, load_n, fuel_g, start_fails = 0, 0, 0, 0, 0, 0
    crank_min, over_s = INF, 0
    brk = {"heat": 0, "peak": 0}

    # thermal breaker: time to trip t = 30 / ((I/In)^2 - 1) s, cools over ~60 s [assumption, Blue Sea 187 class]
    def brk_step(i, dt):
        x = abs(i) / p["mainBreakerA"]
        brk["heat"] = brk["heat"] + dt * (x * x - 1) / 30 if x > 1 else max(0, brk["heat"] - dt / 60)
        brk["peak"] = max(brk["peak"], brk["heat"])
        return brk["heat"] >= 1

    brake_light = lap["series"]["brakeLight"]
    fuel_gs = lap["series"]["fuelGs"]
    for ph in phases:
        n = js_round(ph["dur"] / dt)
        events.append({"t": t, "name": ph["name"]})
        lap_step = 0
        if ph.get("crank"):
            crank_min = INF
        for k in range(n):
            tmin = t / 60
            rpm = duty = dwell_ms = speed = cool_kw = 0
            key_on = alive and ph["key"]
            if ph.get("crank") and key_on:
                rpm = 250
            elif ph["engine"] and key_on and engine_running:
                if ph.get("idle"):
                    rpm = p["idleRpm"]
                    st = eng.state(rpm, 0)
                    duty = eng.injector(rpm, st["fuel"], 14, False)["duty"]
                    dwell_ms = eng.dwell(14)
                    cool_kw = st["fuel"] * LHV * 0.25 / 1000
                    fuel_g += st["fuel"] * 1000 * dt
                else:
                    i = lap_step % lap_steps
                    rpm, duty, dwell_ms, speed, cool_kw = lp["rpm"][i], lp["duty"][i], lp["dwell"][i], lp["v"][i], lp["cool"][i]
                    fuel_g += fuel_gs[min(i * 10, len(fuel_gs) - 1)] * dt
                    lap_step += 1
                    race_s += dt
            running = rpm > 500

            # loads (A), evaluated at last bus voltage
            vb = T["v"][-1] if T["v"] else 13
            iload = 0
            if key_on:
                iload += p["ecuA"] + p["dashA"] + p["loggerA"] + p["miscA"] + p["killRelayA"]
                if ph.get("laps"):
                    iload += p["brakeLightA"] * (brake_light[min((lap_step % lap_steps) * 10, len(brake_light) - 1)] or 0)
                prime = ph["name"] == "Key on" and k * dt < 2
                if running or ph.get("crank") or prime:
                    iload += p["pumpA"]
                if running:
                    iload += p["widebandA"]
                iload += p["cyl"] * (vb / p["injOhm"]) * clamp(duty / 100, 0, 1)
                iload += p["cyl"] * 0.5 * p["coilPeakA"] * clamp(dwell_ms * rpm / 120000, 0, 1)
                for node in p["nodeLoad5V"]:
                    if p["nodeOffline"] == node:
                        continue
                    iload += 5 * p["nodeLoad5V"][node] / (p["buckEff"] * max(vb, 5.5)) + p["nodeQuiescentA"]
                if fan and (running or p["fanWhenOff"]):
                    iload += p["fanA"]
                if ph.get("crank"):
                    iload += p["starterA"]

            # coolant (lumped engine + coolant, 22.5 kJ/K) [assumption]
            fan_blow = bool(fan and key_on and (running or p["fanWhenOff"]))
            UA = 370 * (0.05 + 0.8 * min(speed, 25) / 25 + (0.5 if fan_blow else 0))
            Tc += (cool_kw * 1000 - UA * (Tc - p["ambientC"])) * dt / 22500
            if Tc >= p["fanOnC"]:
                fan = True
            if Tc <= p["fanOffC"]:
                fan = False

            # charging
            istat = stator_a(p, rpm) if running and alive else 0
            vset = p["regSet"]
            if p["regFault"] != "none" and tmin >= p["regFaultMin"]:
                if p["regFault"] == "open":
                    istat = 0
                if p["regFault"] == "overcharge":
                    vset = 15.8
            ocv = interp(ocv_tab, soc)
            voc = ocv - vpol
            ireg = 0
            if not alive:
                ibat = v = iload = istat = 0
            elif istat > 0:
                ibat_hold = (voc - vset) / R
                need = iload - ibat_hold
                if need <= 0:
                    ireg = 0; ibat = iload; v = voc - ibat * R
                elif need <= istat:
                    ireg = need; ibat = iload - need; v = vset
                else:
                    ireg = istat; ibat = iload - istat; v = voc - ibat * R
            else:
                ibat = iload
                v = voc - ibat * R

            # regulator heat: series ~1 V drop on delivered current; shunt dumps the rest
            if istat > 0:
                ph_w = ireg * 1.0 + v * (istat - ireg) if p["regType"] == "shunt" else ireg * 1.0 + 3
                reg_heat_j += ph_w * dt
                reg_heat_s += dt

            # main breaker carries all battery current, charge and discharge
            if alive and brk_step(ibat, dt):
                alive = False
                bms_trip = f"Main breaker ({js_str(p['mainBreakerA'])} A) tripped at {to_fixed(abs(ibat), 0)} A"
                events.append({"t": t, "name": "Breaker tripped", "bad": True})
            # battery protections
            over_s = over_s + dt if ibat > bat["maxDischargeA"] else 0
            if alive and bat["chem"] != "agm" and (ibat > 2 * bat["maxDischargeA"] or over_s > 0.1):
                alive = False
                bms_trip = f"BMS over-current at {to_fixed(ibat, 0)} A (limit {js_str(bat['maxDischargeA'])} A)"
                events.append({"t": t, "name": "Battery cut out", "bad": True})
            if alive and v < lim["cutoff"] and bat["chem"] != "agm":
                alive = False
                bms_trip = f"BMS low-voltage cut-off at {to_fixed(v, 1)} V"
                events.append({"t": t, "name": "Battery cut out", "bad": True})

            # state updates
            soc = clamp(soc - ibat * dt / 3600 / bat["capAh"] * 100, 0, 100)
            vpol += (ibat * R1 - vpol) * dt / bat["tau"]

            if ph.get("crank") and alive:
                crank_min = min(crank_min, v)
            if running and rpm > 3000 and v < 12.8:
                warn["lowV"] += dt
            if alive and v > 15.0:
                warn["highV"] += dt
            if alive and v > lim["overV"]:
                warn["overchargeS"] += dt
            if ph.get("laps"):
                if fan_blow:
                    fan_on_s += dt
                load_a_sum += iload
                load_n += 1

            T["t"].append(t / 60); T["v"].append(v); T["ibat"].append(ibat); T["soc"].append(soc); T["iload"].append(iload)
            T["ireg"].append(ireg); T["istat"].append(istat); T["rpm"].append(rpm); T["cool"].append(Tc)
            T["fan"].append(1 if fan_blow else 0)
            T["v5"].append(bucks(p, v)["v5"]); T["phase"].append(ph["name"])
            t += dt
        if ph.get("crank"):
            ok = alive and crank_min >= p["ecuMinV"]
            min_crank_v.append({"name": ph["name"], "v": crank_min if alive else 0, "ok": ok})
            engine_running = ok
            if not ok:
                start_fails += 1
                events.append({"t": t, "name": "No start", "bad": True})
        if ph["name"] == "Driver change":
            engine_running = False

    # thin the series for plotting (every 1 s)
    thin = {key: vals[::10] for key, vals in T.items()}

    min_soc = jmin(T["soc"])
    run_v = [x for x, r in zip(T["v"], T["rpm"]) if r > 3000]
    avg_load = load_a_sum / load_n if load_n else 0
    return {
        "p": p, "bat": bat, "laps": laps, "stint1": stint1, "stint2": stint2, "events": events, "series": thin,
        "minCrankV": min_crank_v, "bmsTrip": bms_trip,
        "crank": simulate_crank(p, bat, p["soc0"]),
        "stats": {
            "endSoc": T["soc"][-1], "minSoc": min_soc, "startFails": start_fails, "alive": alive,
            "totalMin": t / 60, "raceMin": race_s / 60,
            "avgLoadA": avg_load,
            "fanDuty": fan_on_s / race_s * 100 if race_s else 0,
            "maxCoolant": jmax(T["cool"]),
            "runVmin": min(run_v) if run_v else 0,
            "runVavg": sum(run_v) / len(run_v) if run_v else 0,
            "lowVwarnS": warn["lowV"], "highVwarnS": warn["highV"], "overchargeS": warn["overchargeS"],
            "regHeatW": reg_heat_j / reg_heat_s if reg_heat_s else 0,
            "fuelL": fuel_g / (p["fuelDensity"] * 1000),
            "breakerPeakPct": brk["peak"] * 100,
            "noChargeMin": (bat["capAh"] * 0.85) / max(1, avg_load if load_n else 17) * 60,
        },
    }


def simulate_crank(params=None, bat=None, soc=None):
    """1 ms cranking model: inrush, compression ripple, ECU and node rails."""
    p = with_defaults(params)
    bat = bat or BATTERIES[p["battery"]]
    ocv = interp(OCV[bat["chem"]], soc if soc is not None else p["soc0"])
    R = (bat["rMOhm"] + p["cableMOhm"]) / 1000
    base = p["ecuA"] + p["dashA"] + p["loggerA"] + p["miscA"] + p["killRelayA"] + p["pumpA"] + 1.0
    out = {"t": [], "v": [], "v5": [], "v33": [], "i": []}
    min_v, min5, mcu_reset, ecu_reset, over_ms, tripped = INF, INF, False, False, 0, False
    for ms in range(-100, 1501):
        ist = 0
        if ms >= 0:
            # locked-rotor inrush ~2x running current, decaying as the motor spins up [assumption]
            inrush = 1.0 * math.exp(-ms / 30)
            rpm = min(250, ms * 1.5)
            ripple = 0.25 * math.sin(2 * math.pi * (rpm / 60 * 2) * ms / 1000)
            ist = p["starterA"] * (1 + inrush + ripple)
        itot = ist + base
        v = ocv - itot * R
        # BMS: trips instantly above 2x rating, or after 100 ms above rating [assumption]
        if bat["chem"] != "agm":
            over_ms = over_ms + 1 if itot > bat["maxDischargeA"] else 0
            if itot > 2 * bat["maxDischargeA"] or over_ms > 100:
                tripped = True
        if tripped:
            v = 0
        b = bucks(p, v)
        if not b["mcuOk"] and ms >= 0:
            mcu_reset = True
        if v < p["ecuMinV"] and ms >= 0:
            ecu_reset = True
        min_v = min(min_v, v)
        min5 = min(min5, b["v5"])
        out["t"].append(ms); out["v"].append(v); out["v5"].append(b["v5"]); out["v33"].append(b["v33"]); out["i"].append(itot)
    return {"series": out, "minV": min_v, "min5": min5, "mcuReset": mcu_reset, "ecuReset": ecu_reset,
            "peakA": jmax(out["i"]), "ocv": ocv, "bmsTrip": tripped}
