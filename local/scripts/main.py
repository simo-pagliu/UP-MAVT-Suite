#!/usr/bin/env python3
"""
UP-MAVT Local Standalone - Interactive CLI Workflow

This script guides users through the UP-MAVT analysis workflow locally,
loading data from CSV files and saving results to CSV + plots.

Usage:
    python main.py
"""

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

try:
    import matplotlib
    matplotlib.use('Agg')  # Non-interactive backend
    import matplotlib.pyplot as plt
    PLOTTING_AVAILABLE = True
except ImportError:
    PLOTTING_AVAILABLE = False
    print("Warning: matplotlib not available. Plots will not be generated.")

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


def log_message(msg):
    """Print and return message for consistency."""
    print(msg)
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
        print(f"Warning: Could not create weight space plot: {e}")


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
        print(f"Warning: Could not create ranking heatmap: {e}")


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
        print(f"Warning: Could not create distribution plot: {e}")


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
                print(f"Warning: No results data found in results structure")
                return
                
    except Exception as e:
        print(f"Warning: Could not save results CSV: {e}")


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
    print("\n" + "=" * 70)
    print("STEP 1: COMPUTE WEIGHTS")
    print("=" * 70)
    
    weights_file = os.path.join(output_dir, 'step1_weight_solutions.csv')
    
    # Check if weights already exist
    if os.path.exists(weights_file):
        print(f"\n✓ Weight solutions file found: {weights_file}")
        if not ConsolePrompt.yes_no("Skip weight computation and use existing file", default='y'):
            print("Recomputing weights...")
        else:
            print("Using existing weight solutions.")
            return
    
    print(f"\nComputing weights for {len(session_names)} elicitation(s)...")
    
    try:
        input_data = load_input_data(data_dir)
        criteria = input_data['criteria']
        criteria_names = [c['criterion_name'] for c in criteria if 'criterion_name' in c]
        
        all_weight_solutions = {}
        
        for session_name in session_names:
            print(f"\n  Processing {session_name}...")
            
            # Build value functions and comparisons from session data
            value_functions = build_value_functions_from_csv(data_dir, session_name, criteria)
            comparisons = build_comparisons_from_csv(data_dir, session_name)
            
            ws = compute_weights(value_functions, comparisons, criteria_names=criteria_names, print_fn=lambda msg: None)
            all_weight_solutions[session_name] = ws
            
            print(f"    ✓ {len(ws)} feasible weight solutions found")
        
        # Save to CSV
        save_weight_solutions_csv(weights_file, all_weight_solutions)
        print(f"\n✓ Weight solutions saved to: {weights_file}")
        
        # Plot weight space for each session
        if all_weight_solutions and PLOTTING_AVAILABLE:
            for session_name, ws in all_weight_solutions.items():
                if len(ws) > 0:
                    plot_path = os.path.join(output_dir, f'step1_weight_space_{session_name}.png')
                    plot_weight_space_2d(ws, plot_path)
                    print(f"✓ Weight space plot for {session_name} saved to: {plot_path}")
        
        return all_weight_solutions
    
    except Exception as e:
        print(f"\n✗ Error in Step 1: {e}")
        traceback.print_exc()
        return None


def step_2_consensus_analysis(data_dir, output_dir, session_names, weight_solutions):
    """Step 2: Consensus Analysis"""
    print("\n" + "=" * 70)
    print("STEP 2: CONSENSUS ANALYSIS")
    print("=" * 70)
    
    if not ConsolePrompt.yes_no("Run Step 2 (Consensus Analysis)", default='n'):
        print("Skipped.")
        return
    
    agg_method = ConsolePrompt.choose_option(
        "Select aggregation method:",
        ["SUM (default)", "GEO", "HAR"],
        default_idx=0
    ).split()[0]
    
    mc_iters = ConsolePrompt.get_integer("MC Iterations", default=1000)
    
    print(f"\nRunning consensus analysis with {agg_method} aggregation, {mc_iters} iterations...")
    
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
        
        results = run_upmavt(vf_lists, conf_lists, ws_list, alternatives, crit_names, params, print_fn=print)
        
        output_csv = os.path.join(output_dir, 'step2_consensus_results.csv')
        save_step_results_csv(results, output_csv)
        print(f"✓ Results saved to: {output_csv}")
        
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
                    print(f"Warning: Could not create plot for {alt_name}: {e}")
            print(f"✓ Distribution plots saved to: {output_dir}")
        
    except Exception as e:
        print(f"✗ Error in Step 2: {e}")
        traceback.print_exc()


