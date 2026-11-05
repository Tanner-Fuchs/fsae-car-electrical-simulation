"""Dash computer load: Raspberry Pi 5 / 4 / 3B+ / Zero 2 W running Linux, or a Pico / Pico 2 running firmware.

The dash computer reads every frame on the CAN bus, logs it to the SD card, draws the driver's
display, optionally shows a live CAN viewer and sends a few channels to the pits over LoRa. It may
also read the IMU (I2C) and GPS (UART) for the logger, since those stay off CAN [Tanner 2026-10-27].

Every per-task cost below is an estimate [assumption], written as the time one Pi 5 core
(Cortex-A76, 2.4 GHz) spends on it; slower boards scale by their speed relative to the Pi 5.
Memory per process is a typical resident size [assumption]. The point is the comparison between
boards and settings, not the third digit: measure the real software on the bench before buying.
"""
import math

from .can import can_messages
from .params import with_defaults

# speed: work per core relative to one Pi 5 core [assumption, from published single-core benchmarks]
BOARDS = {
    "pi5":    {"bootS": 6, "label": "Raspberry Pi 5", "linux": True, "cores": 4, "cpu": "4 × Cortex-A76 2.4 GHz", "speed": 1.0,
               "ramGB": [2, 4, 8, 16], "price": {2: 50, 4: 60, 8: 80, 16: 120}, "sdMBs": 40,
               "idleW": 2.7, "maxW": 9.5, "supplyA": 5.0, "displays": ["dsi", "hdmi", "spi"],
               "note": "5 V 5 A supply for full USB power; on 3 A it limits USB to 600 mA"},
    "pi4":    {"bootS": 11, "label": "Raspberry Pi 4", "linux": True, "cores": 4, "cpu": "4 × Cortex-A72 1.8 GHz", "speed": 0.42,
               "ramGB": [1, 2, 4, 8], "price": {1: 35, 2: 45, 4: 55, 8: 75}, "sdMBs": 22,
               "idleW": 2.7, "maxW": 6.4, "supplyA": 3.0, "displays": ["dsi", "hdmi", "spi"], "note": "5 V 3 A"},
    "pi3":    {"bootS": 18, "label": "Raspberry Pi 3 B+", "linux": True, "cores": 4, "cpu": "4 × Cortex-A53 1.4 GHz", "speed": 0.22,
               "ramGB": [1], "price": {1: 35}, "sdMBs": 18,
               "idleW": 1.9, "maxW": 5.1, "supplyA": 2.5, "displays": ["dsi", "hdmi", "spi"], "note": "5 V 2.5 A"},
    "zero2":  {"bootS": 24, "label": "Raspberry Pi Zero 2 W", "linux": True, "cores": 4, "cpu": "4 × Cortex-A53 1.0 GHz", "speed": 0.16,
               "ramGB": [0.5], "price": {0.5: 15}, "sdMBs": 18,
               "idleW": 0.6, "maxW": 3.0, "supplyA": 2.5, "displays": ["hdmi", "spi"], "note": "mini HDMI only, no DSI connector"},
    "pico":   {"bootS": 0.3, "label": "Raspberry Pi Pico (RP2040)", "linux": False, "cores": 2, "cpu": "2 × Cortex-M0+ 133 MHz", "speed": 1.0,
               "ramKB": 264, "price": 4, "sdMBs": 0.6, "idleW": 0.1, "maxW": 0.35, "supplyA": 0.1, "displays": ["spi"],
               "note": "no operating system: one firmware program; SPI screen up to about 480 × 320"},
    "pico2":  {"bootS": 0.3, "label": "Raspberry Pi Pico 2 (RP2350)", "linux": False, "cores": 2, "cpu": "2 × Cortex-M33 150 MHz", "speed": 1.7,
               "ramKB": 520, "price": 5, "sdMBs": 0.8, "idleW": 0.1, "maxW": 0.4, "supplyA": 0.1, "displays": ["spi"],
               "note": "no operating system: one firmware program; SPI screen up to about 480 × 320"},
}

