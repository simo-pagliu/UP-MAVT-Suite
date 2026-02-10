# Consistency Checking Implementation Summary

## Overview
Successfully implemented consistency checking for the PILE-BWT page as per the requirements in `consistency_checking.md`.

## Changes Made to PileBwtPage.jsx

### 1. State Variables Added
Three new state variables for tracking consistency:
- `bestToWorstValue`: Stores the value function value from the first BEST-to-WORST comparison
- `consistencyConstraints`: Dictionary for tracking phase-specific constraints
- `isConsistencyError`: Boolean flag indicating if current slider position violates consistency

### 2. Helper Functions Implemented

#### `inverseValueFunction(criterionName, targetY)`
- Finds the data value (x) that corresponds to a given value function value (y)
- Uses linear interpolation between value function points
- Returns the data value where the criterion achieves the target value

#### `getConsistencyThreshold(pairIndex, comps)`
- Calculates the minimum required value function value for the current pair
- **For BEST-to-OTHERS (Phase 2)**: Returns `bestToWorstValue` as the minimum threshold
- **For OTHERS-to-WORST (Phase 3)**: Finds the BEST-to-adjusted comparison and returns its value as the threshold
- **For BEST-to-WORST (Phase 1)**: Returns null (no constraint)

#### `checkConsistency(pairIndex, dataValue, comps)`
- Checks if the current slider value meets consistency requirements
- Returns: `{ isConsistent, threshold, thresholdDataValue }`
- Used to validate before moving to next pair/group

### 3. Modified Functions

#### `handleNextPair()`
- Added consistency check before preceding to next pair
- Captures BEST-to-WORST value when completing first comparison
- Shows error toast if judgment violates consistency
- Resets consistency error flag after successful save

#### `handlePrevPair()`
- Added consistency check before going back
- Prevents regression with invalid comparisons

#### Group Navigation
- `handleResetGroup()`: Resets `bestToWorstValue` and consistency constraints when group is reset
- `handleCriteriaMismatchReset()`: Clears all consistency tracking on BWT reset
- Next/Complete button in the main render: Resets consistency tracking when moving to next group

### 4. Dynamic Consistency Checking

#### Auto-check on Slider Movement
- Updated `useEffect` for `sliderValue` changes to dynamically check consistency
- `isConsistencyError` state updates as user moves slider
- Error appears when violating constraint, disappears when corrected

#### Button State Management
- Next button disabled when: `!sliderTouched || isConsistencyError`
- Cannot proceed with inconsistent comparisons

### 5. UI Enhancements

#### Error Tooltip
- Non-intrusive error box appears above slider when inconsistent
- Displays contextual message based on phase:
  - **Phase 2 (BEST-to-OTHERS)**: "Must adjust [criterion] to at least [value] to be consistent with [BEST]-[WORST] comparison"
  - **Phase 3 (OTHERS-to-WORST)**: "Must adjust [criterion] to at least [value] to maintain consistency with previous comparisons"
- Disappears automatically when user corrects the value

#### Visual Feedback on Slider
- Slider filled track changes color to red when inconsistent
- Red zone indicator shows the forbidden region
- Dynamic: responds immediately to slider movement

## Flow Overview

### Phase 1: BEST-to-WORST Comparison
1. User selects best and worst criteria
2. Makes first pairwise comparison
3. Comparison must be valid (no prior constraints)
4. When moving to next pair, `bestToWorstValue` is captured

### Phase 2: BEST-to-OTHERS Comparison
1. Each comparison has constraint: value ≥ `bestToWorstValue`
2. Red zone appears for values < threshold
3. Error tooltip shows threshold data value
4. User must adjust slider into valid region to proceed

### Phase 3: OTHERS-to-WORST Comparison
1. Each comparison has constraint based on the Phase 2 value of the adjusted criterion
2. Order is maintained: comparisons presented to ensure "greater than" constraints
3. Same visual feedback and error handling as Phase 2

## Testing Recommendations
1. Verify red zone appears when slider enters invalid region
2. Confirm error tooltip demonstrates with proper criterion names
3. Test that Next button is disabled with inconsistency error
4. Verify tooltip disappears when user corrects the value
5. Check that resetting group clears consistency tracking
6. Confirm switching groups resets `bestToWorstValue`

## Edge Cases Handled
- Floating-point arithmetic: Uses epsilon (1e-10) for comparisons
- Flat VF segments: Handles zero-slope interpolation
- Qualitative criteria: Works with value functions in [0,1] range
- Group transitions: Resets consistency constraints for new groups
