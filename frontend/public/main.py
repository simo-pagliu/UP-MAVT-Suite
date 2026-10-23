#!/usr/bin/env python3
"""
UP-MAVT Local Standalone - Interactive CLI Workflow

Runs the Run UP-MAVT workflow of the web app on an exported study, without the
backend or MongoDB. Every step is computed by the web worker's own code
(scripts/workflow_steps.py); this script only loads the exported files
(load_LOCAL.py), asks for the run options and writes CSV files and plots.

Usage:
    python main.py [--data-dir data] [--output-dir results]
"""

import argparse
import csv
import logging
import os
import sys
from pathlib import Path

# Add current directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from load_LOCAL import (
    load_input_data,
    load_session_data,
    load_computed_weights,
    save_weight_solutions_csv,
    select_sessions,
    load_analysis_settings,
    load_aggregation_settings,
)
from scripts.session_inputs import compute_opinion_weights
from scripts.workflow_steps import compute_session_weights, run_step

logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(message)s',
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

try:
    import matplotlib
    matplotlib.use('Agg')  # Non-interactive backend
    import matplotlib.pyplot as plt
    PLOTTING_AVAILABLE = True
except ImportError:
    PLOTTING_AVAILABLE = False
    logger.warning("matplotlib not available. Plots will not be generated.")


class ConsolePrompt:
    """Helper for interactive prompts."""

    @staticmethod
    def yes_no(question, default='n'):
        """Ask yes/no question."""
        choices = 'y/n' if default.lower() == 'n' else 'Y/n'
        reply = input(f"{question} ({choices})? ").strip().lower()

        if not reply:
            return default.lower() == 'y'
        return reply == 'y'

    @staticmethod
    def choose_option(question, options, default_idx=0):
        """Ask user to choose from options."""
        print(f"\n{question}")
        for i, opt in enumerate(options):
            mark = " [default]" if i == default_idx else ""
            print(f"  {i + 1}. {opt}{mark}")

        while True:
            try:
                choice = input("Enter choice (1-" + str(len(options)) + "): ").strip()
                if not choice:
                    return options[default_idx]
                idx = int(choice) - 1
                if 0 <= idx < len(options):
                    return options[idx]
            except ValueError:
                pass
            print("Invalid choice.")

    @staticmethod
    def get_integer(question, default=1000, min_val=100, max_val=5000):
        """Get integer input."""
        while True:
            try:
                val = input(f"{question} [default: {default}]: ").strip()
                if not val:
                    return default
                num = int(val)
                if min_val <= num <= max_val:
                    return num
                print(f"Please enter a value between {min_val} and {max_val}.")
            except ValueError:
                print("Please enter a valid integer.")

    @staticmethod
    def get_float(question, default=0.0, min_val=-1.0, max_val=1.0):
        """Get a decimal number within [min_val, max_val]."""
        while True:
            try:
                val = input(f"{question} [default: {default}]: ").strip()
                if not val:
                    return default
                num = float(val)
                if min_val <= num <= max_val:
                    return num
                print(f"Please enter a value between {min_val} and {max_val}.")
            except ValueError:
                print("Please enter a valid number.")


def ensure_output_dir(output_dir):
    """Ensure output directory exists."""
    Path(output_dir).mkdir(parents=True, exist_ok=True)


# Aggregation methods of the engine (scripts/upmavt.py), as offered in the web
# app's Step 2: (label, engine method name, uses alpha).
AGGREGATION_METHODS = [
    ('WAM', 'weighted_sum', False),
    ('GEO', 'geometric_mean', False),
    ('HAR', 'harmonic_mean', False),
    ('GEO+offset', 'geometric_mean_offset', True),
    ('WAM+MIN', 'weighted_sum_min_mix', True),
    ('WPM', 'weighted_power_mean', True),
    ('WEM', 'weighted_exponential_mean', True),
]
AGGREGATION_LABELS = {method: label for label, method, _ in AGGREGATION_METHODS}
ALPHA_METHODS = {method for _, method, uses_alpha in AGGREGATION_METHODS if uses_alpha}


def describe_aggregation(method, alpha):
    """Readable name of an aggregation method, with its alpha when it uses one."""
    label = AGGREGATION_LABELS.get(method, method)
    return f"{label} (alpha={alpha})" if method in ALPHA_METHODS else label


def choose_aggregation(aggregation_settings):
    """Ask for the aggregation method used by Steps 3-5, and its alpha.

    Defaults to the method chosen in the web app's Step 2 and the alpha set
    there, so pressing Enter reproduces the web app's run.

    Returns
    -------
    tuple
        (engine method name, alpha)
    """
    methods = [method for _, method, _ in AGGREGATION_METHODS]
    chosen = aggregation_settings.get('chosen_method')
    options = [label for label, _, _ in AGGREGATION_METHODS]
    choice = ConsolePrompt.choose_option(
        "Aggregation method for Steps 3-5:",
        options,
        default_idx=methods.index(chosen) if chosen in methods else 0,
    )
    method = methods[options.index(choice)]
    alpha = 0.0
    if method in ALPHA_METHODS:
        alpha = ConsolePrompt.get_float(
            "Alpha (-1 to 1)",
            default=aggregation_settings.get('alphas', {}).get(method, 0.0),
        )
    return method, alpha


def step_params(mc_mode, mc_iterations, method, alpha, opinion_weights, methods=None, alphas=None):
    """Parameters of one step, as the web app's Run UP-MAVT page sends them."""
    params = {
        'mc_iterations': mc_iterations,
        'aggregation_method': method,
        'aggregation_alpha': alpha,
        'mc_mode': mc_mode,
        'use_random_weights': False,
        'opinion_weights': opinion_weights,
    }
    if methods is not None:
        params['aggregation_methods'] = methods
        params['aggregation_alphas'] = alphas
    return params


def plot_weight_space_2d(weight_solutions, output_path):
    """Plot weight space showing distribution of weights per criterion (like UI)."""
    if not PLOTTING_AVAILABLE or len(weight_solutions) < 1:
        return

    try:
        # Organize weights by criterion
        criteria_names = list(weight_solutions[0].keys())
        weights_by_criterion = {crit: [] for crit in criteria_names}

        for sol in weight_solutions:
            for crit in criteria_names:
                weights_by_criterion[crit].append(sol[crit])

        # Create figure with horizontal bars showing weight distributions
        fig, ax = plt.subplots(figsize=(10, max(6, len(criteria_names) * 0.8)))

        max_weight = max(max(weights) for weights in weights_by_criterion.values())

        for idx, crit in enumerate(criteria_names):
            weights = weights_by_criterion[crit]
            y = len(criteria_names) - idx - 1  # Reverse order for top-to-bottom

            # Plot each weight point
            for w in weights:
                ax.plot([w], [y], 'o', color='steelblue', markersize=4, alpha=0.6)

        ax.set_yticks(range(len(criteria_names)))
        ax.set_yticklabels(criteria_names[::-1])  # Reverse to match plot order
        ax.set_xlabel('Weight')
        ax.set_title(f'Weight Space Distribution ({len(weight_solutions)} solutions)')
        ax.set_xlim(0, max_weight * 1.1)
        ax.grid(True, alpha=0.3, axis='x')
        plt.tight_layout()
        plt.savefig(output_path, dpi=150, bbox_inches='tight')
        plt.close()
    except Exception as e:
        logger.warning("Could not create weight space plot: %s", e)