DISPLAYS = {
    "5in-hdmi": {"label": '5 in 800 × 480 TFT, HDMI + USB touch [Tanner: 5 in TFT]', "w": 800, "h": 480, "port": "hdmi", "W": 2.5},
    "5in-dsi": {"label": '5 in 800 × 480 TFT, DSI ribbon', "w": 800, "h": 480, "port": "dsi", "W": 2.0},
    "800x480": {"label": '7 in 800 × 480 (official DSI touch screen)', "w": 800, "h": 480, "port": "dsi", "W": 2.5},
    "1024x600": {"label": '7 in 1024 × 600 (HDMI)', "w": 1024, "h": 600, "port": "hdmi", "W": 3.0},
    "1280x720": {"label": '1280 × 720 (HDMI)', "w": 1280, "h": 720, "port": "hdmi", "W": 4.0},
    "480x320": {"label": '3.5 in 480 × 320 (SPI)', "w": 480, "h": 320, "port": "spi", "W": 0.5},
}

# OS image: resident memory after boot and background CPU (% of one Pi 5 core)
OS_IMAGES = {
    "lite": {"label": "Raspberry Pi OS Lite (no desktop)", "ramMB": 170, "cpu": 1.0, "boot": 1.0},
    "desktop": {"label": "Raspberry Pi OS with desktop", "ramMB": 520, "cpu": 3.0, "boot": 1.8},
    "minimal": {"label": "Custom minimal image (Buildroot / Yocto)", "ramMB": 45, "cpu": 0.5, "boot": 0.4},
}

# dash renderer: CPU ms per frame at 800 x 480 on a Pi 5 core, memory MB, and whether it uses the GPU
RENDERERS = {
    "qt": {"label": "Qt Quick (C++ / QML, GPU)", "startS": 1.5, "ms": 1.2, "ramMB": 90, "gpu": True, "threads": 1},
    "lvgl": {"label": "LVGL (C, CPU drawn)", "startS": 0.3, "ms": 2.5, "ramMB": 12, "gpu": False, "threads": 1},
    "pygame": {"label": "Pygame (Python)", "startS": 2.0, "ms": 6.0, "ramMB": 55, "gpu": False, "threads": 1},
    "chromium": {"label": "Web page in Chromium kiosk", "startS": 6.0, "ms": 8.0, "ramMB": 380, "gpu": True, "threads": 2},
}

# CAN interface: kernel time per received frame (Pi 5 core us) and how it copes with bursts
CAN_IFACES = {
    "mcp2515": {"label": "MCP2515 HAT on SPI (2 receive buffers)", "us": 22, "buffers": 2,
                "note": "only 2 receive buffers: Linux must answer each interrupt within about 2 frame times"},
    "mcp2518fd": {"label": "MCP2518FD HAT on SPI (31-frame FIFO)", "us": 9, "buffers": 31, "note": "deep receive FIFO"},
    "usb": {"label": "USB adapter (CANable / gs_usb)", "us": 4, "buffers": 64, "note": "adapter buffers and batches frames"},
}

LANGS = {
    # per CAN frame: decode, log binary, log CSV, viewer update (Pi 5 core us); process memory MB
    "c": {"label": "C / C++ / Rust", "decode": 1.5, "logBin": 0.5, "logCsv": 2.0, "view": 0.5, "procMB": 3, "imuUs": 30, "redrawMs": 1.0},
    "python": {"label": "Python", "decode": 20, "logBin": 6, "logCsv": 15, "view": 5, "procMB": 32, "imuUs": 80, "redrawMs": 8.0},
}

PI_DEFAULTS = {
    "board": "pi5", "ramGB": 2, "os": "lite", "lang": "python", "renderer": "qt", "display": "5in-hdmi", "fps": 30,
    "canIface": "mcp2518fd", "logFormat": "binary", "bufS": 5, "viewer": True, "viewerHistS": 60,
    "imu": True, "imuHz": 200, "gps": True, "gpsHz": 10,
    "lora": True, "loraHz": 5, "loraBytes": 32, "loraSF": 7, "loraBW": 125,
    "endurMin": 30,
    "specRamPct": 70, "specCorePct": 70,     # the team's spec: headroom kept free [assumption, change to suit]
}


def pi_defaults(o=None):
    out = dict(PI_DEFAULTS)
    out.update({k: v for k, v in (o or {}).items() if v is not None})
    return out


