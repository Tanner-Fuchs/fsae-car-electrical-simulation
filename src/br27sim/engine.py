"""Engine (restricted CBR600RR + EMU Black fuel/spark), the lap, and the firing view."""
import math

from ._js import clamp, interp, jmax, js_round, soft_min
from .params import G, LHV, R_AIR, TRACK, with_defaults

VE_TABLE = [[1000, 0.55], [3000, 0.72], [6000, 0.88], [9000, 0.97], [10500, 0.98], [12000, 0.92], [13500, 0.82]]


class EngineModel:
    """Airflow through the 20 mm restrictor, fuel, power and injector/coil timing."""

    def __init__(self, p):
        self.p = p
        T = p["ambientC"] + 273.15
        p0 = p["baroKPa"] * 1000
        self.rho = p0 / (R_AIR * T)
        gam = 1.4
        area = math.pi * math.pow(p["restrictorMM"] / 2000, 2)
        # choked mass flow through the restrictor
        self.choke = p["restrictorCd"] * area * p0 * math.sqrt(gam / (R_AIR * T)) * \
            math.pow(2 / (gam + 1), (gam + 1) / (2 * (gam - 1)))
        self.vd = p["dispL"] / 1000
        self.idle_air = 0.0022
        self.inj_g_per_ms = p["injFlowCc"] * p["fuelDensity"] / 60000  # g per ms per injector

    def demand(self, rpm):
        """kg/s the engine would breathe at ambient pressure."""
        return interp(VE_TABLE, rpm) * self.rho * self.vd * rpm / 120

    def throttle_cap(self, tps):
        return self.idle_air + 1.3 * self.choke * math.pow(clamp(tps, 0, 1), 1.8)

    def airflow(self, rpm, tps):
        d = self.demand(rpm)
        if d <= 0:
            return 0
        return soft_min(d, soft_min(self.choke, self.throttle_cap(tps)))

    def lambda_for(self, map_kpa):
        lw = self.p["lambdaWot"]
        if map_kpa > 85:
            return lw
        if map_kpa < 60:
            return 1.0
        return 1.0 + (lw - 1.0) * (map_kpa - 60) / 25

    @staticmethod
    def friction_w(rpm):
        # motoring losses, ~4 kW at 12k [assumption]
        return 2.0e-5 * rpm * rpm * 1.0 + 0.15 * rpm

    def state(self, rpm, tps):
        p = self.p
        air = self.airflow(rpm, tps)
        d = self.demand(rpm)
        mp = clamp(p["baroKPa"] * air / d, 15, p["baroKPa"]) if d > 0 else p["baroKPa"]
        lam = self.lambda_for(mp)
        fuel = air / (14.7 * lam)  # kg/s
        power_w = max(0, fuel * LHV * p["bte"] - self.friction_w(rpm))
        return {"air": air, "map": mp, "lam": lam, "fuel": fuel, "powerW": power_w}

    def dead_time(self, v):
        return self.p["deadTime14"] + self.p["deadTimeSlope"] * max(0, 14 - v)

    def dwell(self, v):
        return self.p["dwell14"] * 14 / max(v, 6)

    def injector(self, rpm, fuel_kg_s, v, cut):
        if cut or rpm <= 0:
            return {"pw": 0, "duty": 0, "effPw": 0}
        inj_per_sec = rpm / 120  # sequential, each injector once per cycle
        g_per_shot = fuel_kg_s * 1000 / (self.p["cyl"] * inj_per_sec)
        eff_pw = g_per_shot / self.inj_g_per_ms
        pw = eff_pw + self.dead_time(v)
        return {"pw": pw, "effPw": eff_pw, "duty": pw * rpm / 1200}


def engine_model(p):
    return EngineModel(p)


def gear_rpm(p, v, g):
    return v / (math.pi * p["tireD"]) * 60 * p["primary"] * p["gears"][g] * p["finalDrive"]


def simulate_lap(params=None):
    """One flying lap of the test track at 100 Hz: speed, gear, rpm, throttle, fuel, brakes."""
    p = with_defaults(params)
    eng = EngineModel(p)
    ds = 0.5

    # distance grid with corner speed limits
    vlim = []
    for seg in TRACK:
        if seg[0] == "S":
            length, vmax = seg[1], 40
        else:
            length = seg[1] * abs(seg[2]) * math.pi / 180
            vmax = math.sqrt(p["latG"] * G * seg[1])
        n = max(1, js_round(length / ds))
        vlim.extend([vmax] * n)
    N = len(vlim)
    lap_len = N * ds
    gears = p["gears"]

    def best_gear(v):
        best, best_f = 0, -1
        for g in range(len(gears)):
            rpm = gear_rpm(p, v, g)
            if rpm > p["shiftRpm"]:
                continue
            st = eng.state(max(rpm, 3000), 1)
            F = st["powerW"] / max(v, 1) * p["driveEff"]
            if F > best_f:
                best_f, best = F, g
        if best_f < 0:
            best = len(gears) - 1
        return best

    def wot_force(v):
        g = best_gear(v)
        rpm = max(gear_rpm(p, v, g), 3000)
        st = eng.state(min(rpm, p["revLimit"]), 1)
        return st["powerW"] * p["driveEff"] / max(v, 1)

    def resist(v):
        return 0.5 * 1.16 * p["cdA"] * v * v + p["crr"] * p["massKg"] * G

    # forward/backward passes over two laps, keep the second
    L2 = 2 * N
    v = [0.0] * L2
    v[0] = vlim[0] * 0.8
    for i in range(L2 - 1):
        a = min((wot_force(v[i]) - resist(v[i])) / p["massKg"], p["accelLimitG"] * G)
        v[i + 1] = min(vlim[(i + 1) % N], math.sqrt(max(0, v[i] * v[i] + 2 * a * ds)))
    for i in range(L2 - 2, -1, -1):
        v[i] = min(v[i], math.sqrt(v[i + 1] * v[i + 1] + 2 * p["brakeG"] * G * ds))

    # time along the second lap
    t_at = [0.0] * (N + 1)
    for i in range(N):
        v0, v1 = v[N + i], v[N + ((i + 1) % N)]
        t_at[i + 1] = t_at[i] + ds / max(0.5, (v0 + v1) / 2)
    lap_time = t_at[N]

    # resample at 100 Hz and compute engine/ECU state
    fs = 100
    M = math.floor(lap_time * fs)
    keys = ["t", "v", "gear", "rpm", "tps", "map", "lam", "pw", "duty", "dwell",
            "fuelGs", "powerKW", "coolKW", "cut", "brakeF", "brakeR", "brakeLight"]
    out = {k: [] for k in keys}
    light_on = False
    j = 0
    for k in range(M):
        t = k / fs
        while j < N - 1 and t_at[j + 1] < t:
            j += 1
        f = (t - t_at[j]) / max(1e-6, t_at[j + 1] - t_at[j])
        vj, v_next = v[N + j], v[N + ((j + 1) % N)]
        vi = vj + (v_next - vj) * f
        acc = (v_next * v_next - vj * vj) / (2 * ds)
        g = best_gear(vi)
        rpm = clamp(gear_rpm(p, vi, g), p["idleRpm"], p["revLimit"] + 200)
        f_req = p["massKg"] * acc + resist(vi)
        f_wot = wot_force(vi)
        if f_req <= 0:
            tps = 0
        elif f_req >= 0.98 * f_wot:
            tps = 1
        else:
            p_req = f_req * vi / p["driveEff"]
            lo, hi = 0, 1
            for _ in range(22):
                mid = (lo + hi) / 2
                if eng.state(rpm, mid)["powerW"] < p_req:
                    lo = mid
                else:
                    hi = mid
            tps = hi
        st = eng.state(rpm, tps)
        dfco = tps < 0.02 and rpm > 3000
        rev = rpm > p["revLimit"]
        cut = dfco or rev
        fuel = 0 if cut else st["fuel"]
        inj = eng.injector(rpm, fuel, p["vehicleV"], cut)
        dw = 0 if cut else eng.dwell(p["vehicleV"])
        out["t"].append(t); out["v"].append(vi * 3.6); out["gear"].append(g + 1); out["rpm"].append(rpm)
        out["tps"].append(tps * 100); out["map"].append(st["map"]); out["lam"].append(None if cut else st["lam"])
        out["pw"].append(inj["pw"]); out["duty"].append(inj["duty"]); out["dwell"].append(dw)
        out["fuelGs"].append(fuel * 1000); out["powerKW"].append(0 if cut else st["powerW"] / 1000)
        out["coolKW"].append(fuel * LHV * 0.25 / 1000 + 0)
        out["cut"].append(("rev" if rev else "dfco") if cut else "")
        # brake line pressures from the braking force the lap needs (front bias and bar per g [assumption])
        decel_g = -f_req / (p["massKg"] * G) if f_req < 0 else 0
        pf, pr = decel_g * p["brakeBarPerGF"], decel_g * p["brakeBarPerGR"]
        out["brakeF"].append(pf); out["brakeR"].append(pr)
        # brake light: on above brakeOnBar on either circuit, off below brakeOffBar (hysteresis)
        pmax = max(pf, pr)
        if not light_on and pmax > p["brakeOnBar"]:
            light_on = True
        elif light_on and pmax < p["brakeOffBar"]:
            light_on = False
        out["brakeLight"].append(1 if light_on else 0)

    # summary
    def total(a):
        s = 0
        for x in a:
            s += x or 0
        return s

    fuel_g = total(out["fuelGs"]) / fs
    wot_sweep = []
    for rpm in range(3000, 13001, 250):
        st = eng.state(rpm, 1)
        wot_sweep.append({"rpm": rpm, "kW": st["powerW"] / 1000, "nm": st["powerW"] / (rpm * 2 * math.pi / 60),
                          "map": st["map"], "airGs": st["air"] * 1000, "demandGs": eng.demand(rpm) * 1000})
    peak = wot_sweep[0]
    for b in wot_sweep:
        if b["kW"] > peak["kW"]:
            peak = b
    dead_sweep = []
    st_pk = eng.state(peak["rpm"], 1)
    vb = 8
    while vb <= 15.01:
        inj = eng.injector(peak["rpm"], st_pk["fuel"], vb, False)
        dead_sweep.append({"v": vb, "pw": inj["pw"], "dead": eng.dead_time(vb), "duty": inj["duty"], "dwell": eng.dwell(vb)})
        vb += 0.25
    max_rpm = jmax(out["rpm"])
    teeth = p["triggerTeeth"]
    bl = out["brakeLight"]
    return {
        "p": p, "lapLen": lap_len, "lapTime": lap_time, "fs": fs, "series": out,
        "chokeGs": eng.choke * 1000, "wotSweep": wot_sweep, "peak": peak, "deadSweep": dead_sweep,
        "stats": {
            "lapTime": lap_time, "lapLen": lap_len, "avgKmh": lap_len / lap_time * 3.6, "maxKmh": jmax(out["v"]),
            "fuelPerLapG": fuel_g, "fuelPerLapL": fuel_g / (p["fuelDensity"] * 1000),
            "maxDuty": jmax(out["duty"]), "maxPw": jmax(out["pw"]), "maxRpm": max_rpm,
            "wotPct": len([x for x in out["tps"] if x >= 99]) / M * 100,
            "peakKW": peak["kW"], "peakHp": peak["kW"] * 1.341, "peakRpm": peak["rpm"],
            "toothHzMax": teeth * max_rpm / 60, "toothHzCrank": teeth * 250 / 60,
            "dwellAvailMs": 120000 / max_rpm - p["dwell14"] * 14 / p["vehicleV"],
            "avgPowerKW": total(out["powerKW"]) / M,
            "maxBrakeF": jmax(out["brakeF"]), "maxBrakeR": jmax(out["brakeR"]),
            "brakeApps": sum(1 for i, x in enumerate(bl) if x and not (bl[i - 1] if i > 0 else 0)),
            "brakeLightPct": total(bl) / M * 100,
        },
    }


