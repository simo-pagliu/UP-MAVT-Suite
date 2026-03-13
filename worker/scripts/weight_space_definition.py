#!/usr/bin/env python3
"""
Weight Space Explorer (DB version, v4 workflow)
Reads comparison constraints and value functions from MongoDB,
explores the weight space, and saves results back to DB.
"""

import numpy as np
import scipy.optimize as opt
from functools import partial
from scipy.interpolate import interp1d
from scipy.stats import qmc

# ============================================================================
# PARAMETERS
# ============================================================================
RNG_SEED = 426
EPS = 0.001
N_RESTARTS = 50
CONSTRAINT_TOL = 1e-5
FEASIBILITY_TOL = 0.01  # Tolerance for constraint satisfaction
PHASE2_SAMPLES = 1000
LHS_SAMPLES = PHASE2_SAMPLES  # Backward-compatible alias for the legacy name.
MULTISTART_RESTARTS = 96
EXTREME_POINT_DIRECTIONS = 48
BALL_WALK_BURN_IN = 250
BALL_WALK_THINNING = 4
BALL_WALK_STEP_SCALE = 0.08
ADAPTIVE_ROUNDS = 4
ADAPTIVE_BATCH_SIZE = 320
# Percentage tolerance LIM used in Phase 3 acceptance band:
#   z_cap = z_star + z_star * LIM
# where LIM is provided as a percentage (default 1%).
DEFAULT_PHASE3_TOLERANCE_PCT = 1.0
CDS_POPULATION_FACTOR = 18
CDS_MIN_POPULATION = 40
CDS_GENERATIONS = 120
CDS_MUTATION_FACTOR = 0.6
CDS_CROSSOVER_RATE = 0.9
CDS_FEAS_TOL = 1e-10

PHASE1_METHODS = {
    'differential_evolution': 'Differential Evolution (legacy)',
    'constraint_dominated_ea': 'Constraint-Dominated Evolutionary Search (CDS)',
}
DEFAULT_PHASE1_METHOD = 'constraint_dominated_ea'

WEIGHT_SAMPLING_METHODS = {
    'lhs_simplex': 'Latin Hypercube + simplex map',
    'dirichlet': 'Direct Dirichlet sampling',
    'sobol_simplex': 'Sobol low-discrepancy + simplex map',
    'ball_walk': 'Ball walk from feasible anchor',
    'adaptive_dirichlet': 'Adaptive Dirichlet search',
    'multistart_optimization': 'Multi-start optimization',
    'extreme_points': 'Extreme-point search',
}
DEFAULT_WEIGHT_SAMPLING_METHOD = 'lhs_simplex'


# ============================================================================
# BUILD CONSTRAINT STRUCTURE
# ============================================================================
def build_constraint_structure(comparisons, value_functions):
    """Build a simple structure from comparisons."""
    criteria = set()
    for comp in comparisons:
        criteria.add(comp['REFERENCE_CRITERION'])
        criteria.add(comp['ADJUSTED_CRITERION'])

    criteria = sorted(list(criteria))
    criterion_to_index = {c: i for i, c in enumerate(criteria)}

    return {
        'criteria': criteria,
        'criterion_to_index': criterion_to_index,
        'comparisons': comparisons,
        'value_functions': value_functions,
    }


# ============================================================================
# CONSTRAINTS - Direct violation computation
# ============================================================================
# Mathematical formulation:
# 
# For BEST comparisons (ADJUSTED criterion is reference, other is adjustable):
#   Constraint: 1/vf_adjusted(value) - w_adjusted/w_reference <= z
#
# For WORST comparisons (ADJUSTED criterion is adjustable, other is reference):
#   Constraint: 1/vf_adjusted(value) - w_adjusted/w_reference <= z
#
# Both types follow the SAME pattern:
#   1/vf_adjusted(value) - w_adjusted/w_reference <= z
#
# Variable mapping:
#   - ADJUSTED criterion → adj_crit (the criterion whose value function is used)
#   - REFERENCE criterion → ref_crit (the comparison baseline)
#   - w_adjusted → w_adj
#   - w_reference → w_ref
#   - vf_adjusted(value) → vf_adj_val
#
# Violation model is configurable:
#   residual = 1/vf_adjusted(value) - w_adjusted/w_reference
#   - two_sided: violation = abs(residual)
#   - one_sided: violation = max(0, residual)
# ============================================================================

def _iter_comparison_terms(weights, constraint_data):
    """Yield normalized comparison terms used by constraint evaluation.
    
    Yields
    ------
    comp_type : str
        'best' or 'worst'
    w_ref : float
        Weight of the reference criterion
    w_adj : float
        Weight of the adjusted criterion (whose value function is used)
    vf_adj_val : float
        Value function evaluation: vf_adjusted(comparison_value)
    """
    for comp in constraint_data['comparisons']:
        ref_crit = comp['REFERENCE_CRITERION']
        adj_crit = comp['ADJUSTED_CRITERION']
        comp_value = comp['DATA_VALUE']
        comp_type = comp['TYPE'].lower()

        ref_idx = constraint_data['criterion_to_index'][ref_crit]
        adj_idx = constraint_data['criterion_to_index'][adj_crit]

        w_ref = weights[ref_idx]
        w_adj = weights[adj_idx]

        vf_adj = constraint_data['value_functions'][adj_crit]
        vf_adj_val = max(vf_adj(comp_value), EPS)

        yield comp_type, w_ref, w_adj, vf_adj_val


