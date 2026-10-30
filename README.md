# BR27 electrical simulator

Bobcat Racing, FSAE 2027 electrical team. An interactive model of the car's electrical
system: the 2012 Honda CBR600RR with the EMU Black (fuel, spark, a lap of the test track),
the 12 V system through a full endurance run, the IC.9 shutdown circuit, the CAN bus and
DAQ, fault codes, and the powertrain harness.

The model is Python. The interactive page (3D car, charts, every tab) runs in your browser
and gets all of its numbers from the Python model through a small local server.

## Just run it (the launcher)

You don't need Python or git to use the simulator. Download the launcher once:

- **Windows:** [BR27-Simulator.bat](https://github.com/Tanner-Fuchs/fsae-car-electrical-simulation/releases/download/launcher/BR27-Simulator.bat)
- **Mac / Linux:** [br27-simulator.command](https://github.com/Tanner-Fuchs/fsae-car-electrical-simulation/releases/download/launcher/br27-simulator.command)
  (Mac: right-click it, Open, then Open again the first time)

Double-click it. The first start takes a minute or two: it downloads a private copy of
Python and the simulator into `%LOCALAPPDATA%\BR27Sim` (Windows) or `~/.br27sim`
(Mac/Linux), then your browser opens the simulator. Every later start checks this repo
and downloads the newest version if there is one, so you always run the latest model.
Close the black window to stop the simulator.

> Windows may say "Windows protected your PC" the first time. Click **More info**, then
> **Run anyway**. The launcher is a plain text file; open it in Notepad to see what it does.

To publish an update that everyone's launcher picks up, see [docs/PUBLISHING.md](docs/PUBLISHING.md).

## Import the car's CAD

On the **Car** tab, the **CAD models (STL)** card takes STL files of the frame and the main
components (battery, ECU, dash, corner nodes, fuel pump and so on).

1. In your CAD program, export each part as STL **from the full car assembly**, keeping the
   assembly origin, so every part lands where it really sits on the car.
2. Pick the files with **Import STL files…**. The simulator guesses each file's role from its name
   (frame, battery, ecu...); change it in the table if it guessed wrong. "Other (display only)" files
   are drawn but not used for routing.
3. Set the **units**, which CAD axis is **up**, and which points **forward**, until the car sits
   upright and faces forward. **Center frame on car** puts the frame on the centreline with its bottom
   just off the ground.
4. Parts without their own STL can be placed by hand: select it in the table, click **Place selected
   part on CAD**, then tap the model where it goes. Tick **Hide placeholder car** once
   your CAD covers it.

Each part's position (its STL's centre, or where you placed it) sets the harness and CAN
routes, and those route lengths feed the CAN physical layer model (trunk lengths and
signal timing). Your STLs and settings are kept in `%LOCALAPPDATA%\BR27Sim\cad` or
`~/.br27sim/cad`, outside the app, so updates never touch them. Set the `BR27SIM_DATA`
environment variable to keep them somewhere else, such as a shared team drive.

## Work on the code

The rest of this page is for changing the simulator itself.

## Setup (once)

You need **Python 3.9 or newer** and **git**.

- Windows: install Python from [python.org](https://www.python.org/downloads/) and tick
  "Add python.exe to PATH" in the installer. Install [Git for Windows](https://git-scm.com/download/win).
- Mac: `brew install python git`, or the python.org installer.

Then, in a terminal (PowerShell on Windows):

```bash
git clone https://github.com/Tanner-Fuchs/fsae-car-electrical-simulation.git
cd fsae-car-electrical-simulation
python -m venv .venv
```

Activate the virtual environment (do this every time you open a new terminal):

```bash
# Windows PowerShell
.venv\Scripts\Activate.ps1
# Mac / Linux
source .venv/bin/activate
```

> If PowerShell refuses to run the activate script, run
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once and try again.

Install the simulator in editable mode, so your code changes take effect without reinstalling:

```bash
pip install -e ".[dev]"
```

## Run it

```bash
br27sim serve
```

Your browser opens http://127.0.0.1:8027 with the simulator. Leave the terminal running;
press Ctrl+C to stop it. After you edit a Python file, stop and restart `br27sim serve`, then
reload the page.

Other commands:

```bash
br27sim report                                   # headline results in the terminal
br27sim report --set battery=agm finalDrive=3.5  # same, with inputs changed
br27sim export-wiring                            # harness SVGs, .xlsx wire list, printable .html into wiring-out/
br27sim serve --host 0.0.0.0                     # reach it from a phone/iPad on the same Wi-Fi at http://<your PC's IP>:8027
```

PDF export of the harness sheets (optional): `pip install -e ".[pdf]"`, then
`playwright install chromium`, then `br27sim export-wiring --pdf`. Without it, open the
exported `.html` in a browser and print to PDF (17 x 11 in, landscape).

You can also use the model from your own scripts or a Jupyter notebook:

```python
import br27sim
lap = br27sim.simulate_lap({"finalDrive": 3.5})
power = br27sim.simulate_power({"battery": "agm"}, lap)
print(lap["stats"]["lapTime"], power["stats"]["endSoc"])
```

## Where to change things

| To change | Edit |
| --- | --- |
| Any default input (battery, loads, bitrate, gearing...) and its source tag | `src/br27sim/params.py` |
| Battery options, OCV curves, the test track | `src/br27sim/params.py` |
| Engine, restrictor, injectors, coils, the lap | `src/br27sim/engine.py` |
| Stator, regulator, loads, breaker, endurance run, cranking | `src/br27sim/power.py` |
| Shutdown circuit (IC.9) | `src/br27sim/shutdown.py` |
| CAN messages and IDs, bus load, bus simulation, termination | `src/br27sim/can.py` |
| Fault codes, debounce times, CAN fault bands | `src/br27sim/faults.py` |
| Aliasing demo | `src/br27sim/daq.py` |
| EMU Black pinout, fuses, part status, wire list, harness drawings | `src/br27sim/wiring.py` |
| The page itself (layout, charts, 3D car, text) | `src/br27sim/web/` (HTML and JavaScript) |
| STL import, CAD axes and part positions | `src/br27sim/cad.py` (server side), `web/car3d.js` (drawing) |
| The launchers | `launcher/` |

Every default carries a tag saying where it came from: `[form: ...]` for a concept form,
`[rules X.Y]` for the FSAE rules, `[Tanner]` for a team decision, `[assumption]` for a
placeholder nobody has measured yet. Keep tagging new values the same way.

Result and parameter names are camelCase (`lapTime`, `regSet`) because the page reads them
by those names. Python function names are snake_case (`simulate_lap`).

## How it fits together

```
browser page (src/br27sim/web/)  --HTTP-->  br27sim serve (server.py)  -->  the model (params, engine, power, can, ...)
```

The page was first built as a single self-contained web page. `web/bridge.js` gives the
page the same `BR27Sim` and `BRWiring` objects it always used, but each call is answered
by Python. That kept the page unchanged while moving the model to Python. Each input
change reruns the model in Python, which takes about a second.

## Tests

```bash
pytest
```

- `tests/test_golden.py` checks 57 cases (every model, many input combinations) against
  `tests/golden.json`. Those numbers were generated from the original JavaScript model, so
  passing means the Python port gives the same results. If you change the model **on
  purpose**, run `python tools/make_golden.py` to accept the new numbers and say why in your
  commit message.
- `tests/test_model.py` checks the physics moves the right way (bigger battery cranks higher,
  dead regulator drains the battery, and so on).
- `tests/test_wiring.py` checks the wire list (every used EMU pin has a wire) and the exports.
- `tests/test_server.py` checks the local server answers the page correctly.
- `tests/test_cad.py` checks STL reading, the CAD axis settings and part positions.

GitHub Actions runs the tests on every push (Windows and Linux, Python 3.9 and 3.12).

`tools/compare_js.py path/to/sim.js` compares the Python model against a copy of the
JavaScript model directly (needs Node.js). It is only needed while the JavaScript page is
still maintained alongside.