def plot_ranking_heatmap(results, output_path, title="Ranking Heatmap"):
    """Plot ranking probability heatmap for NSMC results (like UI)."""
    if not PLOTTING_AVAILABLE:
        return

    try:
        import numpy as np

        alternative_names = results.get('alternative_names', [])
        aggregated_results = results.get('aggregated_results', [])

        if not alternative_names or not aggregated_results:
            return

        n_alts = len(alternative_names)
        rank_counts = np.zeros((n_alts, n_alts))  # [rank, alternative]

        # Count how many times each alternative achieved each rank
        for iteration_scores in aggregated_results:
            if len(iteration_scores) != n_alts:
                continue

            # Rank alternatives (higher score = better rank)
            ranked_indices = np.argsort(iteration_scores)[::-1]  # Descending order

            for rank, alt_idx in enumerate(ranked_indices):
                rank_counts[rank, alt_idx] += 1

        # Convert to probabilities
        total_iterations = len(aggregated_results)
        rank_probabilities = rank_counts / total_iterations if total_iterations > 0 else rank_counts

        # Plot heatmap
        fig, ax = plt.subplots(figsize=(max(8, n_alts * 1.5), max(6, n_alts * 1.2)))

        im = ax.imshow(rank_probabilities, cmap='Blues', aspect='auto', vmin=0, vmax=1)

        # Set ticks
        ax.set_xticks(range(n_alts))
        ax.set_yticks(range(n_alts))
        ax.set_xticklabels(alternative_names, rotation=45, ha='right')
        ax.set_yticklabels([f'Rank {i+1}' for i in range(n_alts)])

        # Add percentage labels in cells
        for rank in range(n_alts):
            for alt in range(n_alts):
                prob = rank_probabilities[rank, alt]
                ax.text(alt, rank, f'{prob*100:.1f}%',
                        ha='center', va='center',
                        color='white' if prob > 0.6 else 'black',
                        fontsize=9, fontweight='bold')

        ax.set_title(title, fontsize=12, fontweight='bold', pad=15)
        ax.set_xlabel('Alternatives', fontsize=10)
        ax.set_ylabel('Ranking', fontsize=10)

        # Add colorbar
        cbar = plt.colorbar(im, ax=ax)
        cbar.set_label('Probability', rotation=270, labelpad=20)

        plt.tight_layout()
        plt.savefig(output_path, dpi=150, bbox_inches='tight')
        plt.close()
    except Exception as e:
        logger.warning("Could not create ranking heatmap: %s", e)


def plot_distributions(results, session_names, output_dir, prefix, title):
    """Plot each alternative's value distribution, one histogram per session (SMC steps)."""
    if not PLOTTING_AVAILABLE or 'results_by_elicitation' not in results:
        return

    for alt_idx, alt_name in enumerate(results.get('alternative_names', [])):
        plot_path = os.path.join(output_dir, f'{prefix}_distribution_{alt_name.replace(" ", "_")}.png')
        try:
            plt.figure(figsize=(10, 6))
            for elicit_idx_str, rows in sorted(results['results_by_elicitation'].items(), key=lambda item: int(item[0])):
                values = [row[alt_idx] for row in rows]
                plt.hist(values, alpha=0.5, label=session_names[int(elicit_idx_str)], bins=30)
            plt.xlabel('Value')
            plt.ylabel('Frequency')
            plt.title(f'{title} for {alt_name}')
            plt.legend(loc='upper left', bbox_to_anchor=(1.02, 1), borderaxespad=0, fontsize=9)
            plt.grid(True, alpha=0.3)
            plt.tight_layout()
            plt.savefig(plot_path, dpi=150, bbox_inches='tight')
            plt.close()
        except Exception as e:
            logger.warning("Could not create plot for %s: %s", alt_name, e)
    logger.info("✓ Distribution plots saved to: %s", output_dir)


