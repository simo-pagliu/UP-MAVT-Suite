# Weight Space Refactoring: From Points to Solutions

## Overview
Currently, the weight space is saved as individual weight points per criterion, requiring resource-heavy rejection sampling during Monte Carlo simulations. This proposal refactors the system to save **complete valid weight solutions** instead, enabling efficient direct sampling.

## Problems with Current Implementation

### Current Approach (Inefficient)
```
weight_spaces[session_id] = {
  'Criterion_1': [0.1, 0.15, 0.2, 0.25, ...],
  'Criterion_2': [0.2, 0.25, 0.3, 0.35, ...],
  'Criterion_3': [0.35, 0.4, 0.45, 0.5, ...]
}
```

**Issues:**
1. **Rejection Sampling**: During each MC iteration, `weight_sampler()` randomly picks one value per criterion and validates that:
   - Weights sum to ~1.0
   - All constraints are satisfied
   - This requires repeated constraint evaluations and often multiple rejection attempts
2. **Resource Intensive**: Constraint checking during simulation adds computational overhead
3. **Inefficient Search**: May pick invalid weight combinations repeatedly

## Proposed Solution: Complete Weight Solutions

### New Approach (Efficient)
```
weight_solutions[session_id] = [
  {'Criterion_1': 0.25, 'Criterion_2': 0.35, 'Criterion_3': 0.40},
  {'Criterion_1': 0.26, 'Criterion_2': 0.34, 'Criterion_3': 0.40},
  {'Criterion_1': 0.24, 'Criterion_2': 0.36, 'Criterion_3': 0.40},
  ...
]
```

**Advantages:**
1. **Direct Sampling**: Pick a random solution from the list - all are guaranteed valid
2. **No Validation**: No constraint checking during simulation
3. **Pre-computed**: Feasibility validated once during weight computation phase
4. **Faster MC**: Iterations run much faster with no rejection sampling overhead

---

## Detailed Modifications

### 1. **Worker Script: `worker/scripts/weight_space_definition.py`**

#### Change: `enumerate_weight_space()` Function
- **Current behavior**: Returns `{criterion_name: [list of weight values]}`
- **New behavior**: Returns `([list of complete weight solution dicts], num_unique_solutions)`

**Pseudocode:**
```python
def enumerate_weight_space(weights_list, criterion_names, ...):
    # ... existing filtering and deduplication ...
    
    # Instead of:
    # result = {crit_name: unique_values for each crit_name}
    # return result, num_unique
    
    # Do:
    solutions = []
    for weight_array in unique_weights:
        solution = {crit_name: float(weight_array[idx]) 
                   for idx, crit_name in enumerate(criterion_names)}
        solutions.append(solution)
    
    return solutions, len(solutions)
```

**Key Changes:**
- Create a list of dictionaries instead of a dictionary of lists
- Each dictionary represents one feasible weight solution
- All weights in each solution already sum to 1.0
- All solutions already satisfy constraints

**Output Structure Change:**
```python
# OLD: returns (dict, int)
weight_space = {
    'Criterion_A': [0.1, 0.2, 0.3],
    'Criterion_B': [0.4, 0.5, 0.6]
}

# NEW: returns (list, int)
weight_solutions = [
    {'Criterion_A': 0.1, 'Criterion_B': 0.4},
    {'Criterion_A': 0.2, 'Criterion_B': 0.5},
    {'Criterion_A': 0.3, 'Criterion_B': 0.6}
]
```

#### Change: `compute_weights()` Function Return Value
- Update the docstring to reflect new return type
- Return new format from `enumerate_weight_space()`

---

### 2. **Worker: `worker/worker.py`**

#### Change: `handle_compute_weights()` Function Storage
- **Current**: Stores as `computed_weights.weight_spaces[session_id]` (dict structure)
- **New**: Stores as `computed_weights.weight_solutions[session_id]` (list structure)

**DB Storage Change:**
```python
# OLD
result_doc = {
    'timestamp': datetime.now(timezone.utc),
    'weight_spaces': weight_spaces,  # Dict[str, Dict[str, List[float]]]
}

# NEW
result_doc = {
    'timestamp': datetime.now(timezone.utc),
    'weight_solutions': weight_solutions,  # Dict[str, List[Dict[str, float]]]
}
```

