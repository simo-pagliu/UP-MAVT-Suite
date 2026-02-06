# Qualitative Indicators (QI) Page Instructions

## Overview
The Qualitative Indicators Page allows users to elicit value functions for indicators marked as "qualitative" during input. It mirrors the layout of the Value Functions page: a vertical sidebar listing qualitative indicators on the left, with the main interactive area on the right.

---

## Input Page Setup

### Qualitative Indicator Toggle
- Each indicator in the input table must have a **tickbox** to mark it as "qualitative"
- Qualitative indicators can have **empty entries** in the input table
- Qualitative indicators are **NOT elicited** on the Value Functions page
- Qualitative indicators **MUST be elicited** on this page

---

## Qualitative Indicators Page Layout

### Interface Structure
- **Left Sidebar**: List of qualitative indicators (similar to Value Functions page)
- **Right Main Column**: Interactive elicitation area (two sequential phases per indicator)
- **Navigation**: Users can switch between indicators via sidebar

---

## Phase 1: Ranking Alternatives (Tierlist)

### Initial Setup
- Display a **tierlist interface** with drag-and-drop functionality
- Create **N tiers** (where N = number of alternatives), so each alternative initially has its own tier
- Alternatives can be grouped at the same tier/rank level

### User Interaction
- **Drag-and-drop** alternatives between tiers to establish rankings
- Multiple alternatives can share the same rank/tier
- User clicks **"Next" button** to proceed to Phase 2

### Behavior on Going Back
- If user returns to ranking (from Phase 2), the tierlist resets
- The value function is **reset to default linear increasing**

---

## Phase 2: Value Function Adjustment (Sliders & Plot)

### Slider Configuration
- **One slider per rank level** (not per alternative)
  - Example: 6 alternatives with 2 at the same rank = 5 sliders
- Each slider controls the y-value (utility value) for one rank level
- Sliders are **labeled with the alternative names** grouped at that rank level

### Value Function Setup

#### Hypothetical Fixed Points
- **Hypothetical Best (Top Rank)**: y-value = **1.0** (fixed, non-draggable)
- **Hypothetical Worst (Bottom Rank)**: y-value = **0.0** (fixed, non-draggable)
- Both appear as **fixed points on the plot** (no sliders for these)

#### Initial Values
- Value function starts as a **linear increasing function** (0 → 1 by rank)
- Sliders are positioned proportionally between 0 and 1

### UI Components
1. **Sliders**: One per rank level, with alternative names labeled on the left
2. **Direction Toggle Switch**: Switch between "Increasing" and "Decreasing" value functions
3. **Plot Visualization**: Shows the value function with all points (hypothetical + ranked alternatives)

### Slider Constraints
- **Increasing function (default)**:
  - Each slider y-value ≥ y-value of the previous rank (lower rank)
  - Each slider y-value ≤ y-value of the next rank (higher rank)
  
- **Decreasing function** (after toggle):
  - Each slider y-value ≤ y-value of the previous rank
  - Each slider y-value ≥ y-value of the next rank

### Direction Toggle Behavior
- When user toggles between increasing/decreasing:
  - **Slider values are automatically inverted** (reflected around 0.5)
  - Plot updates to show the new direction
  - Constraints adjust accordingly
  - Example: increasing slider at 0.7 → decreasing slider at 0.3

### User Controls
- **Adjust sliders**: Drag sliders up/down to set utility values for each rank level
- **Toggle direction**: Switch between increasing (0→1) and decreasing (1→0) functions
- **View plot**: Real-time visualization of the value function
- **Next button**: Move to the next qualitative indicator (or finish if last one)
- **Back button**: Return to Phase 1 (ranking) - resets value function to linear increasing

---

## Multi-Indicator Workflow

- Process qualitative indicators **one at a time**
- User elicits both phases (ranking + adjustment) for each indicator
- Progress through indicators via sidebar or Next/Back buttons
- All indicators must be elicited before proceeding to the BWT page

---

## Output & Integration

### BWT Page
- **Cannot start** until all qualitative indicators have been fully elicited

### Output File
- In the Output page, users can **download two files**:
  1. **Original input file**: Unchanged from initial upload
  2. **Updated alternatives file**: Populated with elicited values for qualitative indicators
     - Includes any pre-existing data from the input file
     - Adds newly elicited utility values for each alternative on each qualitative indicator