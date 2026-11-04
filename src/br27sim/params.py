"""Inputs to every model: defaults, battery options and the test lap.

Every default is tagged with where it came from:
  [form: <name>]  value taken from a BR27 concept form
  [rules X.Y]     FSAE 2027 rules
  [Tanner]        stated by Tanner in the project
  [assumption]    placeholder until measured or chosen; change it in the page

Parameter names stay camelCase because the browser page reads and writes them
by these exact names.
"""
import copy

G = 9.81
R_AIR = 287
LHV = 43e6  # J/kg gasoline

DEFAULTS = {
    # vehicle and drive cycle
    "massKg": 288.6,          # car + driver: 216 kg curb target [Master Timeline, Chapter One] + 72.6 kg (160 lb) driver [Tanner 2026-11-04]
    "tireD": 0.406,           # tire diameter: Hoosier R20 16x7.5-10 (16 in tire on 10 in wheels) [form: VD Tire Model Data #1]
    "cdA": 1.1,               # m^2 [assumption]
    "crr": 0.015,             # [assumption]
    "driveEff": 0.90,         # chain + gearbox [assumption]
    "accelLimitG": 1.1,       # traction limit [assumption]
    "latG": 1.4,              # cornering [assumption]
    "brakeG": 1.5,            # [assumption]
    "primary": 2.111,         # 2007-12 CBR600RR primary 76/36 [Honda spec, verify]
    "gears": [2.666, 1.937, 1.661, 1.409, 1.260, 1.166],  # 2007-12 CBR600RR [Honda spec, verify]
    "finalDrive": 3.385,      # 13:44 sprockets [assumption]

    # engine: 2012 Honda CBR600RR, 67 x 42.5 mm [form: ECU CBR600RR Engine Integration]
    "dispL": 0.599,
    "cyl": 4,
    "restrictorMM": 20.0,     # gasoline [rules IC.1.6]
    "restrictorCd": 0.95,     # [assumption]
    "ambientC": 30,           # [assumption]
    "baroKPa": 101.3,
    "shiftRpm": 11500,        # [assumption]
    "revLimit": 12500,        # [assumption]
    "idleRpm": 1800,          # target >= 1800 [form: Charging System]
    "bte": 0.30,              # brake thermal efficiency, gives ~70 hp restricted [assumption]
    "lambdaWot": 0.88,        # [form: Calibration Plan]
    "injFlowCc": 210,         # cc/min per stock primary injector [forum, verify on bench]
    "injOhm": 12,             # high impedance [form: ECU CBR600RR, verify]
    "deadTime14": 0.9,        # ms at 14 V [assumption]
    "deadTimeSlope": 0.22,    # ms per volt below 14 V [assumption]
    "fuelDensity": 0.745,
    "dwell14": 2.0,           # ms at 14 V, stock passive stick coils, keep under ~2.5 ms [forum, verify]
    "coilPeakA": 7,           # [assumption]
    "triggerTeeth": 12,       # stock 12 even-tooth VR crank wheel [form: ECU CBR600RR, verify with scope]
    "missingTeeth": 0,        # no gap; the cam sync tooth gives the phase
    "vehicleV": 14.2,         # battery voltage used for the lap fuel calc (V)

    # brakes: pressure sensors on the front and rear circuits [Tanner], brake light state on CAN
    "brakeBarPerGF": 40,      # front line pressure per g of braking [assumption]
    "brakeBarPerGR": 24,      # rear [assumption]
    "brakeOnBar": 3.0,        # brake light on [assumption]
    "brakeOffBar": 2.0,       # brake light off (hysteresis) [assumption]
    "brakeLightA": 0.3,       # LED brake light [assumption]

    # power system
    "battery": "lfp4",        # NOCO NLP14 [Tanner]
    "soc0": 95,
    "regType": "series",      # series MOSFET regulator [form: Charging System]
    "regSet": 14.4,           # V [form: Charging System, 14.2-14.6]
    "regFault": "none",       # none | open | overcharge
    "regFaultMin": 20,
    "statorSat": 30,          # A, fit to 26 A @ 5000 rpm and ~10 A at idle [form: Charging System]
    "statorK": 1973,
    "stagingMin": 5,
    "changeMin": 3,           # driver change [rules D.12.8]
    "keyOnDuringChange": True,
    "fanWhenOff": False,
    "mainBreakerA": 100,      # manual-reset main breaker between battery and PMS [proposal, T.9.2.2]
    "starterA": 130,          # [form: Charging System, verify]
    "cableMOhm": 6,           # main cable + master switch [form: Charging System, 15 mOhm total]
    "fanOnC": 95, "fanOffC": 90, "fanA": 6,
    "pumpA": 5, "ecuA": 0.5, "dashA": 0.5, "loggerA": 0.5, "miscA": 0.5, "widebandA": 1.5,
    "killRelayA": 0.15,       # kill relay coil [assumption]
    "nodeLoad5V": {"FL": 0.22, "FR": 0.18, "RL": 0.22, "RR": 0.18},  # A on each corner node's 5 V rail [assumption]
    "nodeQuiescentA": 0.01,
    "buckEff": 0.88,          # LT8609S at light load [form: 5V Buck Converter]
    "ecuMinV": 6.0,           # EMU Black brown-out [assumption, verify with Ecumaster]
    "endurKm": 22,            # [rules D.12]

    # CAN / DAQ [form: Sample Rates per Channel; layout per Tanner 2026-10-27]
    "canLayout": "classic",   # everything on CAN 2.0 [Tanner 2026-10-27]
    "bitrate": 1000000,       # nominal / classic bitrate, proposed, not confirmed [form: Sample Rates]
    "fdDataRate": 5000000,    # CAN FD data phase [assumption: 5 Mbps transceiver class]
    "emuRate": 100,
    "emuFrames": 8,
    "packSusp": False,
    # no suspension pots on BR27 [Tanner 2026-10-27]; corner frames then run at the 200 Hz wheel speed/brake rate
    "suspPots": False,
    "stuffing": "worst",
    "extraFrames": 0,
    # dash MCU is the logger and sends shared values back out to the nodes [Tanner]; count and rate are assumptions
    "dashFwdFrames": 2, "dashFwdHz": 20,
    # IMU and GPS wire straight into the dash MCU (the logger), so they stay off CAN [Tanner]
    "imuGpsOnCan": False,
    "ber": 0,
    "nodeOffline": "none",
    "jitterUs": 50,
    "canSimMs": 1000,

    # CAN physical layer: EMU Black at one end, custom dash at the other [Tanner]
    "trunkPtM": 1.5, "trunkChM": 5.0, "trunkAllM": 6.0,  # [assumption, set from the 3D route in the page]
    "stubM": 0.10,            # [assumption]
    "termEnd1": True,
    "termEnd2": True,
    "termExtra": False,       # someone left a 120 ohm on a node
    "emuTerm": False,         # EMU Black software-selectable 120 ohm; must stay OFF mid-bus [Tanner]
    "samplePoint": 0.80,
    "trxLoopNs": 180,         # transceiver loop delay [assumption, TJA1051 class]
}

# Battery options. "lfp4" is the default because Tanner said 4 Ah 12 V lithium.
BATTERIES = {
    "lfp4": {"label": "NOCO NLP14 (4 Ah LiFePO4, 500 A)", "capAh": 4, "rMOhm": 12, "r1MOhm": 8, "tau": 25,
             "maxDischargeA": 250, "chem": "lfp", "massKg": 1.17,
             "note": "[Tanner: NOCO NLP14] 12.8 V, 4 Ah, 51.2 Wh, 500 A starting, 1.17 kg, 149×87×93 mm (retailer listing). Resistance and BMS limit estimated from the 500 A rating."},
    "lipo3s4": {"label": "4 Ah 3S LiPo (11.1 V nominal)", "capAh": 4, "rMOhm": 12, "r1MOhm": 8, "tau": 25,
                "maxDischargeA": 200, "chem": "lipo", "massKg": 0.35, "note": "Full charge is 12.6 V. Any 14 V charging system overcharges it."},
    "lfp8": {"label": "8 Ah 12 V LiFePO4 (charging form pick)", "capAh": 8, "rMOhm": 9, "r1MOhm": 6, "tau": 30,
             "maxDischargeA": 240, "chem": "lfp", "massKg": 1.0, "note": "[form: Charging System]"},
    "agm": {"label": "AGM YTZ10S (fallback)", "capAh": 8.6, "rMOhm": 18, "r1MOhm": 12, "tau": 40,
            "maxDischargeA": 400, "chem": "agm", "massKg": 3.4, "note": "[form: Battery Mounting]"},
}

# Open circuit voltage vs state of charge (%)
OCV = {
    "lfp": [[0, 10.0], [5, 12.0], [10, 12.8], [20, 13.0], [30, 13.1], [50, 13.2], [70, 13.3], [90, 13.4], [95, 13.45], [98, 13.6], [100, 14.2]],
    "lipo": [[0, 9.6], [5, 10.5], [10, 10.9], [20, 11.2], [40, 11.5], [60, 11.7], [80, 12.0], [90, 12.25], [100, 12.6]],
    "agm": [[0, 11.6], [20, 11.9], [40, 12.15], [60, 12.4], [80, 12.6], [100, 12.85]],
}
BATT_LIMITS = {
    "lfp": {"cutoff": 10.0, "overV": 14.8},
    "lipo": {"cutoff": 9.6, "overV": 12.7},
    "agm": {"cutoff": 10.5, "overV": 15.0},
}

# A generic endurance-style lap. Not the competition track: straights and
# corner radii are in the range FSAE endurance courses use.
# ['S', length m] or ['C', radius m, turn degrees]
TRACK = [
    ["S", 70], ["C", 12, 90], ["S", 40], ["C", 25, 60], ["S", 55], ["C", 6, 180],
    ["S", 60], ["C", 15, 45], ["C", 15, -45], ["C", 15, 45], ["C", 15, -45], ["S", 35],
    ["C", 20, 120], ["S", 75], ["C", 9, 90], ["S", 30], ["C", 30, 90], ["S", 50],
    ["C", 8, 150], ["S", 45], ["C", 18, -70], ["S", 40], ["C", 11, 80],
]


def with_defaults(p=None):
    """DEFAULTS overlaid with the given parameters (missing keys keep their default)."""
    out = copy.deepcopy(DEFAULTS)
    out.update(p or {})
    out["nodeLoad5V"] = {**DEFAULTS["nodeLoad5V"], **((p or {}).get("nodeLoad5V") or {})}
    return out