**Update:**
1. Change `weight_spaces = {}` to `weight_solutions = {}`
2. Store result in `computed_weights.weight_solutions` instead of `computed_weights.weight_spaces`
3. Update logging messages to reflect "weight solutions" terminology

---

### 3. **UPMAVT Script: `worker/scripts/upmavt.py`**

#### Change: `weight_sampler()` Function
**Current Behavior:**
```python
def weight_sampler(weight_space, criteria, constraint_data, use_random_weights=False):
    """Rejection sampling - picks random values per criterion, validates."""
    while True:
        # Sample one value per criterion
        sampled_weights = {crit: np.random.choice(weight_space[crit]) 
                          for crit in criteria}
        # Validate sum and constraints (may fail, loop again)
        if not np.isclose(sum(sampled_weights.values()), 1.0):
            continue
        if constraint_violations_exist(sampled_weights, constraint_data):
            continue
        return sampled_weights
```

**New Behavior:**
```python
def weight_sampler(weight_solutions, criteria, constraint_data, use_random_weights=False):
    """Direct sampling - picks a random pre-validated solution."""
    if use_random_weights:
        # Keep Dirichlet sampling option for comparison/fallback
        n = len(criteria)
        raw = np.random.dirichlet(np.ones(n))
        return {crit: raw[i] for i, crit in enumerate(criteria)}
    
    # Simply pick a random solution from the pre-computed list
    solution = np.random.choice(len(weight_solutions))
    return weight_solutions[solution]  # Already a complete dict
```

**Key Changes:**
1. Parameter name: `weight_space` → `weight_solutions`
2. Type: `Dict[str, List[float]]` → `List[Dict[str, float]]`
3. Remove all constraint validation logic
4. Remove the `while True` loop entirely
5. Simple random selection from pre-computed feasible solutions
6. Keep optional `use_random_weights` fallback for validation scenarios

#### Change: `run_monte_carlo()` Function
- Update docstring to clarify `weight_solutions` is now a list of dicts
- Ensure parameter passing remains compatible

**Current Call Sites (lines ~525, ~546):**
```python
# BEFORE
sampled_weights = weight_sampler(
    weight_spaces[elicit_idx], criteria,
    constraint_data_list[elicit_idx],
    use_random_weights=use_random_weights
)

# AFTER (parameter name changes, but same logic)
sampled_weights = weight_sampler(
    weight_solutions[elicit_idx], criteria,
    constraint_data_list[elicit_idx],
    use_random_weights=use_random_weights
)
```
No changes needed here - just the parameter name in the list that's passed.

---

### 4. **Backend API: `backend/app/routes/api.py`**

#### Change: `get_weight_space()` Endpoint (Line ~1923)
**Current:** Returns `weight_spaces[session_id]` (dict)
**New:** Returns `weight_solutions[session_id]` (list)

```python
@bp.route('/study-session/<study_session_id>/weight-space/<session_id>', methods=['GET'])
def get_weight_space(study_session_id, session_id):
    """Get weight space data for a specific elicitation session."""
    # ...
    computed_weights = study.get('computed_weights')
    
    # OLD: weight_spaces = computed_weights.get('weight_spaces', {})
    # NEW: weight_solutions = computed_weights.get('weight_solutions', [])
    
    ws = weight_solutions.get(session_id, [])  # Now a list, not dict
    return jsonify({'weight_solutions': ws}), 200
```

#### NEW: `export_weight_solutions_csv()` Endpoint
**Location:** Add after the existing export endpoints (around line 1395)

