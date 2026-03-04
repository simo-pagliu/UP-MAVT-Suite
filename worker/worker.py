#!/usr/bin/env python3
"""
UP-MAVT Worker
Polls MongoDB for pending tasks, executes Python simulations,
and saves results back to the database.
"""

import os
import sys
import time
import traceback
from datetime import datetime, timezone

from pymongo import MongoClient
from bson.objectid import ObjectId

from scripts.weight_space_definition import compute_weights
from scripts.upmavt import run_upmavt

# ============================================================================
# CONFIG
# ============================================================================
MONGO_URI = os.getenv("MONGO_URI", "mongodb://mongo:27017/elicitation")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "2"))  # seconds

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
        """Log a message: print to stdout and flush to DB immediately."""
        line = str(message)
        self.lines.append(line)
        print(line, flush=True)
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

    try:
        logger.log("=" * 60)
        logger.log("COMPUTE WEIGHTS")
        logger.log("=" * 60)

        # Get the study session to find the input
        study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
        if not study:
            raise ValueError(f"Study session {study_session_id} not found")

        input_id = study.get('input_id')
        if not input_id:
            raise ValueError("Study session has no input defined")

        input_doc = db.inputs.find_one({'_id': input_id})
        if not input_doc:
            raise ValueError("Input document not found")

        criteria = input_doc.get('criteria', [])
        if not criteria:
            raise ValueError("No criteria found in input")

        # Process each selected session
        weight_solutions = {}
        total = len(selected_session_ids)

        for idx, session_id in enumerate(selected_session_ids):
            session = db.sessions.find_one({'_id': ObjectId(session_id)})
            if not session:
                logger.log(f"WARNING: Session {session_id} not found, skipping")
                continue

            session_name = session.get('name', session_id)
            logger.log(f"\n--- Processing session {idx + 1}/{total}: {session_name} ---")

            ws = compute_weights(session, criteria, print_fn=logger.log)
            weight_solutions[session_id] = ws

            logger.log(f"✓ Session {session_name} completed ({len(ws)} feasible solutions)")

        # Save results to DB
        result_doc = {
            'timestamp': datetime.now(timezone.utc),
            'weight_solutions': weight_solutions,
        }

        db.study_sessions.update_one(
            {'_id': ObjectId(study_session_id)},
            {'$set': {'computed_weights': result_doc}}
        )

        logger.log(f"\n✓ All weights computed and saved to database.")
        logger.log(f"  Processed {total} elicitation session(s).")
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

        # Get study session
        study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
        if not study:
            raise ValueError(f"Study session {study_session_id} not found")

        computed_weights = study.get('computed_weights')
        if not computed_weights:
            raise ValueError("Weights have not been computed yet. Run Step 1 first.")

        input_id = study.get('input_id')
        if not input_id:
            raise ValueError("Study session has no input defined")

        input_doc = db.inputs.find_one({'_id': input_id})
        if not input_doc:
            raise ValueError("Input document not found")

        criteria = input_doc.get('criteria', [])

        # Load session documents
        session_docs = []
        for session_id in selected_session_ids:
            session = db.sessions.find_one({'_id': ObjectId(session_id)})
            if session:
                session['session_id'] = session_id
                session_docs.append(session)
            else:
                logger.log(f"WARNING: Session {session_id} not found, skipping")

        if not session_docs:
            raise ValueError("No valid sessions found")

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
                    session_docs, criteria, computed_weights,
                    step_params, print_fn=logger.log
                )
                results_by_aggregation[agg_method] = formatted

            # Save combined results
            result_doc = {
                'timestamp': datetime.now(timezone.utc),
                'mc_iterations': mc_iterations,
                'mc_mode': mc_mode,
                'use_random_weights': use_random_weights,
                'results_by_aggregation': results_by_aggregation,
            }

            db_field = f'step_{step_number}_results'
            db.study_sessions.update_one(
                {'_id': ObjectId(study_session_id)},
                {'$set': {db_field: result_doc}}
            )

        else:
            step_params = {
                'mc_iterations': mc_iterations,
                'aggregation_method': aggregation_method,
                'mc_mode': mc_mode,
                'use_random_weights': use_random_weights,
                'opinion_weights': opinion_weights,
            }

            formatted = run_upmavt(
                session_docs, criteria, computed_weights,
                step_params, print_fn=logger.log
            )

            # Save results
            result_doc = {
                'timestamp': datetime.now(timezone.utc),
                **formatted,
            }

            db_field = f'step_{step_number}_results'
            db.study_sessions.update_one(
                {'_id': ObjectId(study_session_id)},
                {'$set': {db_field: result_doc}}
            )

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
    print("=" * 60)
    print("UP-MAVT Worker started")
    print(f"MongoDB: {MONGO_URI}")
    print(f"Poll interval: {POLL_INTERVAL}s")
    print("=" * 60)
    sys.stdout.flush()

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
                print(f"\n[{datetime.now().isoformat()}] Processing task {task_id} (type: {task_type})")
                sys.stdout.flush()

                handler = TASK_HANDLERS.get(task_type)
                if handler:
                    handler(task)
                else:
                    print(f"  Unknown task type: {task_type}")
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
            print("\nWorker shutting down...")
            break
        except Exception as e:
            print(f"Worker loop error: {e}")
            traceback.print_exc()
            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
