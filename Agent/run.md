# Implementation Instructions: Run UP-MAVT Feature

## Overview
Implement a complete UP-MAVT workflow for the practitioner section with 6 steps that run Monte Carlo simulations to analyze multi-criteria decision problems with uncertainty propagation.

## Architecture

### New Docker Container - Python Worker
- **Purpose**: Execute Python simulation scripts in isolated environments
- **Type**: Worker service (not a Flask API)
- **Database**: Own MongoDB connection (same database, different container)
- **Communication**: Backend sends tasks to worker, worker executes and saves results to DB
- **Execution Time**: Tasks can take 5 minutes to 30 minutes
- **Source Code**: Copy scripts from `UPMAVTcode/` folder and modify as needed (do NOT modify originals)

### Database Schema Extensions

#### Session Document - Add these fields:
```javascript
{
  // ... existing fields ...
  "computed_weights": {
    "timestamp": ISODate,
    "weight_spaces": {
      "<elicitation_session_id>": [
        // Array of weight values (one per criterion)
        // Each row represents valid weights for one criterion
        [0.239, 0.24, 0.242, ...],  // Criterion 1
        [0.06, 0.061, 0.062, ...],   // Criterion 2
        ...
      ]
    }
  },
  "step_2_results": {
    "timestamp": ISODate,
    "mc_iterations": Number,
    "aggregation_method": String,
    "mc_mode": "strict",
    "results_by_elicitation": {
      "<elicitation_session_id>": [
        // CSV-like data: each row is one MC iteration
        // Columns are alternative names
        {"Nuclear": 0.555, "Solar": 0.488, "Gas": 0.240, "Coal": 0.335},
        {"Nuclear": 0.504, "Solar": 0.526, "Gas": 0.225, "Coal": 0.303},
        ...
      ]
    }
  },
  "step_3_results": {
    "timestamp": ISODate,
    "mc_iterations": Number,
    "aggregation_method": String,
    "mc_mode": "non_strict",
    "use_random_weights": true,
    "aggregated_results": [
      // Single array for all elicitations combined (non-strict mode)
      {"Nuclear": 0.495, "Solar": 0.455, "Gas": 0.457, "Coal": 0.306},
      ...
    ]
  },
  "step_4_results": {
    "timestamp": ISODate,
    "mc_iterations": Number,
    "mc_mode": "non_strict",
    "use_random_weights": true,
    "results_by_aggregation": {
      "weighted_sum": [...],
      "geometric_mean": [...],
      "harmonic_mean": [...]
    }
  },
  "step_5_results": {
    "timestamp": ISODate,
    "mc_iterations": Number,
    "aggregation_method": String,
    "mc_mode": "strict",
    "results_by_elicitation": { /* same format as step_2 */ }
  },
  "step_6_results": {
    "timestamp": ISODate,
    "mc_iterations": Number,
    "aggregation_method": String,
    "mc_mode": "non_strict",
    "aggregated_results": [ /* same format as step_3 */ ]
  }
}
```

## Step-by-Step Implementation

### Step 1: Compute Weights

**Script**: `weight_space_definition.py`

**Modifications Required**:
- Replace CSV file reading with MongoDB queries
- Fetch BWT comparisons from `session.bwt` field
- Fetch value functions from `session.value_functions` field
- Return weight space data instead of writing to CSV
- Must run for EACH selected elicitation session sequentially

**Input Parameters**: None (reads from DB)

**Output to DB**:
- Save to `computed_weights` field
- Include timestamp
- Store one weight space array per elicitation session ID

**UI Elements**:
- Button: "Compute & Save Weights"
- Button: "Reset Weights" (clears `computed_weights` field, allows recomputation)
- Console output display (scrollable panel showing script prints)
- Progress indicator: "Processing elicitation X of Y..."
- Dropdown: Select elicitation to view weight space plot
- Plot: Vertical scatter/strip plot showing weight distribution per criterion (X-axis: weight values, Y-axis: criterion names)
- Plot: Horizontal plot (leave blank for now)

**Behavior**:
- Only enabled if at least one elicitation session is selected
- While running: Disable button, show "Stop" button
- Stream console output from script (prints)
- After completion: Save to DB, unlock steps 2-6
- If weights already computed: Show timestamp and "Reset Weights" button
- Generate plots from DB data (do NOT save plot data)

---

### Step 2: Assess Consensus (SMC)

**Script**: `UPMAVT_new.py`

**Modifications Required**:
- Replace CSV file reading with MongoDB queries
- Fetch alternatives from study session's input
- Fetch value functions from `session.value_functions`
- Fetch confidence levels from value functions
- Fetch weight spaces from `session.computed_weights`
- Save results to DB instead of CSV files

**Parameters**:
```python
ELICITATION_CODES = [list of selected session IDs]
MC_ITERATIONS = user input (default 1000, min 100, max 5000)
AGGREGATION_METHOD = user selected from UI (weighted_sum/geometric_mean/harmonic_mean)
MC_MODE = "strict"
USE_RANDOM_WEIGHTS = False
ELICITATION_OPINION_WEIGHTS = None
```

**Output to DB**: Save to `step_2_results`

**UI Elements**:
- Number input: MC Iterations (default 1000, min 100, max 5000)
- Selector: Aggregation Method (already in UI)
- Button: "Run Step 2"
- Console output panel
- Result plots (TBD)

---

### Step 3: Uncertainty Without Consensus (NSMC with Random Weights)

**Script**: `UPMAVT_new.py`

