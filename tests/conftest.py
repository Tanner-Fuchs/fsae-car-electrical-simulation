import sys
from pathlib import Path

# lets the tests import fingerprint.py next to them
sys.path.insert(0, str(Path(__file__).resolve().parent))
