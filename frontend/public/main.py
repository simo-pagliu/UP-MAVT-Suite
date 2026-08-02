#!/usr/bin/env python3
"""
UP-MAVT Local Standalone - Interactive CLI Workflow

This script guides users through the UP-MAVT analysis workflow locally,
loading data from CSV files and saving results to CSV + plots.

Usage:
    python main.py
"""

import logging
import os
import sys
import argparse
from pathlib import Path
import json

# Add current directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from load_LOCAL import (
    load_input_data,
    load_session_data,
    load_computed_weights,
    list_sessions,
    save_weight_solutions_csv,
    build_value_functions_from_csv,
    build_comparisons_from_csv,
    build_alternatives_from_csv,
)
from weight_space_definition import compute_weights
from upmavt import run_upmavt

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

import traceback

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


def ensure_output_dir(output_dir):
    """Ensure output directory exists."""
    Path(output_dir).mkdir(parents=True, exist_ok=True)


def map_aggregation_label(selected_label):
    """Map UI prompt labels to run_upmavt aggregation identifiers."""
    token = str(selected_label).split()[0].upper()
    mapping = {
        'SUM': 'weighted_sum',
        'GEO': 'geometric_mean',
        'HAR': 'harmonic_mean',
    }
    return mapping.get(token, 'weighted_sum')


def log_message(msg):
    """Log and return message for consistency."""
    logger.info(msg)
    return msg


