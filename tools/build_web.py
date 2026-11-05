"""Build the web version of the simulator (runs on iPad, iPhone or any browser, no install).

The page is the same as `br27sim serve`, but the Python model runs inside the browser
with Pyodide, so the result is a folder of static files that GitHub Pages can host.
The GitHub workflow .github/workflows/pages.yml runs this on every push to main.

    python tools/build_web.py --pyodide <folder with pyodide.js, pyodide.asm.wasm, ...> [--out site]

Get the Pyodide folder with:  npm pack pyodide@0.29.5 && tar xzf pyodide-0.29.5.tgz  (-> package/)
Try the result locally with:  python -m http.server -d site 8000
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from br27sim import server  # noqa: E402

PKG = ROOT / "src" / "br27sim"
PYODIDE_FILES = ["pyodide.js", "pyodide.asm.js", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"]

HEAD = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="BR27 Sim">
<meta name="theme-color" content="#501214">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" type="image/svg+xml" href="icon.svg">
<link rel="icon" type="image/png" sizes="180x180" href="icon-180.png">
<link rel="manifest" href="manifest.webmanifest">
</head><body>
"""


def version():
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:
        return "dev"


def make_icon(path, size=180):
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return False
    im = Image.new("RGB", (size, size), (11, 110, 138))
    d = ImageDraw.Draw(im)
    s = size / 180
    # a CAN-style twisted pair across the icon, plus "27"
    for i in range(9):
        x = 20 * s + i * 16 * s
        d.line([(x, 120 * s), (x + 16 * s, 140 * s)], fill=(244, 244, 244), width=int(6 * s))
        d.line([(x, 140 * s), (x + 16 * s, 120 * s)], fill=(29, 29, 31), width=int(6 * s))
    try:
        from PIL import ImageFont
        font = ImageFont.load_default(size=int(78 * s))
    except Exception:
        font = None
    d.text((size / 2, 62 * s), "27", fill=(255, 255, 255), font=font, anchor="mm")
    im.save(path)
    return True


def build(pyodide_dir, out):
    out = Path(out)
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(server.WEB, out, ignore=shutil.ignore_patterns("__pycache__"))
    (out / "pyodide").mkdir()
    for f in PYODIDE_FILES:
        shutil.copy2(Path(pyodide_dir) / f, out / "pyodide" / f)

    with zipfile.ZipFile(out / "br27sim.zip", "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(PKG.rglob("*.py")):
            if "__pycache__" not in f.parts:
                z.write(f, f.relative_to(PKG.parent).as_posix())

    v = version()
    boot = {
        "pyodide": "pyodide/",
        "pkg": f"br27sim.zip?v={v}",
        "scripts": [f"{s}?v={v}" for s in server.LIBS + server.SCRIPTS],
    }
    page = (server.WEB / "page.html").read_text(encoding="utf-8")
    html = (HEAD + page + "\n" + server.ERROR_BOX + "\n"
            + f"<script>window.BR27_BOOT = {json.dumps(boot)};</script>\n"
            + f'<script src="pyboot.js?v={v}"></script>\n</body></html>\n')
    (out / "index.html").write_text(html, encoding="utf-8")

    # the Bobcat Racing icon (web/icon.svg, pre-rendered PNGs in web/); draw a plain one only if they are missing
    for size in (180, 512):
        if not (out / f"icon-{size}.png").exists():
            make_icon(out / f"icon-{size}.png", size)
    (out / "manifest.webmanifest").write_text(json.dumps({
        "name": "BR27 Electrical Simulator", "short_name": "BR27 Sim", "start_url": "./", "display": "standalone",
        "background_color": "#050404", "theme_color": "#501214",
        "icons": [{"src": "icon-180.png", "sizes": "180x180", "type": "image/png"},
                  {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"}],
    }, indent=1), encoding="utf-8")
    (out / ".nojekyll").write_text("")
    print(f"web version {v} written to {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pyodide", required=True, help="folder with the Pyodide runtime files")
    ap.add_argument("--out", default=str(ROOT / "site"))
    a = ap.parse_args()
    build(a.pyodide, a.out)
