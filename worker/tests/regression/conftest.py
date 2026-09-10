import importlib.util
import os

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
EXAMPLES_DIR = os.path.join(REPO_ROOT, "examples")


def _import_example_script(example_folder, script_name, module_name):
    """Import one of the examples/*/verification/*.py scripts as a module, so
    its module-level constants (CRITERIA_NAMES, VALUE_FUNCTIONS, COMPARISONS,
    ALTERNATIVES, EXPECTED_*) can be reused directly instead of copy-pasted.
    Importing does not execute main() (guarded by `if __name__ == "__main__"`).
    """
    path = os.path.join(EXAMPLES_DIR, example_folder, "verification", script_name)
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def import_example_script():
    return _import_example_script
