#!/bin/bash
# BR27 electrical simulator launcher (Mac / Linux).
# Mac: double-click it (first time: right-click > Open). Linux: bash br27-simulator.command
# Each start it downloads the newest version from GitHub, installs Python and
# everything else it needs the first time (into ~/.br27sim), then opens the
# simulator in your browser. Press Ctrl+C or close the window to stop it.
set -e
REPO="Tanner-Fuchs/fsae-car-electrical-simulation"
BRANCH="main"
ROOT="$HOME/.br27sim"
APP="$ROOT/app"
UV="$ROOT/uv/uv"
mkdir -p "$ROOT"

if [ ! -x "$UV" ]; then
  echo "First run: downloading the Python installer (uv)..."
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) T=aarch64-apple-darwin ;;
    Darwin-*)     T=x86_64-apple-darwin ;;
    Linux-aarch64) T=aarch64-unknown-linux-gnu ;;
    *)            T=x86_64-unknown-linux-gnu ;;
  esac
  mkdir -p "$ROOT/uv"
  curl -fsSL "https://github.com/astral-sh/uv/releases/latest/download/uv-$T.tar.gz" | tar -xz -C "$ROOT/uv" --strip-components 1
fi

CURRENT="$(cat "$ROOT/version.txt" 2>/dev/null || true)"
LATEST="$(curl -fsS -H 'User-Agent: br27sim-launcher' "https://api.github.com/repos/$REPO/commits/$BRANCH" 2>/dev/null \
  | grep -o '"sha": *"[0-9a-f]\{40\}"' | head -1 | grep -o '[0-9a-f]\{40\}' || true)"
if [ -z "$LATEST" ]; then
  echo "Could not check GitHub for updates (offline?). Using the version already installed."
elif [ "$LATEST" != "$CURRENT" ]; then
  echo "Downloading update ${LATEST:0:7}..."
  rm -rf "$ROOT/app-new" && mkdir -p "$ROOT/app-new"
  curl -fsSL "https://api.github.com/repos/$REPO/tarball/$LATEST" | tar -xz -C "$ROOT/app-new" --strip-components 1
  rm -rf "$APP" && mv "$ROOT/app-new" "$APP"
  echo "$LATEST" > "$ROOT/version.txt"
else
  echo "Up to date (${LATEST:0:7})."
fi
[ -d "$APP" ] || { echo "The simulator has not been downloaded yet. Connect to the internet and run this again."; exit 1; }

export UV_PROJECT_ENVIRONMENT="$ROOT/venv"
echo "Starting the simulator. Your browser will open. Press Ctrl+C to stop it."
exec "$UV" run --project "$APP" --python 3.12 --frozen br27sim serve
