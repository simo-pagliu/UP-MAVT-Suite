# UP-MAVT Local Standalone

Standalone implementation of **UP-MAVT (Uncertainty Propagated - Multi-Attribute Value Theory)** for robust multi-criteria decision analysis without requiring a server or database.

## Prerequisites

- **Python** 3.8 or higher - [Download here](https://www.python.org/downloads/)

## Quick Start

### 1. Create and Activate Virtual Environment

```bash
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Run the Analysis

```bash
python scripts/main.py
```

The script uses example data from the `data/` directory and will guide you through 6 analysis steps:
1. **Compute Weights** - Generate feasible weight solutions from expert comparisons
2. **Consensus Analysis** - Evaluate alternatives under consensus (strict Monte Carlo)
3. **Dominance Analysis** - Identify dominated alternatives (non-strict MC with random weights)
4. **Compensation Analysis** - Test different aggregation methods (SUM, GEO, HAR)
5. **Uncertainty Analysis** - Quantify decision uncertainty (strict MC)
6. **Final Results** - Compute aggregate scores with confidence intervals

Results and plots are saved to the `results/` directory.

## Data Structure

Example data is provided in `data/`:

```
data/
├── input.csv                        # Criteria and alternatives
├── elicitation_1/                   # Expert 1 data
│   ├── value_functions.csv          # Criterion value functions
│   ├── bwt_comparisons.csv          # Criterion weight comparisons
│   └── qualitative_indicators.csv   # Qualitative preferences
└── elicitation_2/                   # Expert 2 data (same structure)
```

### Key Files

- **input.csv**: Defines alternatives and their criterion values
- **value_functions.csv**: Maps raw criterion values to normalized scores (0-1)
- **bwt_comparisons.csv**: Best-Worst Scaling comparisons between criteria for weight elicitation
- **qualitative_indicators.csv**: Optional qualitative rankings

## Output Files

Results are saved to `results/`:

- `step1_weight_solutions.csv` + `step1_weight_space_*.png` - Feasible weights per expert
- `step2_consensus_results.csv` + `step2_distribution_*.png` - Consensus analysis
- `step3_dominance_results.csv` + `step3_dominance_heatmap.png` - Dominance analysis
- `step4_compensation_*.csv` + `step4_*_heatmap.png` - Compensation analysis  
- `step5_uncertainty_results.csv` + `step5_distribution_*.png` - Uncertainty analysis
- `step6_final_results.csv` + `step6_final_heatmap.png` - Final results

## Advanced Usage

```bash
# Custom data/output directories
python scripts/main.py --data-dir /path/to/data --output-dir /path/to/results
```

## Requirements

- Python 3.8+
- numpy, scipy, pandas, matplotlib

---

**Author**: Simone Pagliuca  
**Version**: 1.0