def lora_airtime(payload, sf, bw_khz, cr=1, preamble=8, explicit=True, crc=True):
    """Time on air of one LoRa packet in ms (Semtech SX127x datasheet formula)."""
    ts = (2 ** sf) / (bw_khz * 1000) * 1000          # symbol time, ms
    de = 1 if ts > 16 else 0                         # low data rate optimise
    h = 0 if explicit else 1
    num = 8 * payload - 4 * sf + 28 + 16 * (1 if crc else 0) - 20 * h
    n = 8 + max(math.ceil(num / (4 * (sf - 2 * de))) * (cr + 4), 0)
    return (preamble + 4.25) * ts + n * ts


def can_load(p):
    msgs = can_messages(p)
    fps = sum(m["hz"] for m in msgs)
    return msgs, fps


def _pack(procs, cores):
    """Put each single-threaded process on the least busy core (the scheduler does about this)."""
    load = [0.0] * cores
    for pr in sorted(procs, key=lambda x: -x["cpu"]):
        n = pr.get("threads", 1)
        share = pr["cpu"] / n
        for _ in range(n):
            i = load.index(min(load))
            load[i] += share
            pr.setdefault("cores", []).append(i)
    return load


def _linux(bk, b, ram_gb, o, fps, disp):
    lang, rend, iface, osi = LANGS[o["lang"]], RENDERERS[o["renderer"]], CAN_IFACES[o["canIface"]], OS_IMAGES[o["os"]]
    s = 1 / b["speed"]                    # cost multiplier vs a Pi 5 core
    bpf = 24 if o["logFormat"] == "binary" else 46       # bytes per logged frame [assumption]
    log_bps = fps * bpf + (o["imuHz"] * 28 if o["imu"] else 0) + (o["gpsHz"] * 80 if o["gps"] else 0)
    px = disp["w"] * disp["h"]
    procs = [
        {"name": "Linux + services", "cpu": osi["cpu"] * s, "ram": osi["ramMB"], "what": osi["label"]},
        {"name": "GPU / display memory", "cpu": 0, "ram": 64 + (192 if rend["gpu"] else 0), "what": "reserved for the GPU (CMA) [assumption]"},
        {"name": "CAN driver (kernel)", "cpu": fps * iface["us"] * 1e-4 * s, "ram": 1, "what": iface["label"]},
        {"name": "can-reader", "cpu": fps * lang["decode"] * 1e-4 * s, "ram": lang["procMB"], "what": "decodes every frame, shares values"},
        {"name": "logger", "cpu": fps * (lang["logBin"] if o["logFormat"] == "binary" else lang["logCsv"]) * 1e-4 * s,
         "ram": lang["procMB"] + o["bufS"] * log_bps / 1e6, "what": f"{o['logFormat']} log, {o['bufS']} s write buffer"},
        {"name": "dash", "cpu": o["fps"] * rend["ms"] * px / 384000 * 0.1 * s, "ram": rend["ramMB"] + 3 * px * 4 / 1e6,
         "what": f"{rend['label']}, {disp['w']} × {disp['h']} at {o['fps']} fps", "threads": rend["threads"]},
    ]
    if o["viewer"]:
        procs.append({"name": "can-viewer", "cpu": (fps * lang["view"] * 1e-4 + 10 * lang["redrawMs"] * 0.1) * s,
                      "ram": lang["procMB"] + 15 + o["viewerHistS"] * fps * 32 / 1e6, "what": f"live frame table, {o['viewerHistS']} s history"})
    if o["imu"] or o["gps"]:
        procs.append({"name": "imu-gps", "cpu": ((o["imuHz"] * lang["imuUs"] if o["imu"] else 0) + (o["gpsHz"] * 200 if o["gps"] else 0)) * 1e-4 * s,
                      "ram": lang["procMB"], "what": f"IMU {o['imuHz']} Hz (I2C), GPS {o['gpsHz']} Hz (UART)"})
    if o["lora"]:
        procs.append({"name": "lora-telemetry", "cpu": o["loraHz"] * (0.2 if o["lang"] == "c" else 1.0) * 0.1 * s, "ram": lang["procMB"] - 1,
                      "what": f"{o['loraBytes']} B at {o['loraHz']} Hz"})
    cores = _pack(procs, b["cores"])
    ram_mb = ram_gb * 1024
    used = sum(pr["ram"] for pr in procs)
    total_cpu = sum(cores) / b["cores"]
    w = b["idleW"] + (b["maxW"] - b["idleW"]) * min(1.0, total_cpu / 100)
    fails, warns = [], []
    if used / ram_mb * 100 > o["specRamPct"]:
        fails.append(f"memory {used / ram_mb * 100:.0f} % used, over the {o['specRamPct']} % spec")
    if max(cores) > o["specCorePct"]:
        fails.append(f"busiest core {max(cores):.0f} %, over the {o['specCorePct']} % spec")
    if max(cores) > 100:
        fails.append("a core is past 100 %: frames back up and the screen stutters")
    if disp["port"] not in b["displays"]:
        fails.append(f"no {disp['port'].upper()} connector for this screen")
    if o["canIface"] == "mcp2515" and fps > 1500:
        warns.append(f"MCP2515 has 2 receive buffers; at {fps} frames/s Linux interrupt delays can drop frames")
    amps = (w + disp["W"]) / 5.0
    if amps > 4.0:
        warns.append(f"board + screen draw about {amps:.1f} A at 5 V, over 80 % of the 5 A screen/dash supply module")
    boot = b["bootS"] * osi["boot"] + (rend["startS"] + (1.0 if o["lang"] == "python" else 0.1)) / b["speed"]
    if boot > 20:
        warns.append(f"about {boot:.0f} s from power on to the dash; a custom minimal image boots much faster")
    if o["renderer"] == "chromium" and b["speed"] < 0.3:
        warns.append("Chromium on this board is slow to start (tens of seconds)")
    return {"key": bk, "ramGB": ram_gb, "procs": procs, "cores": cores, "totalCpu": total_cpu, "busiest": max(cores),
            "ramMB": ram_mb, "usedMB": used, "ramPct": used / ram_mb * 100, "logBps": log_bps, "watts": w,
            "amps": (w + disp["W"]) / 5.0, "fails": fails, "warns": warns, "ok": not fails, "price": b["price"][ram_gb], "bootS": boot}


