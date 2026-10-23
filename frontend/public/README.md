# UP-MAVT Local Export Bundle

This bundle is generated from the Run UP-MAVT page and is intended to run the analysis locally, without backend services or MongoDB.

The computation is the web app's own: the `scripts/` folder holds the worker's scripts, copied unchanged:

- `scripts/workflow_steps.py`: the workflow steps, exactly as the web worker runs them
- `scripts/weight_space_definition.py`
- `scripts/upmavt.py`
- `scripts/session_inputs.py`

Only loading and output differ: `load_LOCAL.py` reads the exported files where the web
app reads its database, and `main.py` asks for the run options and writes CSV files and
plots where the web app shows its pages.

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

The script runs the web app's five steps, in the same order:

1. Finalize Elicited Data (compute each session's weight space)
2. Choose Aggregation Method (compare methods, then choose the one for Steps 3-5)
3. Uncertainty Analysis
4. Consensus Analysis
5. Final Results

Every prompt defaults to what was set in the web app: the selected sessions, the
methods compared in Step 2 with their α, the method chosen for Steps 3-5, and the web
app's iteration counts. Press Enter to keep a default.

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
│   ├── weight_space_definition.py
│   └── workflow_steps.py
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
- `settings.json`: the study's settings from the web app, so a local run matches it:
  the sessions selected on the Run page in their run order (`sessions`), the
  aggregation choices of Step 2 (`aggregation`), and the weight-space settings used by
  Step 1 (model, phase 3 tolerance, advanced parameters). The weight-space settings are
  only present once weights were computed in the web app; anything missing falls back
  to the web app's defaults, and without `sessions` every session folder is used.
- `practitioner_settings.json`: the practitioner's confidence adjustments and opinion
  weight for that decision-maker.
- The per-session CSV files are semicolon-separated.

## Optional Arguments

```bash
python main.py --data-dir /path/to/data --output-dir /path/to/results
```

## Notes

- Session folders in `data/` can have arbitrary names.
- Each decision-maker's own qualitative indicator values are used in their runs, and
  the practitioner's opinion weights set how often each decision-maker is sampled in
  the pooled (NSMC) steps 2 and 5, as in the web app.
- The weight-space search is seeded, so Step 1 finds the same weights as the web app.
  The Monte Carlo steps draw new random samples on every run, here as in the web app.
