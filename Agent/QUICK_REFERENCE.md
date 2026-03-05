# Quick Reference: Architecture Changes

**TL;DR**: Removed all data loading from analysis modules. They now receive pre-processed data as arguments.

---

## Before vs After

### Before (❌ BROKEN ARCHITECTURE)

```python
# weight_space_definition.py
def compute_weights(session_doc, criteria, print_fn=None):
    # Loads from DB internally - WRONG!
    value_functions = load_value_functions_from_db(criteria, ...)
    comparisons = load_comparisons_from_db(session_doc.get('bwt'))
    ...

# upmavt.py
def run_upmavt(session_docs, criteria, computed_weights, params, print_fn=None):
    # Loads from DB internally - WRONG!
    vf_dict, conf_dict = load_value_functions_with_confidence_from_db(...)
    alternatives, criteria_names = load_alternatives_from_db_with_qualitative(...)
    comparisons = load_comparisons_from_db(...)
    ...
```

### After (✅ CLEAN ARCHITECTURE)

```python
# weight_space_definition.py
def compute_weights(value_functions, comparisons, criteria_names=None, print_fn=None):
    # Receives pre-processed data - CORRECT!
    # No loading whatsoever

# upmavt.py
def run_upmavt(vf_lists, confidence_lists, weight_solutions_list, 
               alternatives, criteria_names, params, print_fn=None):
    # Receives pre-processed data - CORRECT!
    # No loading whatsoever
```

---

## How to Call Functions Now

### compute_weights()

**Old Way** (❌ NO LONGER WORKS):
```python
# This no longer works - function signature changed
ws = compute_weights(session_doc, criteria, print_fn=print)
```

**New Way** (✅ CORRECT):
```python
# Load and prepare data
value_functions = build_value_functions_from_session(session_doc, criteria)
comparisons = build_comparisons_from_session(session_doc)
criteria_names = [c['criterion_name'] for c in criteria]

# Call with clean data
ws = compute_weights(value_functions, comparisons, criteria_names=criteria_names, print_fn=print)
```

### run_upmavt()

**Old Way** (❌ NO LONGER WORKS):
```python
# This no longer works - function signature completely changed
results = run_upmavt(session_docs, criteria, computed_weights, params, print_fn=print)
```

**New Way** (✅ CORRECT):
```python
# Load and prepare data for each elicitation
vf_lists = []
confidence_lists = []
weight_solutions_list = []

for session_doc in session_docs:
    vf_dict, conf_dict = build_value_functions_from_session(
        session_doc, criteria, return_confidence=True
    )
    vf_lists.append(vf_dict)
    confidence_lists.append(conf_dict)
    weight_solutions_list.append(weight_solutions_data.get(session_id, []))

# Build alternatives
alternatives, criteria_names = build_alternatives_with_qualitative(input_doc, qualitative_indicators)

# Call with clean data
results = run_upmavt(vf_lists, confidence_lists, weight_solutions_list, 
                     alternatives, criteria_names, params, print_fn=print)
```

---

## New Helper Functions in Loaders

### load_DB.py

```python
# Extract value functions and optionally confidence from session document
vf_dict, conf_dict = build_value_functions_from_session(
    session_doc, criteria, return_confidence=True
)
# Returns: ({criterion_name: interp1d, ...}, {criterion_name: int, ...})

# Extract comparisons from session document
comparisons = build_comparisons_from_session(session_doc)
# Returns: [{REFERENCE_CRITERION, ADJUSTED_CRITERION, DATA_VALUE, TYPE, GROUP}, ...]

# Build alternatives with qualitative substitution
alternatives, criteria_names = build_alternatives_with_qualitative(
    input_doc, qualitative_indicators
)
# Returns: ({alt_name: {crit_name: value, ...}, ...}, [...])
```

### load_LOCAL.py

```python
# Same functions, but load from CSV files instead of MongoDB
vf_dict, conf_dict = build_value_functions_from_csv(
    data_dir, session_name, criteria, return_confidence=True
)

comparisons = build_comparisons_from_csv(data_dir, session_name)

alternatives, criteria_names = build_alternatives_from_csv(data_dir)
```

---

## Updated Modules

