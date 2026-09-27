# UP-MAVT Local Export Bundle

This bundle is generated from the Run UP-MAVT page and is intended to run the analysis locally, without backend services or MongoDB.

The included analysis scripts are aligned with the server implementation:

- `scripts/weight_space_definition.py`
- `scripts/upmavt.py`
- `scripts/session_inputs.py`

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
│   ├── session_inputs.py
│   ├── upmavt.py
│   └── weight_space_definition.py
└── data/
	├── input.csv
	├── settings.json
	└── <session_name>/
		├── value_functions.csv
		├── bwt_comparisons.csv
		├── qualitative_indicators.csv
		└── practitioner_settings.json
```

- `input.csv`: the decision matrix. The `is_qi` row marks qualitative criteria; their
  cells are empty because each session's `qualitative_indicators.csv` fills them in.
- `settings.json`: the weight-space settings the study used in the web app (model,
  phase 3 tolerance, advanced parameters). Step 1 uses them, so local weights match
  the web app's. Only present once weights were computed in the web app; otherwise
  the web app's defaults are used.
- `practitioner_settings.json`: the practitioner's confidence adjustments and opinion
  weight for that decision-maker.
- The per-session CSV files are semicolon-separated.

## Optional Arguments

```bash
python main.py --data-dir /path/to/data --output-dir /path/to/results
```

## Notes

- Session folders in `data/` can have arbitrary names.
- The script auto-detects session folders that contain expected CSV files.
- Each decision-maker's own qualitative indicator values are used in their runs, and
  the practitioner's opinion weights set how often each decision-maker is sampled in
  the non-strict steps (3, 4 and 6), as in the web app.