def step_3_dominance_analysis(data_dir, output_dir, session_names, weight_solutions):
    """Step 3: Dominance Analysis"""
    print("\n" + "=" * 70)
    print("STEP 3: DOMINANCE ANALYSIS")
    print("=" * 70)
    
    if not ConsolePrompt.yes_no("Run Step 3 (Dominance Analysis)", default='n'):
        print("Skipped.")
        return
    
    agg_method = ConsolePrompt.choose_option(
        "Select aggregation method:",
        ["SUM (default)", "GEO", "HAR"],
        default_idx=0
    ).split()[0]
    
    mc_iters = ConsolePrompt.get_integer("MC Iterations", default=1000)
    
    print(f"\nRunning dominance analysis with {agg_method} aggregation, {mc_iters} iterations...")
    
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
        print(f"✓ Results saved to: {output_csv}")
        
        # Plot heatmap for dominance analysis
        if PLOTTING_AVAILABLE:
            plot_path = os.path.join(output_dir, 'step3_dominance_heatmap.png')
            plot_ranking_heatmap(results, plot_path, title='Dominance Analysis Heatmap')
            print(f"✓ Heatmap saved to: {plot_path}")
        
    except Exception as e:
        print(f"✗ Error in Step 3: {e}")
        traceback.print_exc()


def step_4_compensation_analysis(data_dir, output_dir, session_names, weight_solutions):
    """Step 4: Compensation Analysis"""
    print("\n" + "=" * 70)
    print("STEP 4: COMPENSATION ANALYSIS")
    print("=" * 70)
    
    if not ConsolePrompt.yes_no("Run Step 4 (Compensation Analysis)", default='n'):
        print("Skipped.")
        return
    
    mc_iters = ConsolePrompt.get_integer("MC Iterations (per method)", default=1000)
    
    print(f"\nRunning compensation analysis with all 3 aggregation methods, {mc_iters} iterations each...")
    
    try:
        input_data = load_input_data(data_dir)
        criteria = input_data['criteria']
        
        vf_lists, conf_lists, ws_list, alternatives, crit_names = prepare_upmavt_data(
            data_dir, session_names, criteria, weight_solutions
        )
        
        for agg_method in ['weighted_sum', 'geometric_mean', 'harmonic_mean']:
            print(f"  - {agg_method.upper()}...")
            
            params = {
                'mc_iterations': mc_iters,
                'aggregation_method': agg_method,
                'mc_mode': 'non_strict',
                'use_random_weights': True,
                'opinion_weights': None,
            }
            
            results = run_upmavt(vf_lists, conf_lists, ws_list, alternatives, crit_names, params, print_fn=lambda m: None)
            
            output_csv = os.path.join(output_dir, f'step4_compensation_{agg_method}_results.csv')
            save_step_results_csv(results, output_csv)
            
            # Plot heatmap for each aggregation method
            if PLOTTING_AVAILABLE:
                plot_path = os.path.join(output_dir, f'step4_compensation_{agg_method}_heatmap.png')
                plot_ranking_heatmap(results, plot_path, title=f'{agg_method.upper()} Aggregation Heatmap')
        
        print(f"✓ Results saved to step4_compensation_*_results.csv")
        if PLOTTING_AVAILABLE:
            print(f"✓ Heatmaps saved to step4_compensation_*_heatmap.png")
        
    except Exception as e:
        print(f"✗ Error in Step 4: {e}")
        traceback.print_exc()


