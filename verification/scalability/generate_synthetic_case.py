#!/usr/bin/env python3
"""
Parametrized synthetic case-study generator for the scalability benchmark.

Produces the same (criteria_names, alternatives, sessions) shape as
verification/common/load_example.py's ExampleCase, for an arbitrary number of
alternatives, criteria, and decision-makers, so the benchmark can sweep each
axis independently.

All criteria are quantitative with a simple linear value function over [0, 100]
(increasing). Each decision-maker gets a full best-worst-tradeoff comparison set
(criterion 0 as "best" anchor, criterion -1 as "worst" anchor, matching the
(n-1)+(n-1)-1 structure the app itself generates -- see
USER_MANUAL/README.md's "Weights" section) with DELIBERATELY SELF-CONSISTENT
answers: a random target weight vector is drawn first (satisfying the ordering
constraint the BWT residual formula requires -- see the commit that fixed
USER_MANUAL/img/run-upmavt-step1-weights.png for the derivation), then each
comparison's slider value is computed to exactly match it. This keeps
compute_weights() well-behaved (a tight, non-empty feasible band) at every
problem size, which is what the benchmark needs -- it is measuring how runtime
and memory scale with problem size, not re-testing consistency handling
(that's what the convergence study's real elicited data already exercises).
"""

import os
import random
import sys
from dataclasses import dataclass, field

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "verification", "common"))
from load_example import ExampleCase, SessionData  # noqa: E402


def _linear_vf():
    return lambda x: max(0.0, min(1.0, float(x) / 100.0))


def _make_target_weights(num_criteria, rng):
    """Random weights where index 0 (best anchor) and index -1 (worst anchor)
    are both <= every other weight, so every BWT comparison admits an exact
    slider value in [0, 100] (see module docstring)."""
    others = [rng.uniform(1.0, 3.0) for _ in range(max(0, num_criteria - 2))]
    anchor_lo = min(others) * rng.uniform(0.2, 0.6) if others else 1.0
    weights = [anchor_lo] + others + [anchor_lo * rng.uniform(0.8, 1.0)]
    total = sum(weights)
    return [w / total for w in weights]


def _make_comparisons(criteria_names, target_weights):
    """Best-anchor-vs-all, worst-anchor-vs-all (minus the duplicate best/worst
    pair), each slider value computed so the comparison is exactly consistent
    with `target_weights` under the linear vf(x) = x/100.
    """
    best = criteria_names[0]
    worst = criteria_names[-1]
    w = dict(zip(criteria_names, target_weights))
    comparisons = []

    def add(ref, adj, comp_type):
        value = 100.0 * (w[ref] / w[adj])
        comparisons.append({
            "REFERENCE_CRITERION": ref, "ADJUSTED_CRITERION": adj,
            "DATA_VALUE": round(value, 4), "TYPE": comp_type, "GROUP": "single-group",
        })

    for crit in criteria_names:
        if crit == best:
            continue
        add(best, crit, "best")
    for crit in criteria_names:
        if crit in (best, worst):
            continue
        add(worst, crit, "worst")

    return comparisons


def generate_case(num_alternatives, num_criteria, num_dms, seed=0):
    if num_criteria < 2:
        raise ValueError("need at least 2 criteria for a best/worst BWT anchor pair")
    rng = random.Random(seed)

    criteria_names = [f"C{i}" for i in range(num_criteria)]
    alternatives = {
        f"A{i}": {crit: str(round(rng.uniform(0, 100), 2)) for crit in criteria_names}
        for i in range(num_alternatives)
    }

    sessions = []
    for dm in range(num_dms):
        target_weights = _make_target_weights(num_criteria, rng)
        vf = {crit: _linear_vf() for crit in criteria_names}
        confidence = {crit: 4 for crit in criteria_names}
        comparisons = _make_comparisons(criteria_names, target_weights)
        sessions.append(SessionData(name=f"synthetic_dm_{dm}", vf=vf, confidence=confidence,
                                     comparisons=comparisons))

    return ExampleCase(key=f"synthetic_A{num_alternatives}_C{num_criteria}_K{num_dms}",
                        name="synthetic", criteria_names=criteria_names,
                        alternatives=alternatives, sessions=sessions)


if __name__ == "__main__":
    # Smoke test: generate a small case and run it through the real solver end to end.
    sys.path.insert(0, os.path.join(REPO_ROOT, "worker"))
    from scripts.weight_space_definition import compute_weights
    from scripts.upmavt import run_upmavt

    case = generate_case(num_alternatives=5, num_criteria=4, num_dms=2, seed=1)
    weight_solutions_list = [
        compute_weights(s.vf, s.comparisons, criteria_names=case.criteria_names,
                         use_non_linear_model=True, print_fn=lambda *a, **k: None)
        for s in case.sessions
    ]
    for i, ws in enumerate(weight_solutions_list):
        print(f"session {i}: {len(ws)} solutions, first = {ws[0] if ws else None}")

    params = {"mc_iterations": 500, "mc_mode": "non_strict", "aggregation_method": "weighted_sum"}
    result = run_upmavt([s.vf for s in case.sessions], [s.confidence for s in case.sessions],
                         weight_solutions_list, case.alternatives, case.criteria_names, params,
                         print_fn=lambda *a, **k: None)
    print("alternative_names:", result["alternative_names"])
    print("OK")
