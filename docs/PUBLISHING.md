# Publishing an update

Everyone on the team runs the simulator through the launcher (`BR27-Simulator.bat` on
Windows, `br27-simulator.command` on Mac/Linux). Each time it starts, it checks the
`main` branch of this repo. If there is a new commit, it downloads it before opening the
simulator. So **publishing an update just means pushing a commit to `main`**. Nobody has
to reinstall anything.

The repo has to be **public** for this to work, because the launcher downloads without
logging in.

## 1. Get the code on your PC (once)

Follow "Setup (once)" in the [README](../README.md): clone the repo, make the `.venv` and
run `pip install -e ".[dev]"`. You only need this to edit the code. Running the simulator
only needs the launcher.

Before each editing session, get the latest version so you aren't working on old code:

```bash
git pull
```

## 2. Make your change and try it

Edit the files (see "Where to change things" in the README), then:

```bash
br27sim serve      # look at it in the browser; Ctrl+C, then run again after each edit
pytest             # all tests must pass
```

If a golden test fails, check whether you meant to change that result:

- **Not on purpose:** your edit broke something. Fix it.
- **On purpose** (for example you changed a default or improved the model): accept the
  new numbers with `python tools/make_golden.py`, run `pytest` again, and say what changed
  in your commit message.

## 3. Publish it

Pick whichever you like. They all do the same thing.

**VS Code** (Source Control panel, the branch icon on the left):
1. Type a short message saying what you changed, for example
   `Raise fan current to 7 A after bench test`.
2. Click **Commit** (say Yes if it asks to stage all changes).
3. Click **Sync Changes** (or **Push**).

**GitHub Desktop**: add the repo folder (File → Add local repository), write the summary
at the bottom left, click **Commit to main**, then **Push origin**.

**Command line**:

```bash
git add -A
git commit -m "Raise fan current to 7 A after bench test"
git push
```

If the push is refused because someone else pushed first, run `git pull`, run `pytest`
again, then `git push`.

## 4. Check it went out

- On GitHub, the **Actions** tab runs the tests on Windows and Linux. A green tick means the
  update is good. A red cross means a test failed: open it to see which, fix it, and push
  again. (The launcher still downloads a commit with a red cross, so fix it quickly.)
- Close the simulator and start the launcher again. It says
  `Downloading update <sha>...` and opens your new version.

## Going back

If an update breaks something and you need the old version back quickly:

```bash
git revert HEAD    # makes a new commit that undoes the last one
git push
```

Every launcher picks up the revert at its next start.

## Rules of thumb

- Small commits with clear messages. "Fix CAN bus load at 500 kbps" beats "updates".
- Tag every new default with where it came from (`[form: ...]`, `[rules X.Y]`, `[Tanner]`,
  `[assumption]`), as `params.py` does.
- Nobody's CAD files or settings are in the repo. They live in each person's own data
  folder (see "Import the car's CAD" in the README), so updates never overwrite them.
- If you want to try something big without affecting the team, work on a branch
  (`git switch -c my-idea`). The launcher only follows `main`, so nobody sees it until
  you merge it.