def _comparison_violation(
    comp_type,
    w_ref,
    w_adj,
    vf_adj_val,
    use_non_linear_model=True,
    violation_mode='two_sided',
):
    """Compute configured violation for a single comparison.
    
    Both 'best' and 'worst' use the same formula:
        violation = 1/vf_adjusted(value) - w_adjusted/w_reference
    
    Parameters
    ----------
    comp_type : str
        'best' or 'worst' (both use same formula)
    w_ref : float
        Weight of reference criterion
    w_adj : float
        Weight of adjusted criterion
    vf_adj_val : float
        Value function evaluation of adjusted criterion
    
    Returns
    -------
    float
        Constraint violation according to the selected mode.
    """
    # Both best and worst use the same pattern. The selected model controls
    # whether the ratio form (non-linear) or the weighted-difference form
    # (linear) is used.
    if use_non_linear_model:
        residual = 1.0 / vf_adj_val - (w_adj + EPS) / (w_ref + EPS)
    else:
        residual = 1.0 / vf_adj_val * w_ref - w_adj

    if violation_mode == 'one_sided':
        return max(0.0, residual)
    return abs(residual)


def compute_max_violation_weights_only(weights, constraint_data, use_non_linear_model=True):
    """Compute the maximum configured constraint violation from weights alone.
    
    Evaluates all comparison constraints:
        constraint: 1/vf_adjusted(value) - w_adjusted/w_reference <= z
    
    Returns the maximum violation (minimized and bounded by z).
    
    Parameters
    ----------
    weights : ndarray
        Weight vector (must sum to 1).
    constraint_data : dict
        Constraint structure with criteria, indices, comparisons, value functions.
    
    Returns
    -------
    float
        Maximum violation across all constraints (0 = fully satisfied).
    """
    violation_mode = constraint_data.get('violation_mode', 'two_sided')
    violations = [
        _comparison_violation(
            comp_type,
            w_ref,
            w_adj,
            vf_adj_val,
            use_non_linear_model=use_non_linear_model,
            violation_mode=violation_mode,
        )
        for comp_type, w_ref, w_adj, vf_adj_val in _iter_comparison_terms(weights, constraint_data)
    ]

    return max(violations) if violations else 0.0


def print_constraint_results(weights, constraint_data, use_non_linear_model=True, print_fn=None):
    """Print per-comparison residuals and configured violations for a weight vector."""
    if print_fn is None:
        print_fn = print

    print_fn("Constraint results for solution:")
    max_violation = 0.0

    violation_mode = constraint_data.get('violation_mode', 'two_sided')
    for idx, comp in enumerate(constraint_data['comparisons'], start=1):
        ref_crit = comp['REFERENCE_CRITERION']
        adj_crit = comp['ADJUSTED_CRITERION']
        comp_value = comp['DATA_VALUE']
        comp_type = comp['TYPE'].lower()

        ref_idx = constraint_data['criterion_to_index'][ref_crit]
        adj_idx = constraint_data['criterion_to_index'][adj_crit]

        w_ref = weights[ref_idx]
        w_adj = weights[adj_idx]

        vf_adj = constraint_data['value_functions'][adj_crit]
        vf_adj_val = max(vf_adj(comp_value), EPS)

        if use_non_linear_model:
            residual = 1.0 / vf_adj_val - (w_adj + EPS) / (w_ref + EPS)
        else:
            residual = 1.0 / vf_adj_val * w_ref - w_adj

        violation = max(0.0, residual) if violation_mode == 'one_sided' else abs(residual)
        max_violation = max(max_violation, violation)

        print_fn(
            f"  [{idx:02d}] {comp_type.upper()} | ref={ref_crit} | adj={adj_crit} | "
            f"value={comp_value} | residual={residual:.8f} | violation={violation:.8f}"
        )

    print_fn(f"  Maximum {violation_mode} violation: {max_violation:.8f}")


def _normalize_weights(weights):
    """Normalize weight vector to sum to 1 while keeping strict positivity."""
    w = np.asarray(weights, dtype=float)
    w = np.maximum(w, EPS)
    s = np.sum(w)
    if s <= 0:
        return np.ones_like(w) / len(w)
    return w / s


def _to_simplex_from_unit(sample):
    """Map a point in [0,1]^(n-1) to the simplex via stick-breaking."""
    coords = np.concatenate([[0.0], np.sort(sample), [1.0]])
    return np.diff(coords)


def normalize_weight_sampling_method(method):
    """Normalize and validate the configured Phase 2 method."""
    if method is None:
        return DEFAULT_WEIGHT_SAMPLING_METHOD

    normalized = str(method).strip().lower().replace('-', '_').replace(' ', '_')
    if normalized not in WEIGHT_SAMPLING_METHODS:
        supported = ', '.join(sorted(WEIGHT_SAMPLING_METHODS))
        raise ValueError(f"Unsupported weight sampling method '{method}'. Supported methods: {supported}")
    return normalized


def get_weight_sampling_method_label(method):
    """Return the human-readable label for a Phase 2 method identifier."""
    return WEIGHT_SAMPLING_METHODS[normalize_weight_sampling_method(method)]


def normalize_phase1_method(method):
    """Normalize and validate the configured Phase 1 method."""
    if method is None:
        return DEFAULT_PHASE1_METHOD

    normalized = str(method).strip().lower().replace('-', '_').replace(' ', '_')
    if normalized not in PHASE1_METHODS:
        supported = ', '.join(sorted(PHASE1_METHODS))
        raise ValueError(f"Unsupported Phase 1 method '{method}'. Supported methods: {supported}")
    return normalized


def get_phase1_method_label(method):
    """Return the human-readable label for a Phase 1 method identifier."""
    return PHASE1_METHODS[normalize_phase1_method(method)]


def _uniform_simplex_samples(num_criteria, n_samples):
    """Return the degenerate simplex when only one criterion exists."""
    if num_criteria != 1:
        return None
    return [np.array([1.0], dtype=float) for _ in range(max(1, n_samples))]


def _dirichlet_samples(num_criteria, n_samples, rng, alpha=None):
    """Sample valid weight vectors directly on the simplex."""
    degenerate = _uniform_simplex_samples(num_criteria, n_samples)
    if degenerate is not None:
        return degenerate

    concentration = np.asarray(alpha if alpha is not None else np.ones(num_criteria), dtype=float)
    concentration = np.maximum(concentration, EPS)
    return [sample for sample in rng.dirichlet(concentration, size=max(1, n_samples))]


