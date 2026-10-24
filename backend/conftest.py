import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_ROOT))

# Use the bundled sample engine for tests: it exercises the full HTTP pipeline
# and is guaranteed to be flagged is_demo=True, so tests also prove the honesty
# flag is wired through.
os.environ.setdefault("VY_ENGINE", "sample")
