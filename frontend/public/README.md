# UP-MAVT Local Export Bundle

This bundle is generated from the Run UP-MAVT page and is intended to run the analysis locally, without backend services or MongoDB.

The included analysis scripts are aligned with the server implementation:

- `scripts/weight_space_definition.py`
- `scripts/upmavt.py`

## Prerequisites

- Python 3.8+

## Quick Start

### 1. Create and Activate a Virtual Environment

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Run the Local Workflow

```bash
python main.py
```

The script runs an interactive 6-step workflow:

1. Compute Weights
2. Consensus Analysis
3. Dominance Analysis
4. Compensation Analysis
5. Uncertainty Analysis
6. Final Results

Outputs (CSV + plots) are written to `results/`.

## Bundle Structure

```text
.
├── main.py
├── load_LOCAL.py
├── requirements.txt
├── scripts/
│   ├── __init__.py
│   ├── upmavt.py
│   └── weight_space_definition.py
└── data/
	├── input.csv
	└── <session_name>/
		├── value_functions.csv
		├── bwt_comparisons.csv
		└── qualitative_indicators.csv
```

## Optional Arguments

```bash
python main.py --data-dir /path/to/data --output-dir /path/to/results
```

## Notes

- Session folders in `data/` can have arbitrary names.
- The script auto-detects session folders that contain expected CSV files.
