#!/usr/bin/env python3
"""
UP-MAVT Worker
Polls MongoDB for pending tasks, executes Python simulations,
and saves results back to the database.
"""

import logging
import os
import sys
import time
import traceback
from datetime import datetime, timezone

from pymongo import MongoClient
from bson.objectid import ObjectId

from scripts.weight_space_definition import compute_weights
from scripts.upmavt import run_upmavt
from scripts.load_DB import (
    load_input_data,
    load_session_data,
    load_session_data_batch,
    load_computed_weights,
    save_computed_weights,
    save_step_results,
    build_value_functions_from_session,
    build_comparisons_from_session,
    build_alternatives_with_qualitative,
)

# ============================================================================
# CONFIG
# ============================================================================
MONGO_URI = os.getenv("MONGO_URI", "mongodb://mongo:27017/elicitation")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "2"))  # seconds

# ============================================================================
# LOGGING SETUP
# ============================================================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S',
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

# ============================================================================
# DB CONNECTION
# ============================================================================
client = MongoClient(MONGO_URI)
db = client.elicitation


# ============================================================================
# LOGGING HELPER
# ============================================================================
class TaskLogger:
    """Captures print output and stores it in the task document."""

    def __init__(self, task_id):
        self.task_id = task_id
        self.lines = []

    def log(self, message):
        """Log a message: write to logger and flush to DB immediately."""
        line = str(message)
        self.lines.append(line)
        logger.info(line)
        self._flush()

    def flush(self):
        """Public flush method."""
        self._flush()

    def _flush(self):
        """Write accumulated output to DB."""
        try:
            db.tasks.update_one(
                {'_id': ObjectId(self.task_id)},
                {'$set': {'console_output': '\n'.join(self.lines)}}
            )
        except Exception:
            pass

    def finalize(self):
        """Final flush of all output."""
        self._flush()


# ============================================================================
# TASK HANDLERS
# ============================================================================
def handle_compute_weights(task):
    """Handle the compute_weights task."""
    task_id = str(task['_id'])
    logger = TaskLogger(task_id)
    params = task.get('params', {})
    study_session_id = params.get('study_session_id')
    selected_session_ids = params.get('selected_session_ids', [])
    use_non_linear_model = bool(params.get('use_non_linear_model', True))
    phase3_tolerance_pct = params.get('phase3_tolerance_pct', 1.0)
    weight_space_parameters = params.get('weight_space_parameters', {})
    try:
        phase3_tolerance_pct = max(0.0, float(phase3_tolerance_pct))
    except (TypeError, ValueError):
        phase3_tolerance_pct = 1.0

    try:
        logger.log("=" * 60)
        logger.log(f"Model: {'non-linear' if use_non_linear_model else 'linear'}")
        logger.log(f"Weight space parameters: {weight_space_parameters}")
        logger.log("COMPUTE WEIGHTS")
        logger.log("=" * 60)

        # Load criteria from input
        input_data = load_input_data(db, study_session_id)
        criteria = input_data['criteria']
        
        if not criteria:
            raise ValueError("No criteria found in input")

        # Process each selected session
        weight_solutions = {}
        pre_threshold_weight_solutions = {}
        applied_weight_space_parameters = None  # Will be set from compute_weights runtime metadata, if available
        total = len(selected_session_ids)

        for idx, session_id in enumerate(selected_session_ids):
            try:
                session_doc = load_session_data(db, session_id)
                session_name = session_doc.get('name', session_id)
                logger.log(f"\n--- Processing session {idx + 1}/{total}: {session_name} ---")

                # Build value functions and comparisons from session data
                value_functions = build_value_functions_from_session(session_doc, criteria)
                comparisons = build_comparisons_from_session(session_doc)
                criteria_names = [c['criterion_name'] for c in criteria if 'criterion_name' in c]
                
                weight_result = compute_weights(
                    value_functions,
                    comparisons,
                    criteria_names=criteria_names,
                    print_fn=logger.log,
                    use_non_linear_model=use_non_linear_model,
                    step_c_lim_percent=phase3_tolerance_pct,
                    parameter_overrides=weight_space_parameters,
                    return_metadata=True,
                )
                ws = weight_result.get('accepted_solutions', [])
                pre_threshold_ws = weight_result.get('pre_threshold_decimal_solutions', [])
                applied_weight_space_parameters = weight_result.get('runtime_parameters', applied_weight_space_parameters)
                weight_solutions[session_id] = ws
                pre_threshold_weight_solutions[session_id] = pre_threshold_ws

                logger.log(f"✓ Session {session_name} completed ({len(ws)} feasible solutions)")
            except ValueError as e:
                logger.log(f"WARNING: {str(e)}, skipping session {session_id}")
                continue

        if not weight_solutions:
            raise ValueError("No weight solutions computed for any session")

        # Save results to DB
        save_computed_weights(
            db,
            study_session_id,
            weight_solutions,
            pre_threshold_weight_solutions=pre_threshold_weight_solutions,
            use_non_linear_model=use_non_linear_model,
            phase3_tolerance_pct=phase3_tolerance_pct,
            # Use actually-applied parameters when metadata is present; fall back to requested only if missing
            weight_space_parameters=(
                weight_space_parameters
                if applied_weight_space_parameters is None
                else applied_weight_space_parameters
            ),
        )

        logger.log(f"\n✓ All weights computed and saved to database.")
        logger.log(f"  Processed {len(weight_solutions)} elicitation session(s).")
        logger.finalize()

        # Mark task complete
        db.tasks.update_one(
            {'_id': ObjectId(task_id)},
            {'$set': {
                'status': 'completed',
                'completed_at': datetime.now(timezone.utc),
                'console_output': '\n'.join(logger.lines),
            }}
        )

    except Exception as e:
        logger.log(f"\nERROR: {str(e)}")
        logger.log(traceback.format_exc())
        logger.finalize()
        db.tasks.update_one(
            {'_id': ObjectId(task_id)},
            {'$set': {
                'status': 'failed',
                'error': str(e),
                'completed_at': datetime.now(timezone.utc),
                'console_output': '\n'.join(logger.lines),
            }}
        )