def _pico(bk, b, o, fps, disp):
    """Bare-metal firmware in C: everything is one program, costs in us on this core."""
    m0 = 1 / b["speed"]                                   # Pico (M0+) = 1, Pico 2 faster
    bpf = 24 if o["logFormat"] == "binary" else 46
    log_bps = fps * bpf + (o["imuHz"] * 28 if o["imu"] else 0) + (o["gpsHz"] * 80 if o["gps"] else 0)
    sd_stall_s = 0.25                                     # SD cards can pause writes this long [assumption]
    can_us = 25 + 5 + (3 if o["logFormat"] == "binary" else 30)     # SPI read, decode, log per frame (M0+ us) [assumption]
    px = disp["w"] * disp["h"]
    fits_screen = px <= 480 * 320
    procs = [
        {"name": "firmware + FatFs + drivers", "cpu": 1.0 * m0, "ram": 30, "what": "core 0"},
        {"name": "CAN (MCP2515) + decode + log", "cpu": fps * can_us * 1e-4 * m0, "ram": fps * 0.05 * 16 / 1024, "what": "core 0, 50 ms receive ring"},
        {"name": "SD write buffer", "cpu": 0.5 * m0, "ram": 2 * sd_stall_s * log_bps / 1024, "what": "double buffer covering a 250 ms card stall"},
        {"name": "dash (LVGL, SPI screen)", "cpu": min(o["fps"], 30) * 10.0 * min(px, 153600) / 153600 * 0.1 * m0,
         "ram": min(px, 153600) * 2 / 10 / 1024 + 20, "what": "core 1, 1/10 screen draw buffer", "core": 1},
    ]
    if o["imu"] or o["gps"]:
        procs.append({"name": "IMU + GPS", "cpu": ((o["imuHz"] * 60 if o["imu"] else 0) + (o["gpsHz"] * 300 if o["gps"] else 0)) * 1e-4 * m0, "ram": 2, "what": "core 0"})
    if o["lora"]:
        procs.append({"name": "LoRa", "cpu": o["loraHz"] * 0.3 * 0.1 * m0, "ram": 2, "what": "core 1", "core": 1})
    if o["viewer"]:
        procs.append({"name": "CAN viewer (USB serial stream)", "cpu": fps * 4 * 1e-4 * m0, "ram": 4, "what": "no screen app: streams frames to a laptop", "core": 1})
    cores = [0.0, 0.0]
    for pr in procs:
        c = pr.get("core", 0)
        cores[c] += pr["cpu"]
        pr["cores"] = [c]
    used = sum(pr["ram"] for pr in procs)
    ram_kb = b["ramKB"]
    fails = []
    if used / ram_kb * 100 > o["specRamPct"]:
        fails.append(f"memory {used / ram_kb * 100:.0f} % of {ram_kb} KB, over the {o['specRamPct']} % spec")
    if max(cores) > o["specCorePct"]:
        fails.append(f"busiest core {max(cores):.0f} %, over the {o['specCorePct']} % spec")
    if not fits_screen or disp["port"] != "spi":
        fails.append("can't drive this screen: no HDMI or DSI, SPI screens only (about 480 × 320)")
    if log_bps > b["sdMBs"] * 1e6 * 0.5:
        fails.append("SD writes over SPI too slow for this log rate")
    warns = ["no operating system: no CAN viewer app, no Wi-Fi on the plain Pico, updates by reflashing"]
    if o["viewer"]:
        warns.append("the CAN viewer is a USB serial stream to a laptop, not an app on the dash")
    return {"key": bk, "ramGB": None, "procs": procs, "cores": cores, "totalCpu": sum(cores) / 2, "busiest": max(cores),
            "ramMB": ram_kb / 1024, "usedMB": used / 1024, "ramPct": used / ram_kb * 100, "logBps": log_bps,
            "watts": b["maxW"], "amps": (b["maxW"] + DISPLAYS["480x320"]["W"]) / 5.0, "fails": fails, "warns": warns,
            "ok": not fails, "price": b["price"], "ramKB": ram_kb, "usedKB": used, "bootS": b["bootS"]}