# Inline-4, flat-plane crank, firing order 1-2-4-3 (CBR600RR). Angles are crank
# degrees in the 720 deg cycle, 0 = cylinder 1 TDC on compression.
FIRING_ORDER = [1, 2, 4, 3]


def firing_events(params, rpm, tps):
    """Spark, dwell and injection angles for every cylinder at one rpm/throttle point."""
    p = with_defaults(params)
    eng = EngineModel(p)
    st = eng.state(rpm, tps)
    cut = (tps < 0.02 and rpm > 3000) or rpm > p["revLimit"]
    inj = eng.injector(rpm, 0 if cut else st["fuel"], p["vehicleV"], cut)
    load = st["map"] / p["baroKPa"]
    # base spark table shape [assumption: placeholder until the calibration in Calibration Plan]
    advance = clamp(10 + 25 * (rpm - p["idleRpm"]) / 8000, 10, 35) - 8 * load
    dwell_ms = 0 if cut else eng.dwell(p["vehicleV"])
    deg_per_ms = rpm * 6 / 1000
    eoi = 300  # end of injection, deg BTDC firing [assumption]
    cyl = []
    for k, c in enumerate(FIRING_ORDER):
        tdc = k * 180
        spark = tdc - advance
        cyl.append({"cyl": c, "tdc": tdc, "spark": spark,
                    "dwellStart": spark - dwell_ms * deg_per_ms,
                    "injEnd": tdc - eoi,
                    "injStart": tdc - eoi - inj["pw"] * deg_per_ms})
    cyl.sort(key=lambda x: x["cyl"])
    # 12-tooth crank wheel: tooth every 30 deg, none missing; cam: 1 sync tooth per cycle
    tooth_deg = 360 / p["triggerTeeth"]
    teeth = []
    for rev_ in range(2):
        for i in range(p["triggerTeeth"] - p["missingTeeth"]):
            teeth.append(rev_ * 360 + i * tooth_deg + 60)
    return {
        "rpm": rpm, "tps": tps, "map": st["map"], "lambda": st["lam"], "pw": inj["pw"], "duty": inj["duty"],
        "advance": advance, "dwellMs": dwell_ms, "cut": cut,
        "dwellDeg": dwell_ms * deg_per_ms, "injDeg": inj["pw"] * deg_per_ms, "cyl": cyl, "teeth": teeth,
        "toothDeg": tooth_deg, "camDeg": 650,
        "cycleMs": 120000 / max(rpm, 1), "powerKW": 0 if cut else st["powerW"] / 1000,
    }
