#!/usr/bin/env python3
"""
Shared loader for the five bundled example case studies.

Produces exactly the data shapes ``worker/scripts/weight_space_definition.py::compute_weights``
and ``worker/scripts/upmavt.py::run_upmavt`` expect, using only the production solver
code plus this thin adapter -- no web app, no database, no Docker required.

Two source formats exist in the repo:

- Examples 01-03 ship as ``case_study.zip`` (the app's own export format): an
  ``input/input.json`` describing criteria/alternatives, and one ``sessions/<id>.json``
  per decision-maker with ``value_functions``, ``qualitative_indicators`` and ``bwt``
  already in (almost) the exact field names the solver code uses.
- Examples 04-05 ship a ``data/`` folder too, but this loader does NOT parse it: the
  CSVs in that folder are semicolon-delimited (``value_functions.csv``,
  ``bwt_comparisons.csv``) and ``input.csv`` has an unquoted comma inside two alternative
  names, so neither `csv.reader` nor ``frontend/public/load_LOCAL.py``'s comma-only
  parsers can read them as shipped -- a pre-existing bug in those example folders,
  outside this verification task's scope to fix in the app's CSV format. Since examples
  04 and 05 each already ship a ``verification/run_*.py`` script with this exact data
  hand-encoded as plain Python constants (``CRITERIA_NAMES``, ``VALUE_FUNCTIONS``,
  ``COMPARISONS``, ``ALTERNATIVES``) -- already exercised and checked against the
  paper/closed-form results by those scripts -- this loader imports those constants
  directly instead of re-deriving them from the broken CSVs.
"""

import importlib.util
import json
import os
import sys
import zipfile
from dataclasses import dataclass, field

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
EXAMPLES_DIR = os.path.join(REPO_ROOT, "examples")

sys.path.insert(0, os.path.join(REPO_ROOT, "worker"))

from scripts.weight_space_definition import compute_weights  # noqa: E402

# Confidence level (0-4) -> uncertainty half-width as a fraction of the value.
# Matches worker/scripts/upmavt.py::evaluate_alternative's confidence_errors table
# and frontend/public/load_LOCAL.py::build_alternatives_from_csv's confidence_errors
# table (there expressed as percentages).
CONFIDENCE_ERROR_PCT = {0: 10.0, 1: 7.5, 2: 5.0, 3: 2.5, 4: 0.0}

# Registry of the five bundled examples: key -> (folder name, source kind, ...).
# For "hardcoded" examples, the third element is (verification script filename, session name).
EXAMPLES = {
    "01": ("01-port-selection-liang-et-al", "zip"),
    "02": ("02-port-selection-uncertainty-two-decision-makers", "zip"),
    "03": ("03-nuclear-reactor-hierarchical-uncertain", "zip"),
    "04": ("04-tradeoff-elicitation-sun-kroesen-rezaei-2026", "hardcoded",
           ("run_replication.py", "participant_64")),
    "05": ("05-analytically-tractable-verification", "hardcoded",
           ("run_verification.py", "session_1")),
}


@dataclass
class SessionData:
    name: str
    vf: dict          # criterion_name -> callable(raw_x) -> value in [0, 1]
    confidence: dict   # criterion_name -> int 0-4
    comparisons: list  # [{REFERENCE_CRITERION, ADJUSTED_CRITERION, DATA_VALUE, TYPE, GROUP}, ...]


@dataclass
class ExampleCase:
    key: str
    name: str
    criteria_names: list
    alternatives: dict  # alt_name -> {criterion_name: raw_value_string}, qualitative-substituted
    sessions: list = field(default_factory=list)  # list[SessionData]


def _identity_vf():
    return lambda x: max(0.0, min(1.0, float(x)))


def _piecewise_linear(points):
    """points: list of (x, y) tuples, at least 2, returns a clamped linear interpolant."""
    pts = sorted(points, key=lambda p: p[0])
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]

    def f(raw_x):
        x = float(raw_x)
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        for i in range(1, len(xs)):
            if x <= xs[i]:
                x0, x1 = xs[i - 1], xs[i]
                y0, y1 = ys[i - 1], ys[i]
                if x1 == x0:
                    return y1
                t = (x - x0) / (x1 - x0)
                return y0 + t * (y1 - y0)
        return ys[-1]

    return f


def _apply_qualitative_overrides(alternatives, criteria_meta, session_qi):
    """Return a copy of `alternatives` with qualitative criteria replaced by the
    decision-maker's elicited 0-1 value (with a confidence-derived error margin),
    matching frontend/public/load_LOCAL.py::build_alternatives_from_csv.
    """
    out = {alt: dict(vals) for alt, vals in alternatives.items()}
    for crit_name, meta in criteria_meta.items():
        if not meta.get("is_qualitative"):
            continue
        qi = session_qi.get(crit_name)
        if not qi:
            continue
        ranking = qi.get("ranking", {})
        values = qi.get("values", {})
        confidences = qi.get("confidences", {})
        for alt_name in out:
            if alt_name not in ranking:
                continue
            rank = ranking[alt_name]
            x_pos = values.get(str(rank))
            if x_pos is None:
                continue
            confidence = int(confidences.get(str(rank), 4))
            error_pct = CONFIDENCE_ERROR_PCT.get(confidence, 0.0)
            if error_pct > 0:
                out[alt_name][crit_name] = f"{x_pos} ± {error_pct}%"
            else:
                out[alt_name][crit_name] = x_pos
    return out