def simulate_pi(p=None, o=None):
    p = with_defaults(p or {})
    o = pi_defaults(o)
    msgs, fps = can_load(p)
    disp = DISPLAYS[o["display"]]
    rows = []
    for bk, b in BOARDS.items():
        if b["linux"]:
            for g in b["ramGB"]:
                rows.append(_linux(bk, b, g, o, fps, disp))
        else:
            spi = DISPLAYS["480x320"] if disp["port"] != "spi" else disp
            r = _pico(bk, b, o, fps, spi)
            if disp["port"] != "spi":
                r["fails"].append(f"can't drive the {disp['w']} × {disp['h']} screen: SPI screens only")
                r["ok"] = False
            rows.append(r)
    b = BOARDS[o["board"]]
    ram = o["ramGB"] if b["linux"] and o["ramGB"] in b["ramGB"] else (b["ramGB"][0] if b["linux"] else None)
    sel = next(r for r in rows if r["key"] == o["board"] and r["ramGB"] == ram)
    air = lora_airtime(o["loraBytes"], o["loraSF"], o["loraBW"])
    lora = {"airtimeMs": air, "dutyPct": air * o["loraHz"] / 10, "maxHz": 1000 / air,
            "bps": o["loraBytes"] * 8 * o["loraHz"], "dwellOk": air <= 400}
    log_bps = sel["logBps"]
    return {
        "o": o, "fps": fps, "msgs": msgs, "board": {k: v for k, v in b.items()}, "boardKey": o["board"], "ramGB": ram,
        "sel": sel, "rows": rows, "lora": lora, "display": disp,
        "logKBs": log_bps / 1024, "logMBendur": log_bps * o["endurMin"] * 60 / 1e6, "logGBday": log_bps * 3600 * 4 / 1e9,
        "boards": BOARDS, "displays": DISPLAYS, "osImages": OS_IMAGES, "renderers": RENDERERS, "canIfaces": CAN_IFACES, "langs": LANGS,
    }