def handle_run_step(task):
    """Handle a run_step task (steps 2-6)."""
    task_id = str(task['_id'])
    logger = TaskLogger(task_id)
    params = task.get('params', {})
    study_session_id = params.get('study_session_id')
    selected_session_ids = params.get('selected_session_ids', [])
    step_name = params.get('step_name', 'unknown')
    step_number = params.get('step_number', 0)

    mc_iterations = params.get('mc_iterations', 1000)
    aggregation_method = params.get('aggregation_method', 'weighted_sum')
    mc_mode = params.get('mc_mode', 'non_strict')
    use_random_weights = params.get('use_random_weights', False)
    opinion_weights = params.get('opinion_weights', None)

    try:
        logger.log("=" * 60)
        logger.log(f"STEP {step_number}: {step_name}")
        logger.log("=" * 60)

        # Load criteria and computed weights
        input_data = load_input_data(db, study_session_id)
        criteria = input_data['criteria']
        input_doc = db.inputs.find_one({'_id': input_data.get('input_id')})
        
        computed_weights = load_computed_weights(db, study_session_id)

        # Load session documents
        session_docs = load_session_data_batch(db, selected_session_ids)
        
        if not session_docs:
            raise ValueError("No valid sessions found")

        # Prepare data for UP-MAVT
        logger.log("\nPreparing data for UP-MAVT analysis...")
        vf_lists = []
        confidence_lists = []
        weight_solutions_list = []
        
        weight_solutions_data = computed_weights.get('weight_solutions', {})
        if not isinstance(weight_solutions_data, dict) or not weight_solutions_data:
            weight_solutions_data = computed_weights.get('weight_spaces', {})
        
        for i, session_doc in enumerate(session_docs):
            session_id = str(session_doc.get('_id', session_doc.get('session_id', i)))
            session_name = session_doc.get('name', session_id)
            
            # Build value functions and confidence
            vf_dict, conf_dict = build_value_functions_from_session(
                session_doc, criteria, return_confidence=True
            )
            vf_lists.append(vf_dict)
            confidence_lists.append(conf_dict)
            logger.log(f"  ✓ Elicitation {i + 1}: {len(vf_dict)} value functions")
            
            # Load weight solutions
            ws = weight_solutions_data.get(session_id, [])
            weight_solutions_list.append(ws)
        
        # Extract qualitative indicators
        qualitative_indicators = session_docs[0].get('qualitative_indicators') if session_docs else None
        
        # Build alternatives and criteria names
        alternatives, criteria_names = build_alternatives_with_qualitative(
            input_doc if input_doc else {'criteria': criteria},
            qualitative_indicators
        )
        
        logger.log(f"  ✓ Loaded {len(alternatives)} alternatives")
        logger.log(f"  ✓ Criteria: {criteria_names}")

        # Step 4 special case: run all 3 aggregation methods
        if step_number == 4:
            logger.log("\nStep 4: Running all three aggregation methods...")
            results_by_aggregation = {}

            for agg_idx, agg_method in enumerate(['weighted_sum', 'geometric_mean', 'harmonic_mean']):
                logger.log(f"\n--- Aggregation method {agg_idx + 1}/3: {agg_method} ---")
                step_params = {
                    'mc_iterations': mc_iterations,
                    'aggregation_method': agg_method,
                    'mc_mode': mc_mode,
                    'use_random_weights': use_random_weights,
                    'opinion_weights': opinion_weights,
                }

                formatted = run_upmavt(
                    vf_lists, confidence_lists, weight_solutions_list,
                    alternatives, criteria_names,
                    step_params,
                    print_fn=logger.log
                )
                results_by_aggregation[agg_method] = formatted

            # Save combined results
            result_doc = {
                'mc_iterations': mc_iterations,
                'mc_mode': mc_mode,
                'use_random_weights': use_random_weights,
                'results_by_aggregation': results_by_aggregation,
            }

            save_step_results(db, study_session_id, step_number, result_doc)

        else:
            step_params = {
                'mc_iterations': mc_iterations,
                'aggregation_method': aggregation_method,
                'mc_mode': mc_mode,
                'use_random_weights': use_random_weights,
                'opinion_weights': opinion_weights,
            }

            formatted = run_upmavt(
                vf_lists, confidence_lists, weight_solutions_list,
                alternatives, criteria_names,
                step_params,
                print_fn=logger.log
            )

            # Save results
            result_doc = formatted.copy()
            result_doc.update({
                'mc_iterations': mc_iterations,
                'aggregation_method': aggregation_method,
                'mc_mode': mc_mode,
                'use_random_weights': use_random_weights,
            })

            save_step_results(db, study_session_id, step_number, result_doc)

        logger.log(f"\n✓ Step {step_number} completed and results saved to database.")
        logger.finalize()

        db.tasks.update_one(
            {'_id': ObjectId(task_id)},
            {'$set': {
                'status': 'completed',
                'completed_at': datetime.now(timezone.utc),
                'console_output': '\n'.join(logger.lines),
            }}
        )

    except Exception as e:
        logger.log(f"\nERROR: {str(e)}")
        logger.log(traceback.format_exc())
        logger.finalize()
        db.tasks.update_one(
            {'_id': ObjectId(task_id)},
            {'$set': {
                'status': 'failed',
                'error': str(e),
                'completed_at': datetime.now(timezone.utc),
                'console_output': '\n'.join(logger.lines),
            }}
        )


