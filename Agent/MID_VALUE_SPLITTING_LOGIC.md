# Mid-Value Splitting Question Logic

## Problem Identified
The current questions reference `range.min` and `range.max` (the full criterion range), but they should reference the **thresholds** (`low` and `high`) instead.

## Current (WRONG) Logic

**Step 1 (0.5 point):**
```
At which point X is increasing {criterion} from {range.min} to X equally important 
to increasing it from X to {range.max}?
```
❌ Uses full range [range.min, range.max]

**Step 3 (0.75 point):**
```
At which point X is increasing {criterion} from X to {range.max} equally important 
to increasing it from {range.min} to X?
```
❌ Uses full range [range.min, range.max]

---

## Correct Logic Should Be

We build a piecewise linear value function by asking about **indifference points within the threshold interval [low, high]**.

**Setup:**
- `low` = lower threshold (utility = 0)
- `high` = upper threshold (utility = 1)
- Direction = increasing or decreasing

### For INCREASING direction:

**Step 1 (Find 0.5 point - call it `step1`):**
> "At which point X is equally important to improve {criterion} from **{low}** to **X** as from **X** to **{high}**?"

This finds where utility = 0.5 between the thresholds.

**Step 2 (Find 0.25 point - call it `step2`):**
> "At which point X is equally important to improve {criterion} from **{low}** to **X** as from **X** to **{step1}**?"

This finds where utility = 0.25 between low and the 0.5 point.

**Step 3 (Find 0.75 point - call it `step3`):**
> "At which point X is equally important to improve {criterion} from **{step1}** to **X** as from **X** to **{high}**?"

This finds where utility = 0.75 between the 0.5 point and high.

### For DECREASING direction:

Same structure but utility values are inverted (0.5, 0.75, 0.25 instead of 0.5, 0.25, 0.75).

---

## Key Points

1. **Always use thresholds [low, high], not range [min, max]**
   - The thresholds define the region where the function is actually meaningful
   
2. **Indifference chains:**
   - Step 1 breaks [low, high] into two equal-utility halves
   - Step 2 breaks [low, step1] in half
   - Step 3 breaks [step1, high] in half
   
3. **Which comparison interval?**
   - Each question specifies which interval to split
   - Step 2 divides: low ← → step1
   - Step 3 divides: step1 ← → high

---

## Implementation Notes

- When `skipFirst = true`, skip all steps (max utility endpoints only)
- When `skipSecond = true`, skip Step 2 (quarter-point refinement) but still get Step 1
- When `skipThird = true`, skip Step 3 (other quarter-point refinement)
- **All bounds checks must use thresholds, not range extremes**