| Module | Change | Impact |
|--------|--------|--------|
| weight_space_definition.py | Removed 5 loading functions | Call signature changed for `compute_weights()` |
| upmavt.py | Removed loading logic, updated to accept pre-loaded data | Call signature completely changed for `run_upmavt()` |
| load_DB.py | Added 3 helper functions for building standardized data structures | No breaking changes - existing functions work as before |
| load_LOCAL.py | Added 3 helper functions for building standardized data structures | No breaking changes - existing functions work as before |
| worker.py | Updated to use new helper functions before calling analysis | No logic change - just reorganized data preparation |
| main.py | Updated to use new helper functions before calling analysis | No logic change - just reorganized data preparation |

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    ORCHESTRATION LAYER                      │
│                   (worker.py / main.py)                     │
│                                                             │
│  1. load_input_data()              ← Gets input            │
│  2. load_session_data()            ← Gets elicitation      │
│  3. load_computed_weights()        ← Gets pre-computed     │
│  4. build_value_functions_*()      ← Formats data          │
│  5. build_comparisons_*()          ← Formats data          │
│  6. build_alternatives_*()         ← Formats data          │
│                                                             │
└──────────────────┬──────────────────────────────────────────┘
                   │ (passes formatted data)
┌──────────────────▼──────────────────────────────────────────┐
│                    ANALYSIS LAYER                           │
│         (weight_space_definition.py / upmavt.py)           │
│                                                             │
│  compute_weights(vf_dict, comparisons, ...)               │
│      → Optimization phase 1-3                              │
│      → Returns weight solutions                            │
│                                                             │
│  run_upmavt(vf_lists, conf_lists, alternatives, ...)     │
│      → Monte Carlo simulation                              │
│      → Returns analysis results                            │
│                                                             │
└──────────────────┬──────────────────────────────────────────┘
                   │ (analysis results)
┌──────────────────▼──────────────────────────────────────────┐
│                    PERSISTENCE LAYER                        │
│              (load_DB.py / load_LOCAL.py)                  │
│                                                             │
│  save_computed_weights()           ← Save weights          │
│  save_step_results()               ← Save analysis results │
│  save_weight_solutions_csv()       ← Save to CSV           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Removed Functions (Do NOT Use)

❌ These no longer exist:

```python
# From weight_space_definition.py
load_value_functions_from_db()
_generate_qualitative_value_function()
load_alternatives_from_db()
load_alternatives_from_db_with_qualitative()
load_comparisons_from_db()

# From upmavt.py (was never properly defined)
load_value_functions_with_confidence_from_db()
```

**Use helper functions instead**:
- `build_value_functions_from_session()` / `build_value_functions_from_csv()`
- `build_comparisons_from_session()` / `build_comparisons_from_csv()`
- `build_alternatives_with_qualitative()` / `build_alternatives_from_csv()`

---

## Function Signatures at a Glance

### compute_weights()

```python
# OLD (removed)
compute_weights(session_doc: dict, criteria: list[dict], print_fn=None) -> list[dict]

# NEW (current)
compute_weights(value_functions: dict, comparisons: list[dict], 
                criteria_names: list[str] | None = None, print_fn=None) -> list[dict]
```

### run_upmavt()

```python
# OLD (removed)
run_upmavt(session_docs: list[dict], criteria: list[dict], 
           computed_weights: dict, params: dict, print_fn=None) -> dict

# NEW (current)
run_upmavt(vf_lists: list[dict], confidence_lists: list[dict],
           weight_solutions_list: list[list], alternatives: dict, 
           criteria_names: list[str], params: dict, print_fn=None) -> dict
```

---

## Testing the Changes

### For Server Deployment

```python
from scripts.load_DB import *
from scripts.weight_space_definition import compute_weights

# Load and prepare
session_doc = load_session_data(db, session_id)
value_functions = build_value_functions_from_session(session_doc, criteria)
comparisons = build_comparisons_from_session(session_doc)

# Call with new signature
results = compute_weights(value_functions, comparisons, criteria_names=[...])
```

### For Local Deployment

```python
from load_LOCAL import *
from weight_space_definition import compute_weights

# Load and prepare
session_name = 'elicitation_1'
value_functions = build_value_functions_from_csv(data_dir, session_name, criteria)
comparisons = build_comparisons_from_csv(data_dir, session_name)

# Call with new signature
results = compute_weights(value_functions, comparisons, criteria_names=[...])
```

Both should produce identical results.

---

## Summary

**What Changed**: Data loading separated from analysis logic  
**Why**: Cleaner architecture, better testability, deployment flexibility  
**Impact**: Function signatures changed for `compute_weights()` and `run_upmavt()`  
**Migration**: Use helper functions to prepare data before calling analysis functions  
**Benefit**: Plug and play different data sources without changing analysis code