**Modifications Required**:
- Add `USE_RANDOM_WEIGHTS` parameter
- When `True`, modify weight sampler to use Dirichlet distribution instead of sampling from weight space

**Parameters**:
```python
ELICITATION_CODES = [list of selected session IDs]
MC_ITERATIONS = user input (default 1000)
AGGREGATION_METHOD = user selected
MC_MODE = "non_strict"
USE_RANDOM_WEIGHTS = True
ELICITATION_OPINION_WEIGHTS = None
```

**Output to DB**: Save to `step_3_results` (aggregated results, not per-elicitation)

**UI Elements**: Same as Step 2 but button labeled "Run Step 3"

---

### Step 4: Assess Compensatory Dynamics

**Script**: `UPMAVT_new.py` (run 3 times)

**Parameters**:
```python
ELICITATION_CODES = [list of selected session IDs]
MC_ITERATIONS = user input (default 200 for this step, min 100, max 5000)
AGGREGATION_METHOD = "weighted_sum" / "geometric_mean" / "harmonic_mean" (run all 3)
MC_MODE = "non_strict"
USE_RANDOM_WEIGHTS = True
ELICITATION_OPINION_WEIGHTS = None
```

**Execution**: Run the script 3 times sequentially, once per aggregation method

**Output to DB**: Save to `step_4_results` with results separated by aggregation method

**UI Elements**:
- Number input: MC Iterations (default 200)
- Button: "Run Step 4"
- Progress: "Running aggregation method X of 3..."
- Console output
- Result plots (TBD)

---

### Step 5: Overall Uncertainty Assessment (SMC)

**Script**: `UPMAVT_new.py`

**Parameters**:
```python
ELICITATION_CODES = [list of selected session IDs]
MC_ITERATIONS = user input (default 1000)
AGGREGATION_METHOD = user selected
MC_MODE = "strict"
USE_RANDOM_WEIGHTS = False
ELICITATION_OPINION_WEIGHTS = None
```

**Output to DB**: Save to `step_5_results`

**UI Elements**: Same as Step 2 but button labeled "Run Step 5"

---

### Step 6: Final Results (NSMC)

**Script**: `UPMAVT_new.py`

**Parameters**:
```python
ELICITATION_CODES = [list of selected session IDs]
MC_ITERATIONS = user input (default 1000)
AGGREGATION_METHOD = user selected
MC_MODE = "non_strict"
USE_RANDOM_WEIGHTS = False
ELICITATION_OPINION_WEIGHTS = None
```

**Output to DB**: Save to `step_6_results`

**UI Elements**: Same as Step 2 but button labeled "Run Step 6"

---

## General Requirements

### Console Output
- Show real-time prints from Python scripts
- Include progress messages: "Processing elicitation X of Y..."
- Scrollable text area
- "View Console Output" button to show/hide

### Stop Execution
- "Stop" button appears during execution
- Terminates running process
- Records in console: "[Execution stopped by user]"

### Result Persistence
- Each run OVERWRITES previous results (no history)
- Save timestamp with each result
- If user runs step at 12:00 then again at 12:30, second run replaces first

### Step Dependencies
- Steps 2-6 are DISABLED until Step 1 is completed
- All steps require at least one elicitation session selected
- Show completion timestamps when results exist

### Weight Space Plots (Step 1)
- Dropdown to select which elicitation session to visualize
- Vertical plot: X-axis = weight values, Y-axis = criterion names, points show valid weight ranges
- Generate plots from DB data dynamically (do NOT save plot data to DB)
- One plot per elicitation session

### Script Modifications
- Copy scripts from `UPMAVTcode/` to worker container
- DO NOT modify original scripts in `UPMAVTcode/`
- Replace all CSV file I/O with MongoDB operations
- Maintain all calculation logic unchanged
- Scripts should accept parameters programmatically (not from file constants)

## API Endpoints (Backend)

### POST `/api/study-session/<study_id>/compute-weights`
- Triggers weight computation for selected elicitation sessions
- Returns task ID for status tracking

### POST `/api/study-session/<study_id>/run-step-<N>`
- Triggers step N execution (N = 2, 3, 4, 5, 6)
- Body: `{ mc_iterations, aggregation_method, selected_sessions }`
- Returns task ID

### GET `/api/study-session/<study_id>/step-status/<step_name>`
- Check if step is completed
- Returns timestamp and status

### POST `/api/study-session/<study_id>/reset-weights`
- Clears `computed_weights` field
- Allows recomputation

### GET `/api/study-session/<study_id>/weight-space/<elicitation_id>`
- Returns weight space data for plotting

## Worker Service Implementation

### Docker Setup
- New service in `docker-compose.yml`
- Python environment with scipy, numpy, pandas
- MongoDB connection string from environment
- Shared network with backend and MongoDB

### Task Queue (Simplified)
- Backend writes task to MongoDB collection `tasks`
- Worker polls for pending tasks
- Worker updates task status: pending → running → completed/failed
- Worker streams console output to task document

### Worker Structure
```
worker/
  Dockerfile
  requirements.txt
  worker.py (main loop)
  scripts/
    weight_space_definition.py (modified)
    upmavt_new.py (modified)
  utils/
    db_utils.py
    weight_sampler.py (with random weights support)
```

## Notes
- Execution times: 5-30 minutes per step
- All parameters have sensible defaults
- UI should be responsive during long runs
- Consider implementing task cancellation
- Error handling: Save error messages to DB if script fails