def step_5_uncertainty_analysis(data_dir, output_dir, session_names, weight_solutions):
    """Step 5: Uncertainty Analysis"""
    print("\n" + "=" * 70)
    print("STEP 5: UNCERTAINTY ANALYSIS")
    print("=" * 70)
    
    if not ConsolePrompt.yes_no("Run Step 5 (Uncertainty Analysis)", default='n'):
        print("Skipped.")
        return
    
    print("\nThis step uses the preferred aggregation method from Step 4.")
    agg_method = ConsolePrompt.choose_option(
        "Select aggregation method:",
        ["SUM (default)", "GEO", "HAR"],
        default_idx=0
    ).split()[0]
    
    mc_iters = ConsolePrompt.get_integer("MC Iterations", default=1000)
    
    print(f"\nRunning uncertainty analysis with {agg_method} aggregation, {mc_iters} iterations...")
    
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
        print(f"✓ Results saved to: {output_csv}")
        
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
                    print(f"Warning: Could not create plot for {alt_name}: {e}")
            print(f"✓ Distribution plots saved to: {output_dir}")
        
    except Exception as e:
        print(f"✗ Error in Step 5: {e}")
        traceback.print_exc()


def step_6_final_results(data_dir, output_dir, session_names, weight_solutions):
    """Step 6: Final Results"""
    print("\n" + "=" * 70)
    print("STEP 6: FINAL RESULTS")
    print("=" * 70)
    
    if not ConsolePrompt.yes_no("Run Step 6 (Final Results)", default='n'):
        print("Skipped.")
        return
    
    agg_method = ConsolePrompt.choose_option(
        "Select aggregation method:",
        ["SUM (default)", "GEO", "HAR"],
        default_idx=0
    ).split()[0]
    
    mc_iters = ConsolePrompt.get_integer("MC Iterations", default=1000)
    
    print(f"\nComputing final results with {agg_method} aggregation, {mc_iters} iterations...")
    
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
        print(f"✓ Results saved to: {output_csv}")
        
        # Plot heatmap for final results
        if PLOTTING_AVAILABLE:
            plot_path = os.path.join(output_dir, 'step6_final_heatmap.png')
            plot_ranking_heatmap(results, plot_path, title='Final Results Heatmap')
            print(f"✓ Heatmap saved to: {plot_path}")
        
    except Exception as e:
        print(f"✗ Error in Step 6: {e}")
        traceback.print_exc()


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
    
    print("\n" + "=" * 70)
    print("UP-MAVT LOCAL STANDALONE - INTERACTIVE WORKFLOW")
    print("=" * 70)
    print(f"\nData directory: {data_dir}")
    print(f"Output directory: {output_dir}")
    
    # Validate data directory
    if not os.path.isdir(data_dir):
        print(f"\n✗ Error: Data directory not found: {data_dir}")
        sys.exit(1)
    
    ensure_output_dir(output_dir)
    
    # List available sessions
    session_names = list_sessions(data_dir)
    if not session_names:
        print("\n✗ Error: No elicitation sessions found in data directory.")
        print("  Expected subdirectories: elicitation_1, elicitation_2, etc.")
        sys.exit(1)
    
    print(f"\n✓ Found {len(session_names)} elicitation session(s): {', '.join(session_names)}")
    
    # Step 1: Mandatory (or skip if weights exist)
    weight_solutions = step_1_compute_weights(data_dir, output_dir, session_names)
    if not weight_solutions:
        print("\n✗ Failed to compute or load weights. Cannot proceed.")
        sys.exit(1)
    
    # Steps 2-6: Optional
    step_2_consensus_analysis(data_dir, output_dir, session_names, weight_solutions)
    step_3_dominance_analysis(data_dir, output_dir, session_names, weight_solutions)
    step_4_compensation_analysis(data_dir, output_dir, session_names, weight_solutions)
    step_5_uncertainty_analysis(data_dir, output_dir, session_names, weight_solutions)
    step_6_final_results(data_dir, output_dir, session_names, weight_solutions)
    
    print("\n" + "=" * 70)
    print("✓ WORKFLOW COMPLETE")
    print("=" * 70)
    print(f"\nResults saved to: {output_dir}")
    print("Check the results/ directory for CSV files and plots.")


if __name__ == '__main__':
    main()