```python
# Export weight solutions as CSV
@bp.route('/study-session/<study_session_id>/weight-solutions/export', methods=['GET'])
def export_weight_solutions_csv(study_session_id):
    """Export all weight solutions as CSV for all sessions."""
    db = current_app.db
    try:
        study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
        if not study:
            return jsonify({'error': 'Study session not found'}), 404

        computed_weights = study.get('computed_weights')
        if not computed_weights:
            return jsonify({'error': 'Weights not computed yet'}), 404

        weight_solutions = computed_weights.get('weight_solutions', {})
        if not weight_solutions:
            return jsonify({'error': 'No weight solutions found'}), 404

        # Build CSV
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Collect all sessions and their solutions
        all_sessions = []
        for session_id in sorted(weight_solutions.keys()):
            solutions = weight_solutions[session_id]
            if not isinstance(solutions, list):
                continue
            all_sessions.append({'session_id': session_id, 'solutions': solutions})
        
        if not all_sessions:
            return jsonify({'error': 'No valid weight solutions found'}), 404
        
        # Get headers from first solution (all have same criteria)
        first_solution = all_sessions[0]['solutions'][0] if all_sessions[0]['solutions'] else {}
        criteria_names = sorted(first_solution.keys())
        headers = ['Session_ID', 'Solution_Index'] + criteria_names
        writer.writerow(headers)
        
        # Write rows
        for session_data in all_sessions:
            session_id = session_data['session_id']
            for solution_idx, solution in enumerate(session_data['solutions']):
                row = [session_id, solution_idx]
                for crit in criteria_names:
                    value = solution.get(crit, '')
                    # Round to 3 decimal places if numeric
                    if value != '' and value is not None:
                        try:
                            value = round(float(value), 3)
                        except (TypeError, ValueError):
                            pass
                    row.append(value)
                writer.writerow(row)
        
        output_str = output.getvalue()
        return send_file(
            io.BytesIO(output_str.encode()),
            mimetype='text/csv',
            as_attachment=True,
            download_name=f'weight_solutions_{study.get("code", study_session_id)}.csv'
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

**Alternative: Export per-session weight solutions:**
```python
@bp.route('/study-session/<study_session_id>/weight-solutions/<session_id>/export', methods=['GET'])
def export_weight_solutions_csv_single_session(study_session_id, session_id):
    """Export weight solutions for a single elicitation session as CSV."""
    db = current_app.db
    try:
        study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
        if not study:
            return jsonify({'error': 'Study session not found'}), 404

        computed_weights = study.get('computed_weights')
        if not computed_weights:
            return jsonify({'error': 'Weights not computed yet'}), 404

        weight_solutions_dict = computed_weights.get('weight_solutions', {})
        solutions = weight_solutions_dict.get(session_id, [])
        
        if not solutions:
            return jsonify({'error': 'No solutions found for this session'}), 404

        # Build CSV
        output = io.StringIO()
        writer = csv.writer(output)
        
        criteria_names = sorted(solutions[0].keys()) if solutions else []
        headers = ['Solution_Index'] + criteria_names
        writer.writerow(headers)
        
        for solution_idx, solution in enumerate(solutions):
            row = [solution_idx]
            for crit in criteria_names:
                value = solution.get(crit, '')
                if value != '' and value is not None:
                    try:
                        value = round(float(value), 3)
                    except (TypeError, ValueError):
                        pass
                row.append(value)
            writer.writerow(row)
        
        session_name = 'unknown'
        session_obj = db.sessions.find_one({'_id': ObjectId(session_id)})
        if session_obj:
            session_name = session_obj.get('name', session_id)
        
        output_str = output.getvalue()
        return send_file(
            io.BytesIO(output_str.encode()),
            mimetype='text/csv',
            as_attachment=True,
            download_name=f'weight_solutions_{session_name}.csv'
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

**Recommendation:** Implement both endpoints - one for all sessions combined, one for individual sessions.

---

## Database Schema Changes

### MongoDB `study_sessions` Collection

**Computed Weights Document Before:**
```javascript
{
  computed_weights: {
    timestamp: ISODate(...),
    weight_spaces: {
      "session_id_1": {
        "Criterion_A": [0.1, 0.2, 0.3],
        "Criterion_B": [0.35, 0.4, 0.45],
        ...
      },
      "session_id_2": { ... }
    }
  }
}
```

**Computed Weights Document After:**
```javascript
{
  computed_weights: {
    timestamp: ISODate(...),
    weight_solutions: {
      "session_id_1": [
        { "Criterion_A": 0.1, "Criterion_B": 0.35, "Criterion_C": 0.55 },
        { "Criterion_A": 0.15, "Criterion_B": 0.36, "Criterion_C": 0.49 },
        { "Criterion_A": 0.12, "Criterion_B": 0.38, "Criterion_C": 0.50 },
        ...
      ],
      "session_id_2": [ ... ]
    }
  }
}
```

**Migration:** No existing data migration needed (computed weights will simply be recomputed). However, if keeping old data:
- Could maintain backward compatibility by checking for both `weight_spaces` and `weight_solutions`
- Or create a migration script to convert old format to new format

---

## Frontend Impact

### Currently Affected Components
1. **Weight Space Visualization** (`pages/RunUpMavtPage.jsx` or similar)
   - Currently displays weight space as points on axes
   - **Change**: Display as list of solutions or scatter plot of valid combinations

2. **API Calls**
   - Update endpoint references from `/weight-space/` to `/weight-solutions/`
   - Update data parsing to handle list instead of dict

### Potential Frontend Updates
- Update visualization to show all valid weight combinations
- Add download button for weight solutions CSV
- Update API response handling in components that fetch weight spaces

*(Note: Full frontend changes are out of scope for this planning document)*

---

## Migration Strategy

### Phase 1: Prepare (No Breaking Changes)
1. Add new functions alongside old ones
2. Keep old `weight_sampler(weight_space, ...)` signature with deprecation warning
3. Update worker to compute both old and new formats temporarily

### Phase 2: Switch (Breaking Change)
1. Remove old functions
2. Update all code to use new functions
3. Migrate database records (optional if setting expiries/recompute)

### Phase 3: Cleanup
1. Remove any deprecated code
2. Update all documentation
3. Frontend updates to use new endpoints

---

## Testing Checklist

### Unit Tests
- [ ] `enumerate_weight_space()` returns list of dicts
- [ ] Each solution dict has all criteria as keys
- [ ] Each solution's weights sum to ~1.0
- [ ] Solutions satisfy all constraints
- [ ] `weight_sampler()` picks random solution correctly
- [ ] MC simulation runs without iteration errors

### Integration Tests
- [ ] Worker computes and saves `weight_solutions` correctly
- [ ] API endpoint `/weight-solutions/export` generates valid CSV
- [ ] API endpoint `/weight-space/<session_id>` returns list
- [ ] MC results are identical (or within tolerance) before/after
- [ ] CSV download contains correct data with proper headers

### Performance Tests
- [ ] MC iterations run faster than before
- [ ] Memory usage for weight storage decreases
- [ ] API CSV generation completes within timeout

---

## Benefits Summary

| Aspect | Before | After |
|--------|--------|-------|
| **Sampling Method** | Rejection sampling + validation | Direct selection |
| **Constraint Checks per Iteration** | 1-N (until valid) | 0 |
| **MC Runtime** | Slower (includes validation) | Faster (direct pick) |
| **Memory per Solution Set** | Individual points | Complete solutions |
| **Export Format** | Task-specific | Unified CSV with all solutions |
| **Code Complexity** | Complex sampler | Simple random.choice() |

---

## Notes & Considerations

1. **Backward Compatibility**: 
   - Old `weight_space` format in DB will need migration or recomputation
   - Consider temporary dual-format support if needed

2. **Constraint Validation**:
   - All solutions are pre-validated during weight computation
   - No need for runtime validation
   - Constraint data can be discarded at runtime if memory is a concern

3. **Optional: keep Dirichlet sampling**:
   - Keep `use_random_weights=True` option for sensitivity testing
   - Useful for comparing with unconstrained weight distribution

4. **CSV Headers**:
   - Recommendation: Include `Session_ID` and `Solution_Index` for traceability
   - Consistent rounding to 3 decimal places

5. **Scalability**:
   - For large problems: if number of solutions explodes, consider:
     - Sampling from continuous approximation instead
     - Keeping both approaches as options

---

## Files to Modify (Summary)

1. **`worker/scripts/weight_space_definition.py`**
   - Function: `enumerate_weight_space()` - Return list instead of dict

2. **`worker/worker.py`**
   - Function: `handle_compute_weights()` - Store `weight_solutions` instead of `weight_spaces`

3. **`worker/scripts/upmavt.py`**
   - Function: `weight_sampler()` - Simple random selection from list
   - Function: `run_monte_carlo()` - Update docstring

4. **`backend/app/routes/api.py`**
   - Function: `get_weight_space()` - Update to return list
   - NEW: Function: `export_weight_solutions_csv()` - CSV export endpoint
   - OPTIONAL: NEW: Function: `export_weight_solutions_csv_single_session()` - Per-session export

---

## Questions for Clarification

1. Should we keep `constraint_data` in MC calls if we're not using it?
   - Recommendation: Keep for now (backward compatibility, debugging)

2. Should we export one CSV with all sessions or separate CSVs per session?
   - Recommendation: Implement both endpoints

3. Do we need to maintain backward compatibility with old weight_space format?
   - Recommendation: No - recompute all weights after updating code

4. Should the frontend show weight distributions differently?
   - Out of scope for this document