def _load_zip_example(key, folder_name):
    zip_path = os.path.join(EXAMPLES_DIR, folder_name, "case_study.zip")
    with zipfile.ZipFile(zip_path) as zf:
        input_doc = json.loads(zf.read("input/input.json").decode("utf-8"))
        session_files = sorted(n for n in zf.namelist() if n.startswith("sessions/") and n.endswith(".json"))
        raw_sessions = [json.loads(zf.read(n).decode("utf-8")) for n in session_files]

    criteria = input_doc["criteria"]
    criteria_names = [c["criterion_name"] for c in criteria]
    criteria_meta = {
        c["criterion_name"]: {
            "is_qualitative": bool(c.get("is_qualitative")),
            "unit": c.get("unit", ""),
            "group": c.get("group", ""),
        }
        for c in criteria
    }

    base_alternatives = {}
    for c in criteria:
        for alt in c["alternatives"]:
            base_alternatives.setdefault(alt["name"], {})[c["criterion_name"]] = alt["value"]

    sessions = []
    for raw in raw_sessions:
        vf = {}
        confidence = {}
        vf_criteria = (raw.get("value_functions") or {}).get("criteria", {})
        for crit_name, meta in criteria_meta.items():
            if meta["is_qualitative"]:
                vf[crit_name] = _identity_vf()
                confidence[crit_name] = 4
                continue
            cfg = vf_criteria.get(crit_name, {})
            points = [(p["x"], p["y"]) for p in cfg.get("points", [])]
            if len(points) < 2:
                continue
            vf[crit_name] = _piecewise_linear(points)
            confidence[crit_name] = int(cfg.get("confidence", 4))

        comparisons = [
            {
                "REFERENCE_CRITERION": c["reference_criterion"],
                "ADJUSTED_CRITERION": c["adjusted_criterion"],
                "DATA_VALUE": float(c["data_value"]),
                "TYPE": c.get("type", ""),
                "GROUP": c.get("group", ""),
            }
            for c in (raw.get("bwt") or {}).get("comparisons", [])
        ]

        session_alts = _apply_qualitative_overrides(
            base_alternatives, criteria_meta, raw.get("qualitative_indicators") or {}
        )

        sessions.append(SessionData(name=raw.get("name", "session"), vf=vf, confidence=confidence,
                                     comparisons=comparisons))
        if len(sessions) == 1:
            first_session_alts = session_alts

    # Matches worker/worker.py's handle_run_step: the shared `alternatives` dict used by
    # run_upmavt is built from the FIRST session's qualitative indicators only, even when
    # multiple decision-makers are present (a real, deliberate simplification in the
    # production code, reproduced here for fidelity rather than "fixed").
    alternatives = first_session_alts if raw_sessions else base_alternatives

    return ExampleCase(key=key, name=folder_name, criteria_names=criteria_names,
                        alternatives=alternatives, sessions=sessions)


def _import_script(path, module_name):
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_hardcoded_example(key, folder_name, script_name, session_name):
    script_path = os.path.join(EXAMPLES_DIR, folder_name, "verification", script_name)
    mod = _import_script(script_path, f"_verification_data_{key}")

    criteria_names = list(mod.CRITERIA_NAMES)
    confidence = dict(getattr(mod, "CONFIDENCE", dict.fromkeys(criteria_names, 4)))
    session = SessionData(name=session_name, vf=dict(mod.VALUE_FUNCTIONS), confidence=confidence,
                           comparisons=[dict(c) for c in mod.COMPARISONS])

    return ExampleCase(key=key, name=folder_name, criteria_names=criteria_names,
                        alternatives={alt: dict(vals) for alt, vals in mod.ALTERNATIVES.items()},
                        sessions=[session])


def load_example(key):
    """Load one of the five bundled examples by key ("01".."05")."""
    if key not in EXAMPLES:
        raise KeyError(f"Unknown example key {key!r}; expected one of {sorted(EXAMPLES)}")
    entry = EXAMPLES[key]
    folder_name, kind = entry[0], entry[1]
    if kind == "zip":
        return _load_zip_example(key, folder_name)
    script_name, session_name = entry[2]
    return _load_hardcoded_example(key, folder_name, script_name, session_name)


def compute_weight_solutions(case, use_non_linear_model=True, print_fn=None):
    """Run compute_weights once per session; returns weight_solutions_list in the
    order expected by run_upmavt (parallel to case.sessions).
    """
    if print_fn is None:
        print_fn = lambda *a, **k: None  # noqa: E731
    solutions = []
    for session in case.sessions:
        sols = compute_weights(
            session.vf, session.comparisons, criteria_names=case.criteria_names,
            use_non_linear_model=use_non_linear_model, print_fn=print_fn,
        )
        solutions.append(sols)
    return solutions
