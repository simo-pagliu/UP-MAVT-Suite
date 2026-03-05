# UPMAVT Modularity Refactor - Implementation Instructions

## Overview
Refactor the UPMAVT analysis workflow to support two deployment modes while keeping core analysis modules unchanged.

**Two Deployments:**
- **Server Mode**: Worker uses `load_DB.py` to fetch data from MongoDB
- **Local Mode**: Downloadable zip package uses `load_LOCAL.py` to read local CSV files

**Core modules remain unchanged:**
- `upmavt.py` - Main analysis (same function signatures)
- `weight_space_definition.py` - Weight space computation (same function signatures)

---

## Part 1: Create Loading Scripts

### `load_DB.py` (for server/worker deployment)
**Purpose**: Extract data from MongoDB and format for core modules.

**Functions to implement:**
- `load_input_data(db, study_id)` → returns criteria, alternatives dict
- `load_session_data(db, session_id)` → returns value_functions, qualitative_indicators, bwt
- `load_computed_weights(db, study_id)` → returns computed_weights dict with weight_solutions

**Input signature (from MongoDB documents):**
- `inputs` collection: criteria list, alternatives data
- `sessions` collection: value_functions, qualitative_indicators, bwt comparisons
- `study_sessions` collection: computed_weights with weight_solutions dict

---

### `load_LOCAL.py` (for local/standalone deployment)
**Purpose**: Read data from local CSV files and format for core modules.

**Functions to implement:**
- `load_input_data(data_dir)` → returns criteria, alternatives dict
- `load_session_data(data_dir, session_name)` → returns value_functions, qualitative_indicators, bwt
- `load_computed_weights(weights_csv_path)` → returns computed_weights dict

**Expected CSV structure in data folder:**
```
data/
├── input.csv                 (alternatives, criteria - common file)
├── elicitation_1/
│   ├── value_functions.csv
│   ├── qualitative_indicators.csv
│   ├── bwt_comparisons.csv
├── elicitation_2/
│   ├── value_functions.csv
│   ├── qualitative_indicators.csv
│   ├── bwt_comparisons.csv
└── ...
```

---

## Part 2: Local Standalone Package

### Directory Structure (zip file contents)
```
elicitation-tools-local/
├── main.py                          (interactive CLI workflow)
├── load_LOCAL.py                    (data loading)
├── upmavt.py                        (core analysis)
├── weight_space_definition.py       (core weight computation)
├── requirements.txt                 (Python dependencies)
├── README.md                        (setup & usage instructions)
└── data/
    ├── input.csv                    (example: alternatives & criteria)
    └── elicitation_1/
        ├── value_functions.csv
        ├── qualitative_indicators.csv
        └── bwt_comparisons.csv
```

---

## Part 3: main.py - Interactive CLI Workflow

**Behavior:**
1. Load data from `data/` directory
2. Detect elicitations from subdirectories
3. Interactive workflow (prompt for each step):
   - Step 1 (Compute Weights): **Mandatory** (skip only if `weight_solutions.csv` already exists)
   - Steps 2-6: Optional (user can skip or run)
4. After each step: Save results to CSV + generate plots (matplotlib)
5. Store all results in `results/` folder

**Step prompts:**
```
[Step 1] Compute Weights
  - Weight solutions file exists: weight_solutions.csv
  - Skip this step? (y/n) [default: n] → If no, run it. If yes, load from file.
  
[Step 2] Consensus Analysis - Run? (y/n) [default: n]
  - Aggregation method? (SUM/GEO/HAR) [default: SUM]
  - MC iterations? [default: 1000]
  
[Step 3] Dominance Analysis - Run? (y/n) [default: n]
  - Aggregation method? [default: SUM]
  - MC iterations? [default: 1000]
  
... (similar for Steps 4-6)
```

**Output files in `results/` folder:**
```
results/
├── step1_weight_solutions.csv
├── step1_weight_space.csv
├── step2_consensus_results.csv
├── step2_consensus_distributions.png      (one per alternative)
├── step3_dominance_results.csv
├── step3_dominance_heatmap.png
├── step4_compensation_results.csv
├── step4_compensation_heatmaps.png        (3 heatmaps: SUM, GEO, HAR)
├── step5_uncertainty_results.csv
├── step5_uncertainty_distributions.png    (one per alternative)
├── step6_final_results.csv
└── step6_final_heatmap.png
```

---

## Part 4: Worker Modification

**Update `worker.py`:**
- Import `load_DB` instead of direct MongoDB calls
- Use standardized data structures from `load_DB.py`
- Core functions `run_upmavt()` and `compute_weights()` remain unchanged

**Example refactoring:**
```python
from scripts.load_DB import load_input_data, load_session_data
from scripts.upmavt import run_upmavt
from scripts.weight_space_definition import compute_weights

# In handle_compute_weights():
criteria = load_input_data(db, study_id)['criteria']
sessions = [load_session_data(db, sid) for sid in selected_session_ids]

# In handle_run_step():
computed_weights = load_computed_weights(db, study_id)
results = run_upmavt(sessions, criteria, computed_weights, params)
```

---

## Part 5: Data Structure Specifications

### CSV Format: input.csv
```csv
Alternative,Criterion1,Criterion2,...,Unit1,Unit2,...,Group1,Group2,...
Description,Desc1,Desc2,...
[data rows]
```

### CSV Format: value_functions.csv (per elicitation)
```csv
criterion_name,x,y,confidence
Cost,0,1,3
Cost,1000,0,3
Power,0,0,4
Power,1000,1,4
```

### CSV Format: bwt_comparisons.csv (per elicitation)
```csv
type,reference_criterion,adjusted_criterion,data_value,group,confidence,a
best,Cost,Power,50,Group A,3,2.5
worst,Power,Cost,300,Group A,2,1.8
```

### CSV Format: weight_solutions.csv (output from Step 1)
```csv
session_id,Cost,Power,...
elicitation_1,0.3,0.4,...
elicitation_1,0.25,0.45,...
```

---

## Implementation Checklist

- [ ] Create `load_DB.py` with MongoDB extraction functions
- [ ] Create `load_LOCAL.py` with CSV parsing functions
- [ ] Create `main.py` with interactive CLI workflow
- [ ] Update `worker.py` to use `load_DB.py`
- [ ] Create example data files in `data/` folder
- [ ] Create `requirements.txt` for local package
- [ ] Create `README.md` with setup instructions
- [ ] Add plotting functions (matplotlib) for all step outputs