# ============================================================================
# TASK DISPATCHER
# ============================================================================
TASK_HANDLERS = {
    'compute_weights': handle_compute_weights,
    'run_step': handle_run_step,
}


# ============================================================================
# MAIN LOOP
# ============================================================================
def main():
    logger.info(
        "UP-MAVT Worker started | MongoDB: %s | Poll interval: %ss",
        MONGO_URI,
        POLL_INTERVAL,
    )

    while True:
        try:
            # Atomically claim a pending task
            task = db.tasks.find_one_and_update(
                {'status': 'pending'},
                {'$set': {
                    'status': 'running',
                    'started_at': datetime.now(timezone.utc),
                }},
                sort=[('created_at', 1)],  # FIFO
            )

            if task:
                task_type = task.get('type', 'unknown')
                task_id = str(task['_id'])
                logger.info("Processing task %s (type: %s)", task_id, task_type)

                handler = TASK_HANDLERS.get(task_type)
                if handler:
                    handler(task)
                else:
                    logger.warning("Unknown task type: %s", task_type)
                    db.tasks.update_one(
                        {'_id': task['_id']},
                        {'$set': {
                            'status': 'failed',
                            'error': f'Unknown task type: {task_type}',
                            'completed_at': datetime.now(timezone.utc),
                        }}
                    )
            else:
                time.sleep(POLL_INTERVAL)

        except KeyboardInterrupt:
            logger.info("Worker shutting down...")
            break
        except Exception as e:
            logger.error("Worker loop error: %s", e, exc_info=True)
            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
