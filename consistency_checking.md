# Consistency Checking Implementation for PILE-BWT Page

## Overview
Add consistency constraints to ensure pairwise comparisons don't contradict previous judgments.

## Phase 1: BEST-to-WORST Comparison
**Goal**: User compares the best criterion (C1) with the worst criterion (C2).
- This is the reference comparison
- User selects a slider value that produces `value_function(C1-C2) = V_ref` (e.g., 0.4)
- Store this reference value

## Phase 2: BEST-to-OTHERS Comparison
**Goal**: Complete the ranking of all criteria against the best (C1 vs C3, C1 vs C4, etc.)
- **Constraint**: All values must be ≥ V_ref
- **Visual feedback**: Red zone on slider for values < V_ref
- **Error handling**: 
  - Show tooltip error dynamically as slider enters red zone
  - Display: "This judgment is not consistent with [C1]-[C2]. Adjust to value > [X] (where [X] = inverse_value_function(V_ref))"
  - Tooltip disappears when slider leaves red zone
  - Comparison is NOT marked complete until value ≥ V_ref

## Phase 3: OTHERS-to-WORST Comparison (Ordinal Consistency)
**Goal**: Compare remaining criteria against worst (e.g., C3-C2, C4-C2).
**Ordinal Rule**: Respect the ranking determined in Phase 2.

### Example
If Phase 2 established: C1 > C3 > C4 > C2 (via values 0.5, 0.6 for C1-C3 and C1-C4)
- Then C3-C2 must have value ≥ V_{C3} 
- And C4-C2 must have value ≥ V_{C4}

**Implementation**:
- Compute threshold using inverse value function of the criterion being compared
- Apply same visual feedback (red zone) and error tooltip as Phase 2

## Technical Details
- **Comparison order**: Maintain current left/right order (already correct)
- **Value functions**: Already implemented in pile_bwt page (reuse from there)
- **Red zone calculation**: For current criterion C_i, compute `inverse_value_function(V_limit)` to find the data point threshold
- **Error display**: Non-intrusive tooltip above slider, appears/disappears dynamically based on slider position