def _generate_simplex_samples_from_cube(sequence_name, num_criteria, n_samples, print_fn=None):
    """Generate simplex points by sampling the unit cube then stick-breaking."""
    if print_fn is None:
        print_fn = print

    degenerate = _uniform_simplex_samples(num_criteria, n_samples)
    if degenerate is not None:
        return degenerate

    dim = num_criteria - 1
    try:
        if sequence_name == 'lhs':
            sampler = qmc.LatinHypercube(d=dim, scramble=True, seed=RNG_SEED)
            samples_unit = sampler.random(n=max(1, n_samples))
        elif sequence_name == 'sobol':
            sampler = qmc.Sobol(d=dim, scramble=True, seed=RNG_SEED)
            samples_unit = sampler.random(n=max(1, n_samples))
        else:
            raise ValueError(f"Unsupported cube sequence '{sequence_name}'")
    except Exception:
        fallback = 'Halton' if sequence_name == 'sobol' else 'random'
        print_fn(f"  ({sequence_name.upper()} sampler unavailable, using {fallback} fallback)")
        if sequence_name == 'sobol':
            try:
                sampler = qmc.Halton(d=dim, scramble=True, seed=RNG_SEED)
                samples_unit = sampler.random(n=max(1, n_samples))
            except Exception:
                rng = np.random.RandomState(RNG_SEED)
                samples_unit = rng.random((max(1, n_samples), dim))
        else:
            rng = np.random.RandomState(RNG_SEED)
            samples_unit = rng.random((max(1, n_samples), dim))

    return [_to_simplex_from_unit(sample) for sample in samples_unit]


def _append_anchor(weights_list, anchor_weights):
    """Append the Phase 1 anchor to a list of candidate weights."""
    if anchor_weights is not None:
        weights_list.append(_normalize_weights(anchor_weights))
    return weights_list


def _build_smooth_feasibility_constraints(constraint_data, z_cap, use_non_linear_model=True):
    """Build smooth feasibility constraints for SLSQP-based searches."""
    constraints = [{'type': 'eq', 'fun': lambda w: np.sum(w) - 1.0}]

    for comp in constraint_data['comparisons']:
        ref_crit = comp['REFERENCE_CRITERION']
        adj_crit = comp['ADJUSTED_CRITERION']
        comp_value = comp['DATA_VALUE']

        ref_idx = constraint_data['criterion_to_index'][ref_crit]
        adj_idx = constraint_data['criterion_to_index'][adj_crit]

        vf_adj = constraint_data['value_functions'][adj_crit]
        vf_adj_val = max(vf_adj(comp_value), EPS)
        inv_vf = 1.0 / vf_adj_val

        if use_non_linear_model:
            def _residual(w, ri=ref_idx, ai=adj_idx, c=inv_vf):
                return c - (w[ai] + EPS) / (w[ri] + EPS)
        else:
            def _residual(w, ri=ref_idx, ai=adj_idx, c=inv_vf):
                return c * w[ri] - w[ai]

        constraints.append({'type': 'ineq', 'fun': lambda w, fn=_residual, z=z_cap: z - fn(w)})
        constraints.append({'type': 'ineq', 'fun': lambda w, fn=_residual, z=z_cap: z + fn(w)})

    return constraints


def _run_directional_slsqp(seed_weights, direction, num_criteria, feasibility_constraints):
    """Run a simplex-constrained directional search from a given seed."""
    return opt.minimize(
        fun=lambda w, d=direction: float(np.dot(d, w)),
        x0=_normalize_weights(seed_weights),
        method='SLSQP',
        bounds=[(EPS, 1.0) for _ in range(num_criteria)],
        constraints=feasibility_constraints,
        options={'maxiter': 400, 'ftol': 1e-10},
    )


def sample_feasible_region_lhs(
    constraint_data,
    num_criteria,
    z_cap,
    anchor_weights=None,
    n_samples=None,
    use_non_linear_model=True,
    print_fn=None,
):
    """Sample simplex weights with LHS and pass them to Phase 3 filtering."""
    if print_fn is None:
        print_fn = print
    if n_samples is None:
        n_samples = LHS_SAMPLES

    print_fn(f"Generating {n_samples} samples via Latin Hypercube Sampling...")
    weights_list = _generate_simplex_samples_from_cube('lhs', num_criteria, n_samples, print_fn=print_fn)
    _append_anchor(weights_list, anchor_weights)
    print_fn("Skipping local optimization; sending raw LHS simplex samples to filtering...")
    return weights_list


def sample_feasible_region_dirichlet(
    constraint_data,
    num_criteria,
    z_cap,
    anchor_weights=None,
    n_samples=None,
    use_non_linear_model=True,
    print_fn=None,
):
    """Sample the simplex directly with a uniform Dirichlet distribution."""
    if print_fn is None:
        print_fn = print
    if n_samples is None:
        n_samples = PHASE2_SAMPLES

    print_fn(f"Generating {n_samples} direct Dirichlet samples on the simplex...")
    rng = np.random.RandomState(RNG_SEED)
    weights_list = _dirichlet_samples(num_criteria, n_samples, rng)
    _append_anchor(weights_list, anchor_weights)
    return weights_list


def sample_feasible_region_sobol(
    constraint_data,
    num_criteria,
    z_cap,
    anchor_weights=None,
    n_samples=None,
    use_non_linear_model=True,
    print_fn=None,
):
    """Sample the simplex using a Sobol low-discrepancy sequence."""
    if print_fn is None:
        print_fn = print
    if n_samples is None:
        n_samples = PHASE2_SAMPLES

    print_fn(f"Generating {n_samples} Sobol samples via simplex mapping...")
    weights_list = _generate_simplex_samples_from_cube('sobol', num_criteria, n_samples, print_fn=print_fn)
    _append_anchor(weights_list, anchor_weights)
    return weights_list


def sample_feasible_region_ball_walk(
    constraint_data,
    num_criteria,
    z_cap,
    anchor_weights=None,
    n_samples=None,
    use_non_linear_model=True,
    print_fn=None,
):
    """Explore the feasible region with a simple ball-walk MCMC sampler."""
    if print_fn is None:
        print_fn = print
    if n_samples is None:
        n_samples = PHASE2_SAMPLES

    violation_objective = partial(
        compute_max_violation_weights_only,
        constraint_data=constraint_data,
        use_non_linear_model=use_non_linear_model,
    )
    current = _normalize_weights(anchor_weights)
    samples = []
    rng = np.random.RandomState(RNG_SEED)
    burn_in = BALL_WALK_BURN_IN
    thinning = BALL_WALK_THINNING
    total_steps = burn_in + max(1, n_samples) * thinning
    step_scale = BALL_WALK_STEP_SCALE / max(1.0, np.sqrt(num_criteria))
    accepted = 0

    print_fn(
        f"Running ball walk for {total_steps} steps "
        f"(burn-in={burn_in}, thinning={thinning}, scale={step_scale:.4f})..."
    )

    for step_idx in range(total_steps):
        direction = rng.normal(size=num_criteria)
        direction -= np.mean(direction)
        proposal = _normalize_weights(np.maximum(current + step_scale * direction, EPS))

        if violation_objective(proposal) <= z_cap:
            current = proposal
            accepted += 1

        if step_idx >= burn_in and (step_idx - burn_in) % thinning == 0:
            samples.append(current.copy())

    print_fn(f"Ball walk acceptance rate: {accepted / max(1, total_steps):.2%}")
    _append_anchor(samples, anchor_weights)
    return samples


def sample_feasible_region_adaptive_dirichlet(
    constraint_data,
    num_criteria,
    z_cap,
    anchor_weights=None,
    n_samples=None,
    use_non_linear_model=True,
    print_fn=None,
):
    """Adapt a Dirichlet proposal toward low-violation regions."""
    if print_fn is None:
        print_fn = print
    if n_samples is None:
        n_samples = PHASE2_SAMPLES

    violation_objective = partial(
        compute_max_violation_weights_only,
        constraint_data=constraint_data,
        use_non_linear_model=use_non_linear_model,
    )
    rng = np.random.RandomState(RNG_SEED)
    alpha = np.ones(num_criteria)
    if anchor_weights is not None:
        alpha = np.maximum(alpha + 4.0 * num_criteria * _normalize_weights(anchor_weights), EPS)

    ranked_candidates = []
    print_fn(f"Running adaptive Dirichlet search over {ADAPTIVE_ROUNDS} rounds...")

    for round_idx in range(ADAPTIVE_ROUNDS):
        batch = np.asarray(_dirichlet_samples(num_criteria, ADAPTIVE_BATCH_SIZE, rng, alpha=alpha))
        scores = np.asarray([violation_objective(sample) for sample in batch])
        order = np.argsort(scores)
        elite_count = max(12, ADAPTIVE_BATCH_SIZE // 10)
        elite = batch[order[:elite_count]]
        elite_scores = scores[order[:elite_count]]

        ranked_candidates.extend((score, sample.copy()) for score, sample in zip(scores[order], batch[order]))

        elite_mean = np.mean(elite, axis=0)
        concentration = (6.0 + 4.0 * round_idx) * num_criteria
        alpha = np.maximum(elite_mean * concentration, 0.1)
        print_fn(
            f"  Round {round_idx + 1}/{ADAPTIVE_ROUNDS}: "
            f"best={elite_scores[0]:.6f}, median-elite={np.median(elite_scores):.6f}"
        )

    ranked_candidates.sort(key=lambda item: item[0])
    weights_list = [sample for _, sample in ranked_candidates[:max(1, n_samples)]]
    _append_anchor(weights_list, anchor_weights)
    return weights_list


def sample_feasible_region_multistart_optimization(
    constraint_data,
    num_criteria,
    z_cap,
    anchor_weights=None,
    n_samples=None,
    use_non_linear_model=True,
    print_fn=None,
):
    """Generate candidates with many constrained local searches from diverse seeds."""
    if print_fn is None:
        print_fn = print

    n_starts = min(max(24, num_criteria * 8), n_samples or MULTISTART_RESTARTS, MULTISTART_RESTARTS)
    violation_objective = partial(
        compute_max_violation_weights_only,
        constraint_data=constraint_data,
        use_non_linear_model=use_non_linear_model,
    )
    feasibility_constraints = _build_smooth_feasibility_constraints(
        constraint_data, z_cap, use_non_linear_model=use_non_linear_model
    )
    rng = np.random.RandomState(RNG_SEED)
    seeds = _dirichlet_samples(num_criteria, max(1, n_starts - 1), rng)
    if anchor_weights is not None:
        seeds = [_normalize_weights(anchor_weights)] + seeds

    print_fn(f"Running {len(seeds)} multi-start constrained searches...")
    optimized = []
    successes = 0

    for seed in seeds:
        direction = rng.normal(size=num_criteria)
        direction -= np.mean(direction)
        result = _run_directional_slsqp(seed, direction, num_criteria, feasibility_constraints)
        candidate = _normalize_weights(result.x if result.success else seed)
        if violation_objective(candidate) <= z_cap:
            optimized.append(candidate)
            if result.success:
                successes += 1

    print_fn(f"Successful feasible local optimizations: {successes}/{len(seeds)}")
    return optimized


def sample_feasible_region_extreme_points(
    constraint_data,
    num_criteria,
    z_cap,
    anchor_weights=None,
    n_samples=None,
    use_non_linear_model=True,
    print_fn=None,
):
    """Approximate extreme points by optimizing directional objectives."""
    if print_fn is None:
        print_fn = print

    direction_budget = min(max(2 * num_criteria, 12), n_samples or EXTREME_POINT_DIRECTIONS, EXTREME_POINT_DIRECTIONS)
    feasibility_constraints = _build_smooth_feasibility_constraints(
        constraint_data, z_cap, use_non_linear_model=use_non_linear_model
    )
    violation_objective = partial(
        compute_max_violation_weights_only,
        constraint_data=constraint_data,
        use_non_linear_model=use_non_linear_model,
    )
    rng = np.random.RandomState(RNG_SEED)

    directions = []
    for crit_idx in range(num_criteria):
        axis = np.zeros(num_criteria)
        axis[crit_idx] = 1.0
        directions.append(axis)
        directions.append(-axis)

    while len(directions) < direction_budget:
        direction = rng.normal(size=num_criteria)
        direction -= np.mean(direction)
        norm = np.linalg.norm(direction)
        if norm > 0:
            directions.append(direction / norm)

    seed_pool = _dirichlet_samples(num_criteria, max(1, min(len(directions), 16)), rng)
    if anchor_weights is not None:
        seed_pool.insert(0, _normalize_weights(anchor_weights))
    else:
        seed_pool.insert(0, np.full(num_criteria, 1.0 / num_criteria))

    print_fn(f"Searching for extreme points across {len(directions)} directions...")
    candidates = []
    for idx, direction in enumerate(directions):
        seed = seed_pool[idx % len(seed_pool)]
        result = _run_directional_slsqp(seed, direction, num_criteria, feasibility_constraints)
        candidate = _normalize_weights(result.x if result.success else seed)
        if violation_objective(candidate) <= z_cap:
            candidates.append(candidate)

    return candidates


def sample_feasible_region(
    method,
    constraint_data,
    num_criteria,
    z_cap,
    anchor_weights=None,
    n_samples=None,
    use_non_linear_model=True,
    print_fn=None,
):
    """Dispatch Phase 2 candidate generation to the selected method."""
    normalized_method = normalize_weight_sampling_method(method)
    sampler_map = {
        'lhs_simplex': sample_feasible_region_lhs,
        'dirichlet': sample_feasible_region_dirichlet,
        'sobol_simplex': sample_feasible_region_sobol,
        'ball_walk': sample_feasible_region_ball_walk,
        'adaptive_dirichlet': sample_feasible_region_adaptive_dirichlet,
        'multistart_optimization': sample_feasible_region_multistart_optimization,
        'extreme_points': sample_feasible_region_extreme_points,
    }
    return sampler_map[normalized_method](
        constraint_data,
        num_criteria,
        z_cap,
        anchor_weights=anchor_weights,
        n_samples=n_samples,
        use_non_linear_model=use_non_linear_model,
        print_fn=print_fn,
    )

def check_sum_to_one(weights, threshold=0.001):
    """Check if weights sum to 1 within threshold."""
    return abs(np.sum(weights) - 1.0) <= threshold


def check_constraints_satisfied(weights, constraint_data, tol=FEASIBILITY_TOL, use_non_linear_model=True):
    """Check if weights satisfy all constraints within tolerance."""
    violation = compute_max_violation_weights_only(
        weights, constraint_data, use_non_linear_model=use_non_linear_model
    )
    return violation <= tol


def constraint_func(x, constraint_data, z_star=None, use_non_linear_model=True):
    """Legacy constraint function for backward compatibility with upmavt.py.
    
    Evaluates configured constraints in logarithmic z-variable format.
    
    Mathematical formulation:
        For each comparison residual:
            residual = 1/vf_adjusted(value) - w_adjusted/w_reference
            violation = abs(residual) [two_sided]
            violation = max(0, residual) [one_sided]
            violation <= z
        In logarithmic form (with EPS floor):
            log(z) - log(max(violation, EPS)) >= 0
    
    Parameters
    ----------
    x : ndarray
        [w_crit1, w_crit2, ..., w_critN, z] where z bounds all violations
    constraint_data : dict
        Constraint structure
    z_star : float, optional
        Upper bound on z (if provided, adds constraint z <= z_star)
    
    Returns
    -------
    list[float]
        Constraint values (must all be >= 0 for feasibility)
    """
    weights = x[:-1]  # All but last element are weights
    z = x[-1]  # Last element is the z variable
    violation_mode = constraint_data.get('violation_mode', 'two_sided')
    
    violations = []
    for comp_type, w_ref, w_adj, vf_adj_val in _iter_comparison_terms(weights, constraint_data):
        violation = _comparison_violation(
            comp_type,
            w_ref,
            w_adj,
            vf_adj_val,
            use_non_linear_model=use_non_linear_model,
            violation_mode=violation_mode,
        )
        violations.append(np.log(max(z, EPS)) - np.log(max(violation, EPS)))

    return violations


# ============================================================================
# OPTIMIZATION
# ============================================================================
# ============================================================================
# OPTIMIZATION - Three-Phase Approach
# ============================================================================
def _find_minimum_infeasibility_de(constraint_data, num_criteria, use_non_linear_model=True, print_fn=None):
    """PHASE 1: Find the minimum achievable constraint violation.
    
    Uses global optimization via Differential Evolution.
    
    This determines the best feasibility we can achieve, which defines the boundary
    of the feasible region.
    
    Parameters
    ----------
    constraint_data : dict
        Constraint structure.
    num_criteria : int
        Number of criteria (weight vector dimension).
    print_fn : callable or None
        Logging function.
    
    Returns
    -------
    tuple
        (best_weights, minimum_violation)
    """
    if print_fn is None:
        print_fn = print
    raw_objective = partial(
        compute_max_violation_weights_only,
        constraint_data=constraint_data,
        use_non_linear_model=use_non_linear_model,
    )

    # DE is run in box bounds and then projected to simplex for objective eval.
    # This avoids sum-to-one drift while keeping compatibility across SciPy versions.
    def objective(w):
        return raw_objective(_normalize_weights(w))
    
    bounds = [(0.001, 1.0) for _ in range(num_criteria)]
    
    # ========================================================================
    # STAGE 1: Global optimization via Differential Evolution
    # ========================================================================
    print_fn("  Stage 1: Global search via Differential Evolution...")
    
    de_result = opt.differential_evolution(
        objective,
        bounds,
        seed=RNG_SEED,
        maxiter=1000,
        popsize=30,
        atol=0.0,
        tol=1e-10,
        workers=1,
    )
    
    de_weights = _normalize_weights(de_result.x)
    de_violation = raw_objective(de_weights)
    print_fn(f"    Global best violation: {de_violation:.6f}")

    print_fn(f"  Final minimum violation: {de_violation:.6f}")
    return de_weights, de_violation


def _cds_is_better(candidate, incumbent):
    """Constraint-domination comparator used for evolutionary selection."""
    if candidate['feasible'] != incumbent['feasible']:
        return candidate['feasible']

    if candidate['feasible']:
        if abs(candidate['z'] - incumbent['z']) > 1e-12:
            return candidate['z'] < incumbent['z']
        return candidate['violation'] < incumbent['violation']

    if abs(candidate['cv'] - incumbent['cv']) > 1e-12:
        return candidate['cv'] < incumbent['cv']
    return candidate['violation'] < incumbent['violation']


def _evaluate_cds_candidate(weights, z_value, violation_objective):
    """Evaluate one CDS candidate and compute feasibility/violation metrics."""
    w = _normalize_weights(weights)
    z = max(float(z_value), 0.0)
    violation = float(violation_objective(w))
    cv = max(0.0, violation - z)
    return {
        'weights': w,
        'z': z,
        'violation': violation,
        'cv': cv,
        'feasible': cv <= CDS_FEAS_TOL,
    }


def _find_minimum_infeasibility_cds(constraint_data, num_criteria, use_non_linear_model=True, print_fn=None):
    """Phase 1 via constraint-domination evolutionary search over (w, z)."""
    if print_fn is None:
        print_fn = print

    rng = np.random.RandomState(RNG_SEED)
    violation_objective = partial(
        compute_max_violation_weights_only,
        constraint_data=constraint_data,
        use_non_linear_model=use_non_linear_model,
    )
    pop_size = max(CDS_MIN_POPULATION, CDS_POPULATION_FACTOR * max(1, num_criteria))
    generations = CDS_GENERATIONS

    print_fn(
        "  Stage 1: Global search via CDS evolutionary optimization "
        f"(population={pop_size}, generations={generations})..."
    )

    if num_criteria == 1:
        base_population = [np.array([1.0], dtype=float) for _ in range(pop_size)]
    else:
        base_population = [sample for sample in rng.dirichlet(np.ones(num_criteria), size=pop_size)]

    raw_violations = [float(violation_objective(w)) for w in base_population]
    z_scale = max(1e-6, float(np.percentile(raw_violations, 90)))

    population = []
    for w, v in zip(base_population, raw_violations):
        # Initialize z around the observed violation so both feasible and
        # improving-infeasible individuals exist in the first generation.
        jitter = rng.uniform(0.75, 1.25)
        z_init = max(0.0, v * jitter)
        population.append(_evaluate_cds_candidate(w, z_init, violation_objective))

    global_best = min(population, key=lambda c: (not c['feasible'], c['z'], c['cv'], c['violation']))

    for generation in range(generations):
        next_population = []

        for i in range(pop_size):
            target = population[i]
            idx_pool = [idx for idx in range(pop_size) if idx != i]
            a_idx, b_idx, c_idx = rng.choice(idx_pool, size=3, replace=False)
            a = population[a_idx]
            b = population[b_idx]
            c = population[c_idx]

            mutant_w = a['weights'] + CDS_MUTATION_FACTOR * (b['weights'] - c['weights'])
            mutant_w = _normalize_weights(np.maximum(mutant_w, EPS))
            mutant_z = max(0.0, a['z'] + CDS_MUTATION_FACTOR * (b['z'] - c['z']))

            cross_mask = rng.rand(num_criteria) < CDS_CROSSOVER_RATE
            if not np.any(cross_mask):
                cross_mask[rng.randint(0, num_criteria)] = True

            trial_w = np.where(cross_mask, mutant_w, target['weights'])
            trial_w = _normalize_weights(trial_w)
            trial_z = mutant_z if rng.rand() < CDS_CROSSOVER_RATE else target['z']
            trial = _evaluate_cds_candidate(trial_w, trial_z, violation_objective)

            winner = trial if _cds_is_better(trial, target) else target
            next_population.append(winner)

            if _cds_is_better(winner, global_best):
                global_best = winner

        population = next_population
        if generation % max(1, generations // 6) == 0:
            best_gen = min(population, key=lambda c: (not c['feasible'], c['z'], c['cv'], c['violation']))
            print_fn(
                f"    Gen {generation:03d}: best z={best_gen['z']:.6f}, "
                f"violation={best_gen['violation']:.6f}, feasible={best_gen['feasible']}"
            )

    best_candidate = min(population + [global_best], key=lambda c: (not c['feasible'], c['z'], c['cv'], c['violation']))
    best_weights = _normalize_weights(best_candidate['weights'])
    best_violation = float(violation_objective(best_weights))

    print_fn(f"    CDS best z: {best_candidate['z']:.6f}")
    print_fn(f"    CDS best true violation: {best_violation:.6f}")
    print_fn(f"  Final minimum violation: {best_violation:.6f}")
    return best_weights, best_violation


def find_minimum_infeasibility(
    constraint_data,
    num_criteria,
    use_non_linear_model=True,
    print_fn=None,
    phase1_method=DEFAULT_PHASE1_METHOD,
):
    """Dispatch Phase 1 minimum-violation search method."""
    method = normalize_phase1_method(phase1_method)
    if method == 'differential_evolution':
        return _find_minimum_infeasibility_de(
            constraint_data,
            num_criteria,
            use_non_linear_model=use_non_linear_model,
            print_fn=print_fn,
        )
    return _find_minimum_infeasibility_cds(
        constraint_data,
        num_criteria,
        use_non_linear_model=use_non_linear_model,
        print_fn=print_fn,
    )


def enumerate_weight_space(weights_list, criterion_names, min_violation=0.0,
                          constraint_data=None, use_non_linear_model=True,
                          z_cap=None, print_fn=None):
    """PHASE 3: Filter and deduplicate feasible weight solutions at full precision.

    Keeps candidates whose violation <= z_cap, deduplicates at float precision,
    and formats as output solutions (no rounding/quantization).

    Parameters
    ----------
    weights_list : list[ndarray]
        Raw weight vectors coming from Phase 2.
    criterion_names : list[str]
        Criterion names for output.
    min_violation : float
        Minimum achievable violation found in Phase 1 (used only for logging).
    constraint_data : dict or None
        Constraint structure for filtering.
    z_cap : float or None
        Acceptance threshold. If None, falls back to
        min_violation * (1 + DEFAULT_PHASE3_TOLERANCE_PCT/100).
    use_non_linear_model : bool
    print_fn : callable or None

    Returns
    -------
    tuple
        (weight_solutions, num_unique_weights)
    """
    if print_fn is None:
        print_fn = print

    threshold = (
        z_cap
        if z_cap is not None
        else min_violation * (1.0 + DEFAULT_PHASE3_TOLERANCE_PCT / 100.0)
    )
    
    print_fn(f"Filtering to feasible solutions (violation <= {threshold:.6f})...")
    
    # Compute violations for all weights and collect statistics
    all_violations = []
    feasible = []
    for w in weights_list:
        if constraint_data is not None:
            violation = compute_max_violation_weights_only(
                w, constraint_data, use_non_linear_model=use_non_linear_model
            )
            all_violations.append(violation)
            if violation <= threshold:
                feasible.append(w)
        else:
            feasible.append(w)
    
    # Report violation statistics
    if all_violations:
        all_violations_arr = np.array(all_violations)
        print_fn(f"Violation statistics across {len(all_violations)} samples:")
        print_fn(f"  Min: {np.min(all_violations_arr):.6f}")
        print_fn(f"  Max: {np.max(all_violations_arr):.6f}")
        print_fn(f"  Mean: {np.mean(all_violations_arr):.6f}")
        print_fn(f"  Std: {np.std(all_violations_arr):.6f}")
        print_fn(f"  Phase 1 best: {min_violation:.6f}")
        print_fn(f"  Tolerance threshold: {threshold:.6f}")
    
    print_fn(f"Feasible solutions: {len(feasible)}")
    
    if not feasible:
        print_fn("WARNING: No feasible solutions found after filtering!")
        return [], 0
    
    feasible_array = np.array(feasible)
    
    print_fn("Deduplicating at full precision...")
    # Deduplicate solutions by treating nearly-identical floats as equal.
    # Use a coarse tolerance (1e-10) suitable for the precision of solver output.
    unique_indices = np.unique(np.round(feasible_array, 10), axis=0, return_index=True)[1]
    unique_weights = feasible_array[np.sort(unique_indices)]

    print_fn(f"Unique solutions: {len(unique_weights)}")
    
    # Format for database as complete solutions (full precision, no rounding)
    weight_solutions = []
    for w in unique_weights:
        solution = {
            crit_name: float(w[crit_idx])
            for crit_idx, crit_name in enumerate(criterion_names)
        }
        # Ensure sum exactly equals 1 (numerical cleanup for storage)
        w_sum = sum(solution.values())
        if abs(w_sum - 1.0) > 1e-10:
            # Normalize proportionally to ensure sum = 1.0
            for crit_name in solution:
                solution[crit_name] /= w_sum
        weight_solutions.append(solution)

    return weight_solutions, len(unique_weights)


# ============================================================================
# MAIN ENTRY POINT (called by the worker)
# ============================================================================
def compute_weights(
    value_functions,
    comparisons,
    criteria_names=None,
    print_fn=None,
    use_non_linear_model=True,
    phase1_method=DEFAULT_PHASE1_METHOD,
    weight_sampling_method=DEFAULT_WEIGHT_SAMPLING_METHOD,
    phase3_tolerance_pct=DEFAULT_PHASE3_TOLERANCE_PCT,
):
    """Compute weight space using three-phase approach.
    
    PHASE 1: Find minimum infeasibility (best possible constraint satisfaction)
    PHASE 2: Generate candidate weights with the selected sampling method
    PHASE 3: Filter and deduplicate solutions at full float precision

    Parameters
    ----------
    value_functions : dict
        Mapping criterion_name -> scipy interp1d function object.
    comparisons : list[dict]
        List of comparison dicts with REFERENCE_CRITERION, ADJUSTED_CRITERION, DATA_VALUE, TYPE, GROUP.
    criteria_names : list[str] or None
        List of criterion names. If None, extracted from value_functions.
    print_fn : callable or None
        Function to call for logging (defaults to ``print``).

    Returns
    -------
    list[dict]
        Complete feasible weight solutions (unrounded, full precision).
    """
    if print_fn is None:
        print_fn = print

    phase1_method = normalize_phase1_method(phase1_method)
    weight_sampling_method = normalize_weight_sampling_method(weight_sampling_method)
    try:
        phase3_tolerance_pct = max(0.0, float(phase3_tolerance_pct))
    except (TypeError, ValueError):
        phase3_tolerance_pct = DEFAULT_PHASE3_TOLERANCE_PCT

    print_fn("=" * 70)
    print_fn("THREE-PHASE WEIGHT SPACE EXPLORATION")
    print_fn("=" * 70)
    print_fn(f"Model: {'non-linear' if use_non_linear_model else 'linear'}")
    print_fn(f"Phase 1 method: {get_phase1_method_label(phase1_method)}")
    print_fn(f"Phase 2 method: {get_weight_sampling_method_label(weight_sampling_method)}")
    print_fn(f"Phase 3 tolerance LIM: {phase3_tolerance_pct:.4f}%")

    if not criteria_names:
        criteria_names = list(value_functions.keys())
    
    print_fn(f"✓ Value functions: {len(value_functions)}")
    print_fn(f"✓ Comparisons: {len(comparisons)}")

    if not comparisons:
        print_fn("ERROR: No comparisons found.")
        return []

    if not value_functions:
        print_fn("ERROR: No value functions found.")
        return []

    print_fn("\n[SETUP] Building constraint structure...")
    constraint_data = build_constraint_structure(comparisons, value_functions)
    constraint_data['violation_mode'] = (
        'one_sided' if phase1_method == 'constraint_dominated_ea' else 'two_sided'
    )
    crit_names = constraint_data['criteria']
    num_criteria = len(crit_names)

    print_fn(f"  ✓ Number of criteria: {num_criteria}")
    print_fn(f"  ✓ Criteria: {crit_names}")
    print_fn(f"  ✓ Number of constraints: {len(comparisons)}")
    print_fn(f"  ✓ Violation mode: {constraint_data['violation_mode']}")

    # ========================================================================
    # PHASE 1: Find minimum infeasibility
    # ========================================================================
    print_fn("\n" + "=" * 70)
    print_fn("PHASE 1: Finding minimum constraint violation")
    print_fn("=" * 70)
    
    best_weights, min_violation = find_minimum_infeasibility(
        constraint_data, num_criteria,
        use_non_linear_model=use_non_linear_model,
        print_fn=print_fn,
        phase1_method=phase1_method,
    )
    
    print_fn(f"\nBest solution found:")
    print_fn(f"  Weights: {np.round(best_weights, 4)}")
    print_fn(f"  Max violation: {min_violation:.8f}")
    print_fn(f"  Sum check: {np.sum(best_weights):.6f}")
    print_constraint_results(
        best_weights,
        constraint_data,
        use_non_linear_model=use_non_linear_model,
        print_fn=print_fn,
    )
    
    if min_violation > 10:
        print_fn("\nWARNING: Minimum violation is large (>10).")
        print_fn("This may indicate infeasible or very constrained problem.")

    # z_cap defines the acceptance band: solutions with violation <= z_cap are kept.
    # Formula requested by UI/workflow setting:
    #   z_cap = z_star + z_star * LIM
    # where LIM is expressed as a percentage.
    z_cap = min_violation + min_violation * (phase3_tolerance_pct / 100.0)
    print_fn(f"  Optimal violation (z*):      {min_violation:.8f}")
    print_fn(
        f"  Acceptance cap (z_cap):      {z_cap:.8f}  "
        f"(+{phase3_tolerance_pct:.4f}% of z*)"
    )

    # Linear model mode only needs the best Phase 1 solution.
    if not use_non_linear_model:
        best_weights = best_weights / np.sum(best_weights)
        single_solution = {
            crit_name: round(float(best_weights[idx]), 3)
            for idx, crit_name in enumerate(crit_names)
        }

        print_fn("\nSkipping Phase 2 and Phase 3 for linear model.")
        print_fn("Using the best Phase 1 solution as final result.")
        print_fn("\n" + "=" * 70)
        print_fn("SUMMARY")
        print_fn("=" * 70)
        print_fn("Total feasible solutions enumerated: 1")
        print_fn("Criteria in solutions:")
        for crit_name in sorted(single_solution.keys()):
            print_fn(f"  {crit_name}")
        print_fn("\nWeight space computation complete.")
        print_fn("=" * 70)

        return [single_solution]

    # ========================================================================
    # PHASE 2: Sample feasible region
    # ========================================================================
    print_fn("\n" + "=" * 70)
    print_fn("PHASE 2: Sampling feasible region")
    print_fn("=" * 70)
    
    sampled_weights = sample_feasible_region(
        weight_sampling_method,
        constraint_data, num_criteria,
        z_cap=z_cap,
        anchor_weights=best_weights,
        n_samples=PHASE2_SAMPLES,
        use_non_linear_model=use_non_linear_model,
        print_fn=print_fn
    )

    # Always keep the valid Phase 1 point, even if Phase 2 finds none.
    sampled_weights = [_normalize_weights(best_weights)] + sampled_weights

    # ========================================================================
    # PHASE 3: Enumerate unique solutions
    # ========================================================================
    print_fn("\n" + "=" * 70)
    print_fn("PHASE 3: Enumerating unique solutions")
    print_fn("=" * 70)
    
    weight_solutions, num_unique = enumerate_weight_space(
        sampled_weights, crit_names,
        min_violation=min_violation,
        constraint_data=constraint_data,
        use_non_linear_model=use_non_linear_model,
        z_cap=z_cap,
        print_fn=print_fn
    )
    
    # ========================================================================
    # Summary
    # ========================================================================
    print_fn("\n" + "=" * 70)
    print_fn("SUMMARY")
    print_fn("=" * 70)
    print_fn(f"Total feasible solutions enumerated: {num_unique}")
    if weight_solutions:
        print_fn("Criteria in solutions:")
        for crit_name in sorted(weight_solutions[0].keys()):
            print_fn(f"  {crit_name}")
    
    print_fn("\nWeight space computation complete.")
    print_fn("=" * 70)
    
    return weight_solutions
