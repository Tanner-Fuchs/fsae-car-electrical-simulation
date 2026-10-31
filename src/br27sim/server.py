"""Local web server: serves the simulator page and runs the model in Python for it.

    br27sim serve            # opens http://127.0.0.1:8027 in your browser
"""
import json
import threading
import traceback
import webbrowser
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import urllib.parse

from . import JS_API, cad, can, components, engine, faults, params, shutdown, wiring
from .jsonio import dumps

WEB = Path(__file__).resolve().parent / "web"
# Libraries are bundled (Chart.js 4.4.1, three.js 0.128.0) so the page works offline.
LIBS = ["vendor/chart-4.4.1.umd.js", "vendor/three-0.128.0.min.js", "vendor/OrbitControls-0.128.0.js"]
SCRIPTS = ["bridge.js", "charts.js", "engine.js", "car3d.js", "harness3d.js", "app.js"]
TYPES = {".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json"}

# Shows any script error on the page instead of leaving it blank.
ERROR_BOX = """<script>
window.BRShowError = function (where, e) {
  var box = document.getElementById('loadErr');
  if (!box) { box = document.createElement('div'); box.id = 'loadErr'; document.body.prepend(box); }
  box.style.cssText = 'margin:12px 16px;padding:10px 12px;border:1px solid #d03b3b;border-radius:8px;font:13px/1.4 system-ui,sans-serif;background:rgba(208,59,59,.08);color:inherit;white-space:pre-wrap';
  var msg = (e && (e.message || e)) + '';
  box.insertAdjacentHTML('beforeend', '<div><b>Something failed in ' + where + ':</b> ' + msg.replace(/</g, '&lt;') + '</div>');
};
window.addEventListener('error', function (ev) { window.BRShowError('a script', ev.message + (ev.lineno ? ' (line ' + ev.lineno + ')' : '')); });
</script>"""


def index_html():
    page = (WEB / "page.html").read_text(encoding="utf-8")
    tags = "\n".join(f'<script src="/{s}"></script>' for s in LIBS + SCRIPTS)
    return page + "\n" + ERROR_BOX + "\n" + tags + "\n"


def constants():
    fault_list = []
    for f in faults.FAULTS:
        fault_list.append({**f, "scenarioAt3": f["scenario"](3)})
    return {
        "DEFAULTS": params.DEFAULTS, "BATTERIES": params.BATTERIES, "TRACK": params.TRACK,
        "SHUTDOWN_SWITCHES": shutdown.SHUTDOWN_SWITCHES, "FIRING_ORDER": engine.FIRING_ORDER,
        "CAN_LAYOUTS": can.CAN_LAYOUTS, "BUS_INFO": can.BUS_INFO,
        "FAULTS": fault_list, "FAULT_BANDS": faults.FAULT_BANDS, "WHEEL_DEFAULTS": components.WHEEL_DEFAULTS,
        "IR_DEFAULTS": components.IR_DEFAULTS, "IR_TARGETS": components.IR_TARGETS, "STEER_DEFAULTS": components.STEER_DEFAULTS,
        "FUNCTIONS": sorted(JS_API),
    }


def wiring_bundle():
    funcs = ["components", "schematicSVG", "fuelSystemSVG", "bulkheadCount", "wireList"]
    out = {k: getattr(wiring, k) for k in ["BLACK", "GREY", "FUSES", "ROWS", "DEVICES", "CONNECTORS", "STATUS", "STATUS_LABEL"]}
    out.update({k: getattr(wiring, wiring.PY_NAMES[k])() for k in funcs})
    out["FUNCTIONS"] = funcs
    return out


@lru_cache(maxsize=8)
def _lap(key):
    return engine.simulate_lap(json.loads(key))


def cached_lap(p):
    return _lap(json.dumps(p, sort_keys=True))


def call(name, args):
    if name not in JS_API:
        raise KeyError(f"unknown model function {name!r}")
    if name == "simulateLap":
        return cached_lap(args[0] if args else {})
    args = [cached_lap(a["__lap__"]) if isinstance(a, dict) and "__lap__" in a else a for a in args]
    return JS_API[name](*args)


class Handler(BaseHTTPRequestHandler):
    server_version = "br27sim"

    def log_message(self, fmt, *args):  # keep the terminal quiet
        pass

    def send(self, code, body, ctype="application/json"):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        try:
            if path in ("/", "/index.html"):
                return self.send(200, index_html(), "text/html")
            if path == "/api/constants":
                return self.send(200, dumps(constants()))
            if path == "/api/wiring":
                return self.send(200, dumps(wiring_bundle()))
            if path == "/api/cad":
                return self.send(200, dumps(cad.summary()))
            if path.startswith("/cad-files/"):
                name = urllib.parse.unquote(path[len("/cad-files/"):])
                f = (cad.data_dir() / name).resolve()
                if f.parent == cad.data_dir().resolve() and f.is_file():
                    return self.send(200, f.read_bytes(), "model/stl")
            f = (WEB / path.lstrip("/")).resolve()
            if WEB in f.parents and f.is_file():
                return self.send(200, f.read_bytes(), TYPES.get(f.suffix, "application/octet-stream"))
            self.send(404, "not found", "text/plain")
        except Exception:
            self.send(500, traceback.format_exc(), "text/plain")

    def do_POST(self):
        path, _, query = self.path.partition("?")
        if path in ("/api/cad/upload", "/api/cad/update"):
            try:
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                if path == "/api/cad/upload":
                    q = urllib.parse.parse_qs(query)
                    cad.add_file(q.get("name", ["part.stl"])[0], body, q.get("role", ["other"])[0])
                    return self.send(200, dumps(cad.summary()))
                return self.send(200, dumps(cad.update(json.loads(body or b"{}"))))
            except Exception as e:
                return self.send(400, str(e), "text/plain")
        if not path.startswith("/api/call/"):
            return self.send(404, "not found", "text/plain")
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            result = call(path[len("/api/call/"):], body.get("args") or [])
            self.send(200, dumps(result))
        except Exception:
            self.send(500, traceback.format_exc(), "text/plain")


def make_server(host="127.0.0.1", port=8027):
    return ThreadingHTTPServer((host, port), Handler)


def _already_running(port):
    """True if a br27sim server is already answering on this port."""
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/constants", timeout=2) as r:
            return r.status == 200 and b"DEFAULTS" in r.read(200)
    except Exception:
        return False


def serve(host="127.0.0.1", port=8027, open_browser=True):
    try:
        httpd = make_server(host, port)
    except OSError:
        if _already_running(port):
            # a second launch: the simulator is already up, just show it
            print(f"BR27 simulator is already running at http://127.0.0.1:{port}/")
            if open_browser:
                webbrowser.open(f"http://127.0.0.1:{port}/")
            return
        print(f"Port {port} is in use by another program, picking a free one.")
        httpd = make_server(host, 0)
    url = f"http://{host}:{httpd.server_address[1]}/"
    print(f"BR27 simulator running at {url}  (Ctrl+C to stop)")
    if open_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        httpd.server_close()