def plot_weight_space_2d(weight_solutions, output_path):
    """Plot weight space showing distribution of weights per criterion (like UI)."""
    if not PLOTTING_AVAILABLE or len(weight_solutions) < 1:
        return
    
    try:
        import numpy as np
        
        # Organize weights by criterion
        criteria_names = list(weight_solutions[0].keys())
        weights_by_criterion = {crit: [] for crit in criteria_names}
        
        for sol in weight_solutions:
            for crit in criteria_names:
                weights_by_criterion[crit].append(sol[crit])
        
        # Create figure with horizontal bars showing weight distributions
        fig, ax = plt.subplots(figsize=(10, max(6, len(criteria_names) * 0.8)))
        
        y_positions = range(len(criteria_names))
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
        plt.savefig(output_path, dpi=150)
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
                text = ax.text(alt, rank, f'{prob*100:.1f}%',
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


def plot_distribution(data_by_elicitation, alt_name, output_path):
    """Plot distribution of values for an alternative across elicitations."""
    if not PLOTTING_AVAILABLE or not data_by_elicitation:
        return
    
    try:
        plt.figure(figsize=(10, 6))
        
        for elicit_name, iterations in data_by_elicitation.items():
            values = [row[alt_name] if alt_name < len(row) else 0 for row in iterations]
            plt.hist(values, alpha=0.5, label=elicit_name, bins=20)
        
        plt.xlabel('Value')
        plt.ylabel('Frequency')
        plt.title(f'Distribution of Values for {alt_name}')
        plt.legend()
        plt.grid(True, alpha=0.3)
        plt.tight_layout()
        plt.savefig(output_path, dpi=150)
        plt.close()
    except Exception as e:
        logger.warning("Could not create distribution plot: %s", e)


def save_step_results_csv(results, output_path):
    """Save step results to CSV."""
    import csv
    
    if not results:
        return
    
    try:
        with open(output_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            
            # Header
            alt_names = results.get('alternative_names', [])
            
            # Handle strict mode (results_by_elicitation)
            if 'results_by_elicitation' in results:
                results_by_elicitation = results['results_by_elicitation']
                for elicit_idx_str, rows in results_by_elicitation.items():
                    writer.writerow([f'Elicitation_{elicit_idx_str}'])
                    writer.writerow(['iteration'] + alt_names)
                    for idx, row in enumerate(rows):
                        writer.writerow([idx] + row)
                    writer.writerow([])  # Empty row separator
            # Handle non-strict mode (aggregated_results)
            elif 'aggregated_results' in results:
                writer.writerow(['iteration'] + alt_names)
                for idx, row in enumerate(results.get('aggregated_results', [])):
                    writer.writerow([idx] + row)
            else:
                logger.warning("No results data found in results structure")
                return
                
    except Exception as e:
        logger.warning("Could not save results CSV: %s", e)


def prepare_upmavt_data(data_dir, session_names, criteria, weight_solutions):
    """Prepare data structures for run_upmavt.
    
    Returns
    -------
    tuple
        (vf_lists, confidence_lists, weight_solutions_list, alternatives, criteria_names)
    """
    vf_lists = []
    confidence_lists = []
    weight_solutions_list = []
    
    for session_name in session_names:
        vf_dict, conf_dict = build_value_functions_from_csv(
            data_dir, session_name, criteria, return_confidence=True
        )
        vf_lists.append(vf_dict)
        confidence_lists.append(conf_dict)
        
        ws = weight_solutions.get(session_name, [])
        weight_solutions_list.append(ws)
    
    alternatives, criteria_names = build_alternatives_from_csv(data_dir)
    
    return vf_lists, confidence_lists, weight_solutions_list, alternatives, criteria_names


def step_1_compute_weights(data_dir, output_dir, session_names):
    """Step 1: Compute Weights"""
    logger.info("\n" + "=" * 70)
    logger.info("STEP 1: COMPUTE WEIGHTS")
    logger.info("=" * 70)
    
    weights_file = os.path.join(output_dir, 'step1_weight_solutions.csv')
    
    # Check if weights already exist
    if os.path.exists(weights_file):
        logger.info("✓ Weight solutions file found: %s", weights_file)
        if not ConsolePrompt.yes_no("Skip weight computation and use existing file", default='y'):
            logger.info("Recomputing weights...")
        else:
            logger.info("Using existing weight solutions.")
            return
    
    logger.info("\nComputing weights for %d elicitation(s)...", len(session_names))
    
    try:
        input_data = load_input_data(data_dir)
        criteria = input_data['criteria']
        criteria_names = [c['criterion_name'] for c in criteria if 'criterion_name' in c]
        
        all_weight_solutions = {}
        
        for session_name in session_names:
            logger.info("\n  Processing %s...", session_name)
            
            # Build value functions and comparisons from session data
            value_functions = build_value_functions_from_csv(data_dir, session_name, criteria)
            comparisons = build_comparisons_from_csv(data_dir, session_name)
            
            ws = compute_weights(value_functions, comparisons, criteria_names=criteria_names, print_fn=lambda msg: None)
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


def step_2_consensus_analysis(data_dir, output_dir, session_names, weight_solutions):
    """Step 2: Consensus Analysis"""
    logger.info("\n" + "=" * 70)
    logger.info("STEP 2: CONSENSUS ANALYSIS")
    logger.info("=" * 70)
    
    if not ConsolePrompt.yes_no("Run Step 2 (Consensus Analysis)", default='n'):
        logger.info("Skipped.")
        return
    
    agg_choice = ConsolePrompt.choose_option(
        "Select aggregation method:",
        ["SUM (default)", "GEO", "HAR"],
        default_idx=0
    )
    agg_method = map_aggregation_label(agg_choice)
    
    mc_iters = ConsolePrompt.get_integer("MC Iterations", default=1000)
    
    logger.info("\nRunning consensus analysis with %s aggregation, %d iterations...", agg_method, mc_iters)
    
    try:
        input_data = load_input_data(data_dir)
        criteria = input_data['criteria']
        
        vf_lists, conf_lists, ws_list, alternatives, crit_names = prepare_upmavt_data(
            data_dir, session_names, criteria, weight_solutions
        )
        
        params = {
            'mc_iterations': mc_iters,
            'aggregation_method': agg_method,
            'mc_mode': 'strict',
            'use_random_weights': False,
            'opinion_weights': None,
        }
        
        results = run_upmavt(vf_lists, conf_lists, ws_list, alternatives, crit_names, params, print_fn=lambda msg: logger.info("%s", msg))
        
        output_csv = os.path.join(output_dir, 'step2_consensus_results.csv')
        save_step_results_csv(results, output_csv)
        logger.info("✓ Results saved to: %s", output_csv)
        
        # Plot distributions for each alternative
        if PLOTTING_AVAILABLE and 'results_by_elicitation' in results:
            alt_names = results.get('alternative_names', [])
            for alt_idx, alt_name in enumerate(alt_names):
                plot_path = os.path.join(output_dir, f'step2_distribution_{alt_name.replace(" ", "_")}.png')
                
                # Prepare data by elicitation for plotting
                data_by_elicit = {}
                for elicit_idx_str, rows in results['results_by_elicitation'].items():
                    elicit_name = f"Elicitation {int(elicit_idx_str) + 1}"
                    data_by_elicit[elicit_name] = rows
                
                # Plot using alternative index
                import matplotlib.pyplot as plt
                try:
                    plt.figure(figsize=(10, 6))
                    for elicit_name, rows in data_by_elicit.items():
                        values = [row[alt_idx] for row in rows]
                        plt.hist(values, alpha=0.5, label=elicit_name, bins=30)
                    plt.xlabel('Value')
                    plt.ylabel('Frequency')
                    plt.title(f'Distribution of Values for {alt_name}')
                    plt.legend()
                    plt.grid(True, alpha=0.3)
                    plt.tight_layout()
                    plt.savefig(plot_path, dpi=150)
                    plt.close()
                except Exception as e:
                    logger.warning("Could not create plot for %s: %s", alt_name, e)
            logger.info("✓ Distribution plots saved to: %s", output_dir)
        
    except Exception as e:
        logger.error("✗ Error in Step 2: %s", e, exc_info=True)


def step_3_dominance_analysis(data_dir, output_dir, session_names, weight_solutions):
    """Step 3: Dominance Analysis"""
    logger.info("\n" + "=" * 70)
    logger.info("STEP 3: DOMINANCE ANALYSIS")
    logger.info("=" * 70)
    
    if not ConsolePrompt.yes_no("Run Step 3 (Dominance Analysis)", default='n'):
        logger.info("Skipped.")
        return
    
    agg_choice = ConsolePrompt.choose_option(
        "Select aggregation method:",
        ["SUM (default)", "GEO", "HAR"],
        default_idx=0
    )
    agg_method = map_aggregation_label(agg_choice)
    
    mc_iters = ConsolePrompt.get_integer("MC Iterations", default=1000)
    
    logger.info("\nRunning dominance analysis with %s aggregation, %d iterations...", agg_method, mc_iters)
    
    try:
        input_data = load_input_data(data_dir)
        criteria = input_data['criteria']
        
        vf_lists, conf_lists, ws_list, alternatives, crit_names = prepare_upmavt_data(
            data_dir, session_names, criteria, weight_solutions
        )
        
        params = {
            'mc_iterations': mc_iters,
            'aggregation_method': agg_method,
            'mc_mode': 'non_strict',
            'use_random_weights': True,
            'opinion_weights': None,
        }
        
        results = run_upmavt(vf_lists, conf_lists, ws_list, alternatives, crit_names, params, print_fn=lambda m: None)
        
        output_csv = os.path.join(output_dir, 'step3_dominance_results.csv')
        save_step_results_csv(results, output_csv)
        logger.info("✓ Results saved to: %s", output_csv)
        
        # Plot heatmap for dominance analysis
        if PLOTTING_AVAILABLE:
            plot_path = os.path.join(output_dir, 'step3_dominance_heatmap.png')
            plot_ranking_heatmap(results, plot_path, title='Dominance Analysis Heatmap')
            logger.info("✓ Heatmap saved to: %s", plot_path)
        
    except Exception as e:
        logger.error("✗ Error in Step 3: %s", e, exc_info=True)


def step_4_compensation_analysis(data_dir, output_dir, session_names, weight_solutions):
    """Step 4: Compensation Analysis"""
    logger.info("\n" + "=" * 70)
    logger.info("STEP 4: COMPENSATION ANALYSIS")
    logger.info("=" * 70)
    
    if not ConsolePrompt.yes_no("Run Step 4 (Compensation Analysis)", default='n'):
        logger.info("Skipped.")
        return
    
    mc_iters = ConsolePrompt.get_integer("MC Iterations (per method)", default=1000)
    
    logger.info("\nRunning compensation analysis with all 3 aggregation methods, %d iterations each...", mc_iters)
    
    try:
        input_data = load_input_data(data_dir)
        criteria = input_data['criteria']
        
        vf_lists, conf_lists, ws_list, alternatives, crit_names = prepare_upmavt_data(
            data_dir, session_names, criteria, weight_solutions
        )
        
        for agg_method in ['weighted_sum', 'geometric_mean', 'harmonic_mean']:
            logger.info("  - %s...", agg_method.upper())
            
            params = {
                'mc_iterations': mc_iters,
                'aggregation_method': agg_method,
                'mc_mode': 'non_strict',
                'use_random_weights': False,
                'opinion_weights': None,
            }
            
            results = run_upmavt(vf_lists, conf_lists, ws_list, alternatives, crit_names, params, print_fn=lambda m: None)
            
            output_csv = os.path.join(output_dir, f'step4_compensation_{agg_method}_results.csv')
            save_step_results_csv(results, output_csv)
            
            # Plot heatmap for each aggregation method
            if PLOTTING_AVAILABLE:
                plot_path = os.path.join(output_dir, f'step4_compensation_{agg_method}_heatmap.png')
                plot_ranking_heatmap(results, plot_path, title=f'{agg_method.upper()} Aggregation Heatmap')
        
        logger.info("✓ Results saved to step4_compensation_*_results.csv")
        if PLOTTING_AVAILABLE:
            logger.info("✓ Heatmaps saved to step4_compensation_*_heatmap.png")
        
    except Exception as e:
        logger.error("✗ Error in Step 4: %s", e, exc_info=True)


def step_5_uncertainty_analysis(data_dir, output_dir, session_names, weight_solutions):
    """Step 5: Uncertainty Analysis"""
    logger.info("\n" + "=" * 70)
    logger.info("STEP 5: UNCERTAINTY ANALYSIS")
    logger.info("=" * 70)
    
    if not ConsolePrompt.yes_no("Run Step 5 (Uncertainty Analysis)", default='n'):
        logger.info("Skipped.")
        return
    
    logger.info("\nThis step uses the preferred aggregation method from Step 4.")
    agg_choice = ConsolePrompt.choose_option(
        "Select aggregation method:",
        ["SUM (default)", "GEO", "HAR"],
        default_idx=0
    )
    agg_method = map_aggregation_label(agg_choice)
    
    mc_iters = ConsolePrompt.get_integer("MC Iterations", default=1000)
    
    logger.info("\nRunning uncertainty analysis with %s aggregation, %d iterations...", agg_method, mc_iters)
    
    try:
        input_data = load_input_data(data_dir)
        criteria = input_data['criteria']
        
        vf_lists, conf_lists, ws_list, alternatives, crit_names = prepare_upmavt_data(
            data_dir, session_names, criteria, weight_solutions
        )
        
        params = {
            'mc_iterations': mc_iters,
            'aggregation_method': agg_method,
            'mc_mode': 'strict',
            'use_random_weights': False,
            'opinion_weights': None,
        }
        
        results = run_upmavt(vf_lists, conf_lists, ws_list, alternatives, crit_names, params, print_fn=lambda m: None)
        
        output_csv = os.path.join(output_dir, 'step5_uncertainty_results.csv')
        save_step_results_csv(results, output_csv)
        logger.info("✓ Results saved to: %s", output_csv)
        
        # Plot distributions for each alternative (like Step 2)
        if PLOTTING_AVAILABLE and 'results_by_elicitation' in results:
            alt_names = results.get('alternative_names', [])
            for alt_idx, alt_name in enumerate(alt_names):
                plot_path = os.path.join(output_dir, f'step5_distribution_{alt_name.replace(" ", "_")}.png')
                
                try:
                    plt.figure(figsize=(10, 6))
                    for elicit_idx_str, rows in results['results_by_elicitation'].items():
                        elicit_name = f"Elicitation {int(elicit_idx_str) + 1}"
                        values = [row[alt_idx] for row in rows]
                        plt.hist(values, alpha=0.5, label=elicit_name, bins=30)
                    plt.xlabel('Value')
                    plt.ylabel('Frequency')
                    plt.title(f'Uncertainty Distribution for {alt_name}')
                    plt.legend()
                    plt.grid(True, alpha=0.3)
                    plt.tight_layout()
                    plt.savefig(plot_path, dpi=150)
                    plt.close()
                except Exception as e:
                    logger.warning("Could not create plot for %s: %s", alt_name, e)
            logger.info("✓ Distribution plots saved to: %s", output_dir)
        
    except Exception as e:
        logger.error("✗ Error in Step 5: %s", e, exc_info=True)


def step_6_final_results(data_dir, output_dir, session_names, weight_solutions):
    """Step 6: Final Results"""
    logger.info("\n" + "=" * 70)
    logger.info("STEP 6: FINAL RESULTS")
    logger.info("=" * 70)
    
    if not ConsolePrompt.yes_no("Run Step 6 (Final Results)", default='n'):
        logger.info("Skipped.")
        return
    
    agg_choice = ConsolePrompt.choose_option(
        "Select aggregation method:",
        ["SUM (default)", "GEO", "HAR"],
        default_idx=0
    )
    agg_method = map_aggregation_label(agg_choice)
    
    mc_iters = ConsolePrompt.get_integer("MC Iterations", default=1000)
    
    logger.info("\nComputing final results with %s aggregation, %d iterations...", agg_method, mc_iters)
    
    try:
        input_data = load_input_data(data_dir)
        criteria = input_data['criteria']
        
        vf_lists, conf_lists, ws_list, alternatives, crit_names = prepare_upmavt_data(
            data_dir, session_names, criteria, weight_solutions
        )
        
        params = {
            'mc_iterations': mc_iters,
            'aggregation_method': agg_method,
            'mc_mode': 'non_strict',
            'use_random_weights': False,
            'opinion_weights': None,
        }
        
        results = run_upmavt(vf_lists, conf_lists, ws_list, alternatives, crit_names, params, print_fn=lambda m: None)
        
        output_csv = os.path.join(output_dir, 'step6_final_results.csv')
        save_step_results_csv(results, output_csv)
        logger.info("✓ Results saved to: %s", output_csv)
        
        # Plot heatmap for final results
        if PLOTTING_AVAILABLE:
            plot_path = os.path.join(output_dir, 'step6_final_heatmap.png')
            plot_ranking_heatmap(results, plot_path, title='Final Results Heatmap')
            logger.info("✓ Heatmap saved to: %s", plot_path)
        
    except Exception as e:
        logger.error("✗ Error in Step 6: %s", e, exc_info=True)


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
    
    # List available sessions
    session_names = list_sessions(data_dir)
    if not session_names:
        logger.error("✗ Error: No elicitation sessions found in data directory.")
        logger.error("  Expected subdirectories: elicitation_1, elicitation_2, etc.")
        sys.exit(1)
    
    logger.info("\n✓ Found %d elicitation session(s): %s", len(session_names), ', '.join(session_names))
    
    # Step 1: Mandatory (or skip if weights exist)
    weight_solutions = step_1_compute_weights(data_dir, output_dir, session_names)
    if not weight_solutions:
        logger.error("✗ Failed to compute or load weights. Cannot proceed.")
        sys.exit(1)
    
    # Steps 2-6: Optional
    step_2_consensus_analysis(data_dir, output_dir, session_names, weight_solutions)
    step_3_dominance_analysis(data_dir, output_dir, session_names, weight_solutions)
    step_4_compensation_analysis(data_dir, output_dir, session_names, weight_solutions)
    step_5_uncertainty_analysis(data_dir, output_dir, session_names, weight_solutions)
    step_6_final_results(data_dir, output_dir, session_names, weight_solutions)
    
    logger.info("\n" + "=" * 70)
    logger.info("✓ WORKFLOW COMPLETE")
    logger.info("=" * 70)
    logger.info("\nResults saved to: %s", output_dir)
    logger.info("Check the results/ directory for CSV files and plots.")


if __name__ == '__main__':
    main()
