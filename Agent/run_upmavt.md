# RUN UP-MAVT Page - Frontend Specifications

## Overview
The RUN UP-MAVT page allows practitioners to run multi-criteria simulations for a case study. The page uses a step-by-step workflow where Step 1 (Compute Weights) is mandatory and must complete before other steps can run.

## Session Selection Section (Top of Page)

**Display:**
- List of all sessions associated with the current case study
- Checkbox/toggle for each session showing completion status
- Count indicator: "X completed out of Y total sessions"

**Behavior:**
- Users can select only completed sessions
- If not all sessions are completed, display a warning banner at the top: "⚠️ Warning: You are using only X out of Y sessions. X sessions are incomplete."
- The session selection is fixed once: either at page load or when any step runs (TBD preference)

---

## Workflow Steps (Tab-Like Interface)

Steps are displayed as tabs/buttons at the top. Navigation rules:
- **Step 1 (Compute Weights):** Always enabled, must be completed first
- **Steps 2-6:** Disabled until weights are saved in the database
- **Within Steps 2-6:** Can be run in any order, independently
- **Concurrency:** Only one step can run at a time (one task running prevents others)

---

## Step Details

### Step 1: Compute Weights
**Description:** Compute and save weight distribution from elicitation sessions.

**Outputs:**
- One vertical bar plot (weights visualization)
- One horizontal bar plot (same data, different orientation)

**UI Elements:**
- "Compute & Save Weights" button (runs simulation)
  - While running: Button becomes disabled, "Stop" button appears
  - On completion: Weights saved to DB, Steps 2-6 become enabled
- Stop button (appears only during execution)
- "View Console Output" button → opens scrollable console panel below plots

**For Initial Implementation:**
- Add a dummy "Save Dummy Weights to DB" button for testing
- Once clicked, mark weights as saved in DB state
- This enables all other steps

---

### Step 2: Consensus
**Description:** Run SMC (Strict Monte Carlo) with aggregation method. Default is SUM.

**Parameters:**
- Aggregation method dropdown: SUM (default), GEO, HAR

**Outputs:**
- Multiple distribution plots (histograms)

**UI Elements:**
- Aggregation method selector
- "Run Consensus" button
  - While running: disabled, Stop button appears
  - On completion: save results to DB
- Stop button (appears only during execution)
- "View Console Output" button → opens scrollable console panel

**Disable Condition:** Cannot run if weights not in DB, or if another step is running

---

### Step 3: Dominance
**Description:** Run NSMC (Non-Strict Monte Carlo) with random weights. Default aggregation is SUM.

**Parameters:**
- Aggregation method dropdown: SUM (default), GEO, HAR

**Outputs:**
- One heatmap

**UI Elements:**
- Aggregation method selector
- "Run Dominance" button
  - While running: disabled, Stop button appears
  - On completion: save results to DB
- Stop button (appears only during execution)
- "View Console Output" button → opens scrollable console panel

**Disable Condition:** Cannot run if weights not in DB, or if another step is running

---

### Step 4: Compensation
**Description:** Run NSMC with three fixed aggregation methods sequentially (SUM, GEO, HAR). No user parameters.

**Outputs:**
- Three heatmaps (one for each aggregation method: SUM, GEO, HAR)

**UI Elements:**
- "Run Compensation" button
  - While running: disabled, Stop button appears
  - On completion: save all three results to DB
- Stop button (appears only during execution)
- "View Console Output" button → opens scrollable console panel

**Disable Condition:** Cannot run if weights not in DB, or if another step is running

---

### Step 5: Uncertainty
**Description:** Run SMC with user-selected aggregation method. No default.

**Parameters:**
- Aggregation method dropdown: SUM, GEO, HAR (user must select, no default)

**Outputs:**
- Multiple distribution plots (histograms, same style as Step 2)

**UI Elements:**
- Aggregation method selector (required before running)
- "Run Uncertainty" button (disabled until aggregation selected)
  - While running: disabled, Stop button appears
  - On completion: save results to DB
- Stop button (appears only during execution)
- "View Console Output" button → opens scrollable console panel

**Disable Condition:** Cannot run if weights not in DB, or if another step is running

---

### Step 6: Results
**Description:** Run NSMC with user-selected aggregation method. User must select.

**Parameters:**
- Aggregation method dropdown: SUM, GEO, HAR (user must select, no default)

**Outputs:**
- One heatmap

**UI Elements:**
- Aggregation method selector (required before running)
- "Run Results" button (disabled until aggregation selected)
  - While running: disabled, Stop button appears
  - On completion: save results to DB
- Stop button (appears only during execution)
- "View Console Output" button → opens scrollable console panel

**Disable Condition:** Cannot run if weights not in DB, or if another step is running

---

## Console Output Panel

**Behavior:**
- Opens/closes via "View Console Output" button
- Displays in full width below the plots
- Shows real-time output from Python script execution
- Scrollable (fixed height, overflow scrolls)
- Clears when a new step runs, or has a "Clear" button

---

## Implementation Notes

1. **For Initial Development:** No actual simulations needed. Focus on UI structure, state management, and database schema.
2. **Disable Logic:** Steps 2-6 should be visually disabled (grayed out, non-clickable) with a tooltip explaining "Compute weights first."
3. **Running State:** Track which step (if any) is currently running; disable all other steps while running.
4. **Output Saving:** Each step must save its outputs to DB upon completion (even if dummy data for now).
5. **Plots:** Start with non-interactive (static) visualizations.