import os
import sys

WORKER_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_ROOT not in sys.path:
    sys.path.insert(0, WORKER_ROOT)
