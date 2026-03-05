# UPMAVT Modularity: Deployment & Architecture Guide

## Overview

The UP-MAVT analysis code has been refactored to support two deployments:

1. **Server Deployment** (MongoDB-backed): Worker processes pull data from MongoDB
2. **Local Standalone** (CSV-based): Users download and run analysis on their machine

**Key Design Principle**: Core analysis modules (`upmavt.py`, `weight_space_definition.py`) remain completely unchanged. Only data loading differs between deployments.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CORE ANALYSIS MODULES                    │
│  (upmavt.py, weight_space_definition.py) - UNCHANGED        │
│                                                             │
│  Function signatures and logic identical for both modes    │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │
                    ┌─────────┴─────────┐
                    │                   │
            ┌───────▼────────┐   ┌──────▼────────┐
            │   load_DB.py   │   │  load_LOCAL   │
            │ (MongoDB)      │   │  .py (CSV)    │
            └────────────────┘   └───────────────┘
                    ▲                     ▲
                    │                     │
        ┌───────────┴──────────┐   ┌─────┴────────────┐
        │  MongoDB Database    │   │  CSV Files       │
        │  collections:        │   │  data/           │
        │  - inputs            │   │  ├── input.csv   │
        │  - sessions          │   │  └── elicit_*/   │
        │  - study_sessions    │   │      ├── vf.csv  │
        │  - tasks             │   │      ├── qi.csv  │
        │                      │   │      └── bwt.csv │
        └──────────────────────┘   └──────────────────┘
             (web + worker)            (local)
```

## Part 1: Core Modules (load_DB.py)

### Purpose
Extract data from MongoDB and format for core analysis functions.

### Key Functions

```python
# Load input (criteria, alternatives)
input_data = load_input_data(db, study_session_id)
# Returns: {'criteria': [...], 'alternatives': {...}, 'criteria_names': [...]}

# Load single session
session = load_session_data(db, session_id)
# Returns: {_id, name, value_functions, qualitative_indicators, bwt, ...}

# Load batch of sessions
sessions = load_session_data_batch(db, [session_id1, session_id2, ...])
# Returns: [session1, session2, ...]

# Load pre-computed weights
weights = load_computed_weights(db, study_session_id)
# Returns: {'weight_solutions': {session_id: [weights], ...}, ...}
```

### Integration Points

**In worker.py `handle_compute_weights()`:**
```python
input_data = load_input_data(db, study_session_id)
criteria = input_data['criteria']

for session_id in selected_session_ids:
    session = load_session_data(db, session_id)
    ws = compute_weights(session, criteria)  # Unchanged!
    weight_solutions[session_id] = ws

save_computed_weights(db, study_session_id, weight_solutions)
```

**In worker.py `handle_run_step()`:**
```python
input_data = load_input_data(db, study_session_id)
criteria = input_data['criteria']

computed_weights = load_computed_weights(db, study_session_id)
session_docs = load_session_data_batch(db, selected_session_ids)

results = run_upmavt(session_docs, criteria, computed_weights, params)
save_step_results(db, study_session_id, step_number, results)
```

## Part 2: Local Standalone Module (load_LOCAL.py)

### Purpose
Read from CSV files and format data identically to load_DB.py.

### Key Functions

```python
# Load input from input.csv
input_data = load_input_data(data_dir)
# Returns: {'criteria': [...], 'alternatives': {...}, 'criteria_names': [...]}
# Identical output to load_DB version!

# Load session from elicitation_N/ directory
session = load_session_data(data_dir, 'elicitation_1')
# Returns: {_id, name, value_functions, qualitative_indicators, bwt, ...}
# Same structure as MongoDB session documents!

