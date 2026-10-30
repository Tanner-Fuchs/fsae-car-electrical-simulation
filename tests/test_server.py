"""The local server answers the page's requests the way the page expects."""
import json
import threading
import urllib.error
import urllib.request

import pytest

from br27sim.server import make_server


@pytest.fixture(scope="module")
def url():
    httpd = make_server(port=0)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def get(url):
    with urllib.request.urlopen(url) as r:
        return r.read().decode()


def call(url, name, *args):
    req = urllib.request.Request(f"{url}/api/call/{name}", data=json.dumps({"args": list(args)}).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def test_page_loads_scripts(url):
    html = get(url + "/")
    for s in ["bridge.js", "app.js", "vendor/three-0.128.0.min.js"]:
        assert f'src="/{s}"' in html
        assert get(f"{url}/{s}")


def test_constants(url):
    c = json.loads(get(url + "/api/constants"))
    assert c["DEFAULTS"]["battery"] == "lfp4"
    assert "simulatePower" in c["FUNCTIONS"]
    assert all("scenarioAt3" in f for f in c["FAULTS"])


def test_wiring_bundle(url):
    w = json.loads(get(url + "/api/wiring"))
    assert w["schematicSVG"].startswith("<svg") and len(w["wireList"]) == 71


def test_lap_then_power(url):
    p = call(url, "withDefaults", {})
    lap = call(url, "simulateLap", p)
    power = call(url, "simulatePower", p, {"__lap__": lap["p"]})
    assert power["laps"] >= 2 and power["stats"]["endSoc"] > 50


def test_infinity_becomes_null(url):
    phy = call(url, "canPhysical", {"termEnd1": False, "termEnd2": False}, "all")
    assert phy["rTotal"] is None


def test_unknown_function_is_an_error(url):
    with pytest.raises(urllib.error.HTTPError) as e:
        call(url, "rm_rf")
    assert e.value.code == 500


def test_no_files_outside_web(url):
    with pytest.raises(urllib.error.HTTPError):
        get(url + "/../server.py")
