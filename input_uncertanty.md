INPUT DATA MODIFICATIONS

## 1. QUALITATIVE CRITERIA HANDLING
- If a criterion is marked as qualitative, gray out and disable all input cells for that criterion
- Keep those cells empty (values will be determined in the QI page instead)
- Remove current implementation for qualitative data input from the Input page

## 2. UNCERTAINTY SUPPORT (for non-qualitative data only)
Support the following distribution types:
- **Certain value** (single non-uncertain value)
- **Gaussian distribution** (with mean and standard deviation)
- **±Error (Uniform)** - symmetric absolute error range
- **±%Error (Uniform)** - symmetric percentage error
- **Discrete distribution** - e.g., {x, y, z} with equal probability for each value
- **Histogram-like distribution** - ranges with probabilities, e.g., (3-4: 15%, 4-6: 32%)
- **Trapezoid/Triangle distribution** - defined by min, peak_start, peak_end, max, with auto-normalized height

**IMPORTANT:** Distribution type is CELL-DEPENDENT, not criterion-dependent. The same criterion can have different distribution types across different alternatives.

## 3. CSV FORMAT FOR UNCERTAINTY
Proposed human-readable format (append to each cell value):
- Certain: `1000`
- Gaussian: `N(1000, 100)` (Gaussian with mean=1000, std=100)
- ±Error: `1000 ± 100` (value ± absolute error)
- ±%Error: `1000 ± 5%` (value ± percentage)
- Discrete: `{low, mid, high}` or `{900, 1000, 1100}` (equal probability for each)
- Histogram: `(3-4: 15%, 4-6: 32%)` (range: probability pairs)
- Trapezoid: `TRAP(min, peak_start, peak_end, max, base_prob)` (e.g., `TRAP(100, 200, 300, 400, 0)` for trapezoid, or `TRAP(100, 250, 250, 400, 0)` for triangle)

Example extended CSV format:
```
Alternative,Cost,Power,GHG
Group,Technoeconomic,Technoeconomic,Environmental
Description,Total capital investment cost,Installed electrical capacity,Lifecycle greenhouse gas emissions
Nuclear,N(1000, 50),1000 ± 100,6
Solar,50 ± 5%,{45, 50, 55},20 ± 2
Gas,TRAP(20, 25, 30, 35, 0),300 ± 15%,50
Coal,10,100,300
Unit,EUR,MWe,gCO2eq/kWh
```

## 4. UI IMPLEMENTATION APPROACH
Instead of a plain value field:
- Show an icon representing the distribution type next to each cell value
- Clicking the icon opens a modal dialog with:
  - Distribution type selector (dropdown to switch types)
  - Distribution parameters (input fields based on type)
  - Visual plot/preview of the distribution
  - Ability to save/apply changes
- Display the current value/distribution summary in the cell

## 5. CSV IMPORT/EXPORT
- **Export:** Convert all cell values with their uncertainty to the proposed format
- **Import:** Parse the format and reconstruct uncertainty information for each cell
- Must preserve distribution type and parameters during round-trip (export → import)

## 6. MIN/MAX RANGE COMPUTATION
- Automatically compute min/max bounds for each cell's distribution
- Used for: Value Functions (X-axis ranges), BWT (numerical ranges)
- Computation rules:
  - **Certain/Single value:** min = max = value
  - **Gaussian:** min/max = mean ± (1.96 × σ) for 98% confidence interval
  - **±Error/±%Error:** min/max = value ± error/percentage
  - **Discrete:** min = smallest value, max = largest value
  - **Histogram:** min = lowest range start, max = highest range end