# Load weight solutions from CSV
weights = load_computed_weights(weights_csv_path)
# Returns: {'weight_solutions': {...}}
```

### CSV File Specification

**input.csv** (shared across all elicitations)
```
Alternative,Criterion_A,Criterion_B,...
Group,Economic,Technical,...
Unit,EUR,MWe,...
Description,Description_A,Description_B,...
Alternative1,value1,value2,...
Alternative2,value1,value2,...
```

**elicitation_N/value_functions.csv**
```
criterion_name,x,y,confidence
Criterion_A,0,1,3
Criterion_A,1000,0,3
...
```

**elicitation_N/qualitative_indicators.csv**
```
criterion_name,alternative,rank,value,confidence
Criterion_X,Alt1,1,0.9,4
Criterion_X,Alt2,2,0.7,4
...
```

**elicitation_N/bwt_comparisons.csv**
```
type,reference_criterion,adjusted_criterion,data_value,group,confidence,a
best,Criterion_A,Criterion_B,5000,Economic,3,2.5
worst,Criterion_B,Criterion_A,800,Economic,3,1.8
...
```

## Part 3: Interactive Local Workflow (main.py)

### Purpose
Guide users through UP-MAVT analysis on their machine.

### Usage

```bash
cd /path/to/downloaded/package
source venv/bin/activate
python main.py
```

### Workflow

**Step 1: Compute Weights** (MANDATORY or skip if file exists)
- Loads criteria + elicitations
- Runs weight space optimization (weight_space_definition.compute_weights)
- Saves to `results/step1_weight_solutions.csv`

**Steps 2-6: Optional**
- User prompted for each step
- Configure: aggregation method, MC iterations
- Run analysis using run_upmavt()
- Save results to CSV + generate plots

### User Interactions

```
[Step 1] Compute Weights
  ✓ Weight solutions file found: results/step1_weight_solutions.csv
  Skip this step and use existing file? (y/n) [default: y]? 

[Step 2] Consensus Analysis - Run? (y/n) [default: n]? y
  Select aggregation method:
    1. SUM (default)
    2. GEO
    3. HAR
  Enter choice (1-3): [default: 1]
  
  MC Iterations [default: 1000]: 2000
  ✓ Running consensus analysis...
  ✓ Results saved to: results/step2_consensus_results.csv
```

## Deployment Comparison

| Feature | Server (MongoDB) | Local (CSV) |
|---------|-----------------|-----------|
| Data Source | MongoDB collections | CSV files in `data/` |
| Data Loader | `load_DB.py` | `load_LOCAL.py` |
| Execution | Worker daemon | Interactive Python script |
| User Interface | Web (React) | CLI (terminal) |
| Scalability | Multi-worker, cloud-ready | Single machine |
| Data Sharing | All in database | Download ZIP package |
| Cost | Server infrastructure | Free (local) |
| Use Case | Organization studies | Individual/research |

## Installation Instructions

### Server Deployment
No changes needed. Worker automatically uses load_DB.py via existing docker-compose setup.

### Local Standalone
User downloads ZIP with structure:
```
elicitation-tools-local.zip
├── main.py
├── load_LOCAL.py
├── upmavt.py
├── weight_space_definition.py
├── requirements.txt
├── README.md
└── data/
    ├── input.csv
    └── elicitation_1/
        ├── value_functions.csv
        ├── qualitative_indicators.csv
        └── bwt_comparisons.csv
```

Setup:
```bash
unzip elicitation-tools-local.zip
cd elicitation-tools-local
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
```

## Testing the Modular Design

### Unit Test Template

```python
# Both should produce identical outputs:

# Test 1: Load via MongoDB
from load_DB import load_input_data
input_mongo = load_input_data(db, study_id)

# Test 2: Load via CSV
from load_LOCAL import load_input_data
input_csv = load_input_data('data/')

# Assert structure identical
assert set(input_mongo['criteria_names']) == set(input_csv['criteria_names'])
assert set(input_mongo['alternatives'].keys()) == set(input_csv['alternatives'].keys())
```

## Future Enhancements

1. **Alternative Data Formats**: 
   - Excel (.xlsx) support via `load_EXCEL.py`
   - JSON support via `load_JSON.py`
   - REST API support via `load_API.py`

2. **Caching**:
   - Cache load_LOCAL results for faster re-runs
   - Implement incremental weight updates

3. **Visualization**:
   - Enhanced matplotlib plotting in main.py
   - HTML report generation
   - Interactive Plotly/Altair charts

4. **Validation**:
   - Data schema validation before analysis
   - Unit tests for both loaders
