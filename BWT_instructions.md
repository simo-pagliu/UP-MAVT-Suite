## BWT (Best-Worst Technique) Page Structure

### Layout
- **Sidebar**: Shows all GROUPS from input
  - If more than one group: includes "Intra-Best" and "Intra-Worst" sections after all groups

- **Main Screen**: Displays evaluation interface for selected group/section

### Flow for Each Group

#### Step 1: Select Best and Worst Criteria
Present all criteria with their worst and best values. User selects:
- **Best criterion**: The first criterion you would improve to its best value if everything started at worst
- **Worst criterion**: The last criterion you would improve (the least prioritized)

#### Step 2: Evaluate Pairs
For each pair of criteria, present three plots, a slider, and navigation buttons:

**Plot 1 (Static Reference)**: 
- All criteria at their worst performance (data point that makes value function = 0)
- EXCEPT the reference criterion, which is shown at its BEST value

**Plot 2 (Adjustable Comparison)**:
- All criteria start at their worst performance
- The ADJUSTED criterion can be changed using the slider (ranges from criterion min to max)
- Shows the comparison between reference and adjusted criteria

**Plot 3 (Value Function)**:
- Shows the value function curve of the ADJUSTED criterion
- A dot on the curve moves as the user adjusts the slider, indicating the current VF value

**Slider**: 
- Range: criterion's minimum to maximum
- Saves the actual DATA_VALUE selected (e.g., 50 for a cost criterion with range 10-80)
- Plots display VF-transformed values of this data point

#### Pairs Generated (ordered)
For a group with N criteria where best = criterion B and worst = criterion W:

1. **Best-Worst pair** (1 pair):
   - Reference: W (worst), Adjusted: B (best)

2. **Best-to-Others pairs** (N-2 pairs):
   - Reference: each criterion except B and W, Adjusted: B (best)
   - User adjusts B's value to match the reference criterion's VF contribution

3. **Others-to-Worst pairs** (N-2 pairs):
   - Reference: W (worst), Adjusted: each criterion except B and W
   - User adjusts other criteria's values relative to the worst

**Total pairs per group: 1 + (N-2) + (N-2) = 2N-3**

Example: 4 criteria → 5 pairs

### Intra-Best and Intra-Worst (Multi-Group Only)

After evaluating all groups:

#### Intra-Best Section
- Presents the BEST criteria selected from each group
- User selects: best and worst among these best criteria
- Same pair evaluation logic applies

#### Intra-Worst Section
- Presents the WORST criteria selected from each group
- User selects: best and worst among these worst criteria
- Same pair evaluation logic applies

### Data Storage

Data is saved automatically to DB. CSV export format:
```
REFERENCE_CRITERION, ADJUSTED_CRITERION, DATA_VALUE, TYPE
```

**TYPE values**:
- `best` - from regular best-worst pair
- `worst` - from regular best-worst pair
- `standard` - from best-to-others or others-to-worst pairs
- `intra-best` - from intra-best section
- `intra-worst` - from intra-worst section

**DATA_VALUE**: The actual data point selected via slider (not the VF-transformed value)