def save_step_results_csv(results, output_path, session_names):
    """Save step results to CSV (one block per session for SMC steps)."""
    if not results:
        return

    try:
        with open(output_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            alt_names = results.get('alternative_names', [])

            # Strict mode (SMC): one block per session
            if 'results_by_elicitation' in results:
                for elicit_idx_str, rows in sorted(results['results_by_elicitation'].items(), key=lambda item: int(item[0])):
                    writer.writerow([session_names[int(elicit_idx_str)]])
                    writer.writerow(['iteration'] + alt_names)
                    for idx, row in enumerate(rows):
                        writer.writerow([idx] + row)
                    writer.writerow([])  # Empty row separator
            # Non-strict mode (NSMC): one pooled table
            elif 'aggregated_results' in results:
                writer.writerow(['iteration'] + alt_names)
                for idx, row in enumerate(results.get('aggregated_results', [])):
                    writer.writerow([idx] + row)
            else:
                logger.warning("No results data found in results structure")
                return
        logger.info("✓ Results saved to: %s", output_path)
    except Exception as e:
        logger.warning("Could not save results CSV: %s", e)


def step_1_compute_weights(data_dir, output_dir, session_docs, criteria):
    """Step 1: Finalize Elicited Data (compute each session's weight space)."""
    logger.info("\n" + "=" * 70)
    logger.info("STEP 1: FINALIZE ELICITED DATA (COMPUTE WEIGHTS)")
    logger.info("=" * 70)

    weights_file = os.path.join(output_dir, 'step1_weight_solutions.csv')

    # Check if weights already exist
    if os.path.exists(weights_file):
        logger.info("✓ Weight solutions file found: %s", weights_file)
        if not ConsolePrompt.yes_no("Skip weight computation and use existing file", default='y'):
            logger.info("Recomputing weights...")
        else:
            logger.info("Using existing weight solutions.")
            return load_computed_weights(weights_file)['weight_solutions']

    logger.info("\nComputing weights for %d elicitation(s)...", len(session_docs))

    try:
        # Same weight-space settings the study used in the web app (data/settings.json).
        settings = load_analysis_settings(data_dir)
        logger.info(
            "  Model: %s, phase 3 tolerance: %s%%, parameters: %s",
            'non-linear' if settings['use_non_linear_model'] else 'linear',
            settings['phase3_tolerance_pct'],
            settings['weight_space_parameters'] or 'defaults',
        )

        all_weight_solutions = {}

        for session_doc in session_docs:
            session_name = session_doc['name']
            logger.info("\n  Processing %s...", session_name)
            try:
                weight_result = compute_session_weights(
                    session_doc,
                    criteria,
                    use_non_linear_model=settings['use_non_linear_model'],
                    phase3_tolerance_pct=settings['phase3_tolerance_pct'],
                    weight_space_parameters=settings['weight_space_parameters'],
                    print_fn=lambda msg: None,
                )
            except ValueError as e:
                # Like the web app: a session whose weights cannot be computed is skipped.
                logger.warning("    %s, skipping session %s", e, session_name)
                continue
            ws = weight_result.get('accepted_solutions', [])
            all_weight_solutions[session_name] = ws

            logger.info("    ✓ %d feasible weight solutions found", len(ws))

        # Save to CSV
        save_weight_solutions_csv(weights_file, all_weight_solutions)
        logger.info("\n✓ Weight solutions saved to: %s", weights_file)

        # Plot weight space for each session
        if all_weight_solutions and PLOTTING_AVAILABLE:
            for session_name, ws in all_weight_solutions.items():
                if len(ws) > 0:
                    plot_path = os.path.join(output_dir, f'step1_weight_space_{session_name}.png')
                    plot_weight_space_2d(ws, plot_path)
                    logger.info("✓ Weight space plot for %s saved to: %s", session_name, plot_path)

        return all_weight_solutions

    except Exception as e:
        logger.error("✗ Error in Step 1: %s", e, exc_info=True)
        return None


def step_2_choose_aggregation(run, output_dir, aggregation_settings, opinion_weights):
    """Step 2: Choose Aggregation Method (compare methods with NSMC, then pick one)."""
    logger.info("\n" + "=" * 70)
    logger.info("STEP 2: CHOOSE AGGREGATION METHOD")
    logger.info("=" * 70)

    if ConsolePrompt.yes_no("Run Step 2 (compare aggregation methods)", default='n'):
        # The methods compared in the web app's Step 2, each with the alpha set there.
        methods = [method for method in aggregation_settings['compared_methods'] if method in AGGREGATION_LABELS]
        if not methods:
            methods = ['weighted_sum', 'geometric_mean', 'harmonic_mean']
        alphas = {
            method: aggregation_settings['alphas'].get(method, 0.0) if method in ALPHA_METHODS else 0.0
            for method in methods
        }
        mc_iters = ConsolePrompt.get_integer("MC Iterations (per method)", default=200)
        logger.info(
            "\nComparing %s, %d iterations each...",
            ', '.join(describe_aggregation(method, alphas[method]) for method in methods),
            mc_iters,
        )
        try:
            params = step_params('non_strict', mc_iters, methods[0], alphas[methods[0]], opinion_weights,
                                 methods=methods, alphas=alphas)
            results = run(4, params)
            for method, method_results in results['results_by_aggregation'].items():
                label = describe_aggregation(method, alphas.get(method, 0.0))
                save_step_results_csv(
                    method_results,
                    os.path.join(output_dir, f'step2_aggregation_{method}_results.csv'),
                    run.session_names,
                )
                if PLOTTING_AVAILABLE:
                    plot_path = os.path.join(output_dir, f'step2_aggregation_{method}_heatmap.png')
                    plot_ranking_heatmap(method_results, plot_path, title=f'{label} Aggregation Heatmap')
                    logger.info("✓ Heatmap saved to: %s", plot_path)
        except Exception as e:
            logger.error("✗ Error in Step 2: %s", e, exc_info=True)
    else:
        logger.info("Skipped the comparison.")

    # Like the web app, Steps 3-5 use the one method chosen here.
    method, alpha = choose_aggregation(aggregation_settings)
    logger.info("Steps 3-5 will use %s.", describe_aggregation(method, alpha))
    return method, alpha


def step_3_uncertainty_analysis(run, output_dir, method, alpha, opinion_weights):
    """Step 3: Uncertainty Analysis (SMC with the chosen aggregation method)."""
    logger.info("\n" + "=" * 70)
    logger.info("STEP 3: UNCERTAINTY ANALYSIS")
    logger.info("=" * 70)

    if not ConsolePrompt.yes_no("Run Step 3 (Uncertainty Analysis)", default='n'):
        logger.info("Skipped.")
        return

    mc_iters = ConsolePrompt.get_integer("MC Iterations", default=1000)
    logger.info("\nRunning uncertainty analysis with %s aggregation, %d iterations...",
                describe_aggregation(method, alpha), mc_iters)
    try:
        results = run(5, step_params('strict', mc_iters, method, alpha, opinion_weights))
        save_step_results_csv(results, os.path.join(output_dir, 'step3_uncertainty_results.csv'), run.session_names)
        plot_distributions(results, run.session_names, output_dir, 'step3', 'Uncertainty Distribution')
    except Exception as e:
        logger.error("✗ Error in Step 3: %s", e, exc_info=True)


def step_4_consensus_analysis(run, output_dir, method, alpha, opinion_weights):
    """Step 4: Consensus Analysis (SMC with the chosen aggregation method)."""
    logger.info("\n" + "=" * 70)
    logger.info("STEP 4: CONSENSUS ANALYSIS")
    logger.info("=" * 70)

    if not ConsolePrompt.yes_no("Run Step 4 (Consensus Analysis)", default='n'):
        logger.info("Skipped.")
        return

    mc_iters = ConsolePrompt.get_integer("MC Iterations", default=1000)
    logger.info("\nRunning consensus analysis with %s aggregation, %d iterations...",
                describe_aggregation(method, alpha), mc_iters)
    try:
        results = run(2, step_params('strict', mc_iters, method, alpha, opinion_weights))
        save_step_results_csv(results, os.path.join(output_dir, 'step4_consensus_results.csv'), run.session_names)
        plot_distributions(results, run.session_names, output_dir, 'step4', 'Distribution of Values')
    except Exception as e:
        logger.error("✗ Error in Step 4: %s", e, exc_info=True)


def step_5_final_results(run, output_dir, method, alpha, opinion_weights):
    """Step 5: Final Results (NSMC with the chosen aggregation method)."""
    logger.info("\n" + "=" * 70)
    logger.info("STEP 5: FINAL RESULTS")
    logger.info("=" * 70)

    if not ConsolePrompt.yes_no("Run Step 5 (Final Results)", default='n'):
        logger.info("Skipped.")
        return

    # Same default and limit as the web app's final step.
    mc_iters = ConsolePrompt.get_integer("MC Iterations", default=10000, max_val=10000)
    logger.info("\nComputing final results with %s aggregation, %d iterations...",
                describe_aggregation(method, alpha), mc_iters)
    try:
        results = run(6, step_params('non_strict', mc_iters, method, alpha, opinion_weights))
        save_step_results_csv(results, os.path.join(output_dir, 'step5_final_results.csv'), run.session_names)
        if PLOTTING_AVAILABLE:
            plot_path = os.path.join(output_dir, 'step5_final_heatmap.png')
            plot_ranking_heatmap(results, plot_path, title='Final Results Heatmap')
            logger.info("✓ Heatmap saved to: %s", plot_path)
    except Exception as e:
        logger.error("✗ Error in Step 5: %s", e, exc_info=True)


class StepRunner:
    """Runs workflow steps on the loaded sessions through scripts/workflow_steps.py."""

    def __init__(self, session_docs, criteria, weight_solutions):
        self.session_docs = session_docs
        self.session_names = [doc['name'] for doc in session_docs]
        self.criteria = criteria
        self.weight_solutions_list = [weight_solutions.get(name, []) for name in self.session_names]

    def __call__(self, engine_step, params):
        return run_step(
            engine_step, self.session_docs, self.criteria, self.weight_solutions_list, params,
            print_fn=lambda msg: None,
        )


def main():
    """Main interactive workflow."""
    parser = argparse.ArgumentParser(description='UP-MAVT Local Standalone')
    parser.add_argument('-d', '--data-dir', default='data',
                        help='Path to data directory (default: data)')
    parser.add_argument('-o', '--output-dir', default='results',
                        help='Path to output directory (default: results)')
    args = parser.parse_args()

    data_dir = os.path.abspath(args.data_dir)
    output_dir = os.path.abspath(args.output_dir)

    logger.info("\n" + "=" * 70)
    logger.info("UP-MAVT LOCAL STANDALONE - INTERACTIVE WORKFLOW")
    logger.info("=" * 70)
    logger.info("\nData directory: %s", data_dir)
    logger.info("Output directory: %s", output_dir)

    # Validate data directory
    if not os.path.isdir(data_dir):
        logger.error("✗ Error: Data directory not found: %s", data_dir)
        sys.exit(1)

    ensure_output_dir(output_dir)

    # The sessions selected on the web app's Run page (all sessions for older exports)
    session_names, from_web_app = select_sessions(data_dir)
    if not session_names:
        logger.error("✗ Error: No elicitation sessions found in data directory.")
        logger.error("  Expected one subdirectory per session with its CSV files.")
        sys.exit(1)

    logger.info(
        "\n✓ %s %d elicitation session(s): %s",
        'Using the web app\'s selection of' if from_web_app else 'Found',
        len(session_names),
        ', '.join(session_names),
    )

    criteria = load_input_data(data_dir)['criteria']
    session_docs = [load_session_data(data_dir, session_name) for session_name in session_names]

    # Practitioner opinion weights (NSMC sampling); None means equal weights.
    opinion_weights = compute_opinion_weights([doc.get('practitioner_settings') for doc in session_docs])
    if opinion_weights:
        logger.info("  Opinion weights: %s", ', '.join(
            f"{name}={weight:.3f}" for name, weight in zip(session_names, opinion_weights)
        ))

    # Step 1: Mandatory (or skip if weights exist)
    weight_solutions = step_1_compute_weights(data_dir, output_dir, session_docs, criteria)
    if not weight_solutions:
        logger.error("✗ Failed to compute or load weights. Cannot proceed.")
        sys.exit(1)

    run = StepRunner(session_docs, criteria, weight_solutions)

    # Steps 2-5, in the web app's order
    method, alpha = step_2_choose_aggregation(run, output_dir, load_aggregation_settings(data_dir), opinion_weights)
    step_3_uncertainty_analysis(run, output_dir, method, alpha, opinion_weights)
    step_4_consensus_analysis(run, output_dir, method, alpha, opinion_weights)
    step_5_final_results(run, output_dir, method, alpha, opinion_weights)

    logger.info("\n" + "=" * 70)
    logger.info("✓ WORKFLOW COMPLETE")
    logger.info("=" * 70)
    logger.info("\nResults saved to: %s", output_dir)


if __name__ == '__main__':
    main()
