#!/usr/bin/env python3
"""
Load data from local CSV files for UPMAVT analysis.

This module provides functions to extract data from CSV files and format it
for use by the core analysis modules (upmavt.py, weight_space_definition.py).

The key principle: these functions read the files of a Suite export into the
same session-shaped dictionaries the web worker loads from MongoDB, then build
the engine inputs with the worker's own code (scripts/session_inputs.py), so an
offline run uses exactly the same data preparation as the web app.
"""

import os
import csv
import json

from scripts.session_inputs import (
    build_alternatives_with_qualitative,
    build_comparisons_from_session,
    build_value_functions_from_session,
    compute_opinion_weights,
)


# Label-column values of input.csv rows that describe criteria instead of an
# alternative (the same rows the web app's input CSV uses).
_INPUT_METADATA_LABELS = {'group', 'unit', 'description', 'is_qi', 'vf_method', 'min', 'max'}
_TRUE_VALUES = {'true', '1', 'yes', 'y'}

# Weight-space settings used when the export has no settings file (web app defaults).
DEFAULT_ANALYSIS_SETTINGS = {
    'use_non_linear_model': True,
    'phase3_tolerance_pct': 1.0,
    'weight_space_parameters': {},
}


def _read_csv_rows(filepath):
    """Read a CSV file into (fieldnames, list of dict rows).

    Suite exports are semicolon-separated while hand-made files are often
    comma-separated, so the delimiter is taken from the header line.
    """
    with open(filepath, 'r', encoding='utf-8-sig', newline='') as f:
        header = f.readline()
        f.seek(0)
        delimiter = ';' if header.count(';') > header.count(',') else ','
        reader = csv.DictReader(f, delimiter=delimiter)
        rows = list(reader)
        return reader.fieldnames or [], rows


def _load_json(filepath):
    """Load a JSON file, or return None when it is missing or unreadable."""
    if not os.path.exists(filepath):
        return None
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _get_row_value(row, *keys, default=''):
    """Get a CSV row value by key, case-insensitive."""
    if not isinstance(row, dict):
        return default

    for key in keys:
        if key in row:
            return row.get(key, default)

    lowered = {str(k).strip().lower(): v for k, v in row.items()}
    for key in keys:
        val = lowered.get(str(key).strip().lower())
        if val is not None:
            return val

    return default


def _parse_confidence_value(raw, default=4):
    """Parse confidence that may be scalar (e.g. 3) or list-like (e.g. '3,3,3')."""
    if raw is None:
        return default

    text = str(raw).strip().strip('"').strip("'")
    if not text:
        return default

    try:
        return int(float(text))
    except ValueError:
        parts = [p.strip() for p in text.split(',') if p.strip()]
        if parts:
            try:
                return int(float(parts[0]))
            except ValueError:
                return default
    return default


def _parse_points_string(points_raw):
    """Parse LIST OF POINTS format: 'x1:y1;x2:y2;...' -> [{'x':..,'y':..}, ...]."""
    points = []
    if points_raw is None:
        return points

    text = str(points_raw).strip().strip('"').strip("'")
    if not text:
        return points

    for token in text.split(';'):
        item = token.strip()
        if not item or ':' not in item:
            continue
        x_raw, y_raw = item.split(':', 1)
        try:
            points.append({'x': float(x_raw), 'y': float(y_raw)})
        except ValueError:
            continue

    return points


def load_input_data(data_dir):
    """Load criteria and alternatives from input.csv.

    The first column holds alternative names. Rows labelled Group, Unit,
    Description, is_qi, vf_method, Min or Max describe the criteria; the
    ``is_qi`` row (TRUE/FALSE) marks qualitative criteria. Exports without an
    ``is_qi`` row treat a criterion as qualitative when the sessions ranked it
    in qualitative_indicators.csv.

    Parameters
    ----------
    data_dir : str
        Path to data directory containing input.csv.

    Returns
    -------
    dict
        {
            'criteria': [list of criterion dicts],
            'alternatives': {alt_name: {crit_name: value_str, ...}, ...},
            'criteria_names': [list of criterion names]
        }

    Raises
    ------
    FileNotFoundError
        If input.csv not found.
    """
    input_csv = os.path.join(data_dir, 'input.csv')

    if not os.path.exists(input_csv):
        raise FileNotFoundError(f"input.csv not found in {data_dir}")

    fieldnames, rows = _read_csv_rows(input_csv)

    if not rows:
        raise ValueError("input.csv is empty")

    label_key = next(
        (name for name in fieldnames if str(name).strip().lower() == 'alternative'),
        fieldnames[0],
    )
    criteria_names = [
        name for name in fieldnames
        if name and name != label_key and str(name).strip().lower() not in _INPUT_METADATA_LABELS
    ]

    alternatives = {}
    metadata_rows = {}
    for row in rows:
        label = str(row.get(label_key) or '').strip()
        if not label:
            continue
        if label.lower() in _INPUT_METADATA_LABELS:
            metadata_rows[label.lower()] = row
            continue
        if label not in alternatives:
            alternatives[label] = {}
        for crit_name in criteria_names:
            value = row.get(crit_name, '')
            alternatives[label][crit_name] = str(value) if value else ''

    is_qi_row = metadata_rows.get('is_qi')
    if is_qi_row is not None:
        qualitative_names = {
            name for name in criteria_names
            if str(is_qi_row.get(name) or '').strip().lower() in _TRUE_VALUES
        }
    else:
        qualitative_names = _infer_qualitative_criteria(data_dir)

    criteria = []
    for crit_name in criteria_names:
        criterion = {
            'criterion_name': crit_name,
            'is_qualitative': crit_name in qualitative_names,
            'alternatives': [
                {'name': alt_name, 'value': alternatives[alt_name].get(crit_name, '')}
                for alt_name in alternatives.keys()
            ],
        }
        for label in ('group', 'unit', 'description'):
            if label in metadata_rows:
                criterion[label] = str(metadata_rows[label].get(crit_name) or '')
        criteria.append(criterion)

    return {
        'criteria': criteria,
        'alternatives': alternatives,
        'criteria_names': criteria_names,
    }


def _infer_qualitative_criteria(data_dir):
    """Names of criteria that any session ranked in qualitative_indicators.csv."""
    names = set()
    for session_name in list_sessions(data_dir):
        qi_path = os.path.join(data_dir, session_name, 'qualitative_indicators.csv')
        if not os.path.exists(qi_path):
            continue
        for crit_name, qi_data in _load_qualitative_indicators_csv(qi_path).items():
            if qi_data.get('ranking'):
                names.add(crit_name)
    return names


def load_session_data(data_dir, session_name):
    """Load elicitation session data from CSV files.

    Parameters
    ----------
    data_dir : str
        Path to data directory containing elicitation subdirectories.
    session_name : str
        Name of the session/elicitation (e.g., 'elicitation_1').

    Returns
    -------
    dict
        Session document structure expected by core modules:
        {
            '_id': session_name,
            'name': session_name,
            'value_functions': {...},
            'qualitative_indicators': {...},
            'bwt': {...},
            'practitioner_settings': {...}
        }

    Raises
    ------
    FileNotFoundError
        If session directory or required files not found.
    """
    session_dir = os.path.join(data_dir, session_name)

    if not os.path.isdir(session_dir):
        raise FileNotFoundError(f"Session directory {session_name} not found in {data_dir}")

    session_doc = {
        '_id': session_name,
        'name': session_name,
        'value_functions': None,
        'qualitative_indicators': None,
        'bwt': None,
        'practitioner_settings': None,
    }

    # Load value functions
    vf_file = os.path.join(session_dir, 'value_functions.csv')
    if os.path.exists(vf_file):
        session_doc['value_functions'] = _load_value_functions_csv(vf_file)

    # Load qualitative indicators
    qi_file = os.path.join(session_dir, 'qualitative_indicators.csv')
    if os.path.exists(qi_file):
        session_doc['qualitative_indicators'] = _load_qualitative_indicators_csv(qi_file)

    # Load BWT comparisons
    bwt_file = os.path.join(session_dir, 'bwt_comparisons.csv')
    if os.path.exists(bwt_file):
        session_doc['bwt'] = _load_bwt_csv(bwt_file)

    # Load the practitioner's confidence adjustments and opinion weight
    session_doc['practitioner_settings'] = load_practitioner_settings(data_dir, session_name)

    return session_doc


def load_practitioner_settings(data_dir, session_name):
    """Load practitioner_settings.json of a session (None when absent)."""
    settings = _load_json(os.path.join(data_dir, session_name, 'practitioner_settings.json'))
    return settings if isinstance(settings, dict) else None


def load_analysis_settings(data_dir):
    """Load the weight-space settings the study used in the web app.

    Reads data/settings.json (written by the export); if it is missing, falls
    back to weights/computed_weights.json next to the data directory. Missing
    values use the web app's defaults.

    Returns
    -------
    dict
        {'use_non_linear_model': bool, 'phase3_tolerance_pct': float,
         'weight_space_parameters': dict}
    """
    settings = dict(DEFAULT_ANALYSIS_SETTINGS)
    loaded = _load_json(os.path.join(data_dir, 'settings.json'))
    if not isinstance(loaded, dict):
        loaded = _load_json(os.path.join(os.path.dirname(os.path.abspath(data_dir)), 'weights', 'computed_weights.json'))
    if not isinstance(loaded, dict):
        return settings

    if 'use_non_linear_model' in loaded:
        settings['use_non_linear_model'] = bool(loaded['use_non_linear_model'])
    try:
        settings['phase3_tolerance_pct'] = max(0.0, float(loaded.get('phase3_tolerance_pct', 1.0)))
    except (TypeError, ValueError):
        pass
    parameters = loaded.get('weight_space_parameters')
    if isinstance(parameters, dict):
        settings['weight_space_parameters'] = parameters
    return settings


def compute_opinion_weights_from_csv(data_dir, session_names):
    """NSMC opinion weights for the sessions, in the given order (None = equal)."""
    return compute_opinion_weights(
        [load_practitioner_settings(data_dir, session_name) for session_name in session_names]
    )


def _load_value_functions_csv(filepath):
    """Parse value_functions.csv into the expected structure.

    Expected CSV columns: criterion_name, x, y, confidence

    Returns structure:
    {
        'criteria': {
            'criterion_name': {
                'points': [{'x': float, 'y': float}, ...],
                'confidence': int
            },
            ...
        }
    }
    """
    criteria = {}

    fieldnames, rows = _read_csv_rows(filepath)
    fieldnames_lower = {str(name).strip().lower() for name in fieldnames if name}

    has_compact_points = 'list of points' in fieldnames_lower or 'list_of_points' in fieldnames_lower

    for row in rows:
        crit_name = _get_row_value(row, 'criterion_name', 'CRITERION_NAME').strip()
        if not crit_name:
            continue

        if crit_name not in criteria:
            criteria[crit_name] = {
                'points': [],
                'confidence': _parse_confidence_value(
                    _get_row_value(row, 'confidence', 'CONFIDENCE', default=4),
                    default=4,
                ),
            }
        else:
            confidence_raw = _get_row_value(row, 'confidence', 'CONFIDENCE', default='')
            if str(confidence_raw).strip():
                criteria[crit_name]['confidence'] = _parse_confidence_value(confidence_raw, default=4)

        if has_compact_points:
            points_raw = _get_row_value(
                row,
                'LIST OF POINTS',
                'list of points',
                'list_of_points',
                'points',
                'POINTS',
            )
            criteria[crit_name]['points'].extend(_parse_points_string(points_raw))
        else:
            x_raw = _get_row_value(row, 'x', 'X')
            y_raw = _get_row_value(row, 'y', 'Y')
            try:
                criteria[crit_name]['points'].append({'x': float(x_raw), 'y': float(y_raw)})
            except (TypeError, ValueError):
                continue

    for cfg in criteria.values():
        cfg['points'] = sorted(cfg.get('points', []), key=lambda p: p.get('x', 0))

    return {'criteria': criteria}


def _load_qualitative_indicators_csv(filepath):
    """Parse qualitative_indicators.csv into the expected structure.

    Expected CSV columns: criterion_name, alternative, rank, value, confidence

    Returns structure:
    {
        'criterion_name': {
            'ranking': {alternative: rank, ...},
            'values': {rank: value, ...},
            'confidences': {rank: confidence, ...}
        },
        ...
    }
    """
    qi = {}

    _, rows = _read_csv_rows(filepath)
    for row in rows:
        crit_name = _get_row_value(row, 'criterion_name', 'CRITERION_NAME').strip()
        if not crit_name:
            continue

        if crit_name not in qi:
            qi[crit_name] = {
                'ranking': {},
                'values': {},
                'confidences': {}
            }

        alt_name = _get_row_value(row, 'alternative', 'ALTERNATIVE').strip()
        rank_raw = _get_row_value(row, 'rank', 'RANK')
        value_raw = _get_row_value(row, 'value', 'VALUE')
        conf_raw = _get_row_value(row, 'confidence', 'CONFIDENCE', default=4)

        if not alt_name or str(rank_raw).strip() == '':
            continue

        try:
            rank = int(float(rank_raw))
        except (TypeError, ValueError):
            continue

        try:
            value = float(value_raw) if str(value_raw).strip() else 0.0
        except (TypeError, ValueError):
            value = 0.0

        qi[crit_name]['ranking'][alt_name] = rank
        qi[crit_name]['values'][str(rank)] = value
        qi[crit_name]['confidences'][str(rank)] = _parse_confidence_value(conf_raw, default=4)

    return qi


def _load_bwt_csv(filepath):
    """Parse bwt_comparisons.csv into the expected structure.

    Expected CSV columns: type, reference_criterion, adjusted_criterion,
                          data_value, group, confidence, a

    Returns structure:
    {
        'comparisons': [
            {
                'type': str,
                'reference_criterion': str,
                'adjusted_criterion': str,
                'data_value': float,
                'group': str,
                'confidence': int,
                'a': float
            },
            ...
        ]
    }
    """
    comparisons = []

    _, rows = _read_csv_rows(filepath)
    for row in rows:
        data_value_raw = _get_row_value(row, 'data_value', 'DATA_VALUE', default=0)
        confidence_raw = _get_row_value(row, 'confidence', 'CONFIDENCE', default=3)
        a_raw = _get_row_value(row, 'a', 'A', default=1.0)

        try:
            data_value = float(data_value_raw) if str(data_value_raw).strip() else 0.0
        except (TypeError, ValueError):
            data_value = 0.0

        try:
            a_value = float(a_raw) if str(a_raw).strip() else 1.0
        except (TypeError, ValueError):
            a_value = 1.0

        comparison = {
            'type': _get_row_value(row, 'type', 'TYPE').strip(),
            'reference_criterion': _get_row_value(row, 'reference_criterion', 'REFERENCE_CRITERION').strip(),
            'adjusted_criterion': _get_row_value(row, 'adjusted_criterion', 'ADJUSTED_CRITERION').strip(),
            'data_value': data_value,
            'group': _get_row_value(row, 'group', 'GROUP').strip(),
            'confidence': _parse_confidence_value(confidence_raw, default=3),
            'a': a_value,
        }
        comparisons.append(comparison)

    return {'comparisons': comparisons}


def load_computed_weights(weights_csv_path):
    """Load pre-computed weight solutions from CSV file.

    Parameters
    ----------
    weights_csv_path : str
        Path to weight_solutions.csv.

    Returns
    -------
    dict
        {
            'weight_solutions': {session_id: [list of weight dicts], ...},
        }

    Raises
    ------
    FileNotFoundError
        If weights file not found.
    """
    if not os.path.exists(weights_csv_path):
        raise FileNotFoundError(f"Weight solutions file not found: {weights_csv_path}")

    weight_solutions = {}

    fieldnames, rows = _read_csv_rows(weights_csv_path)
    has_session_id = any(str(name).strip().lower() == 'session_id' for name in fieldnames if name)

    for row in rows:
        session_id = _get_row_value(row, 'session_id', 'SESSION_ID', default='').strip()
        if not session_id and not has_session_id:
            session_id = 'elicitation_1'
        if not session_id:
            continue

        if session_id not in weight_solutions:
            weight_solutions[session_id] = []

        # Build weight dict from remaining columns (criterion names)
        weight_dict = {}
        for key, value in row.items():
            key_lower = str(key).strip().lower()
            if key_lower in {'session_id', 'solution_index'}:
                continue
            if not value:
                continue
            try:
                weight_dict[key] = float(value)
            except ValueError:
                continue

        if weight_dict:
            weight_solutions[session_id].append(weight_dict)

    return {'weight_solutions': weight_solutions}


def save_weight_solutions_csv(output_path, weight_solutions_dict, session_ids=None):
    """Save weight solutions to CSV file.

    Parameters
    ----------
    output_path : str
        Path to write weight_solutions.csv.
    weight_solutions_dict : dict
        {session_id: [list of weight dicts], ...}
    session_ids : list or None
        If provided, only save these sessions. Otherwise save all.

    Returns
    -------
    None
    """
    # Collect all criterion names
    all_criteria = set()
    for session_id, solutions in weight_solutions_dict.items():
        for solution in solutions:
            all_criteria.update(solution.keys())

    criteria_list = sorted(list(all_criteria))

    # Build rows
    rows = []
    for session_id, solutions in weight_solutions_dict.items():
        if session_ids and session_id not in session_ids:
            continue

        for solution in solutions:
            row = {'session_id': session_id}
            for crit in criteria_list:
                row[crit] = solution.get(crit, 0)
            rows.append(row)

    # Write CSV
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        fieldnames = ['session_id'] + criteria_list
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def list_sessions(data_dir):
    """List all available elicitation sessions in data directory.

    Parameters
    ----------
    data_dir : str
        Path to data directory.

    Returns
    -------
    list[str]
        List of session directory names (e.g., ['elicitation_1', 'elicitation_2']).
    """
    if not os.path.isdir(data_dir):
        return []

    sessions = []
    for item in os.listdir(data_dir):
        item_path = os.path.join(data_dir, item)
        if not os.path.isdir(item_path):
            continue

        # Accept any session directory that has at least one expected data file.
        expected_files = {
            'value_functions.csv',
            'bwt_comparisons.csv',
            'qualitative_indicators.csv',
        }
        present = set(os.listdir(item_path)) if os.path.isdir(item_path) else set()
        if expected_files.intersection(present):
            sessions.append(item)

    return sorted(sessions)

# ============================================================================
# HELPER FUNCTIONS FOR DATA EXTRACTION & PROCESSING
# (thin wrappers: load the session files, then use the worker's builders)
# ============================================================================

def build_value_functions_from_csv(data_dir, session_name, criteria, return_confidence=False):
    """Build value function dicts from CSV files.

    Parameters
    ----------
    data_dir : str
        Path to data directory.
    session_name : str
        Elicitation session name (e.g., 'elicitation_1').
    criteria : list[dict]
        Criteria list from input document.
    return_confidence : bool
        If True, also return confidence dict (with the practitioner's
        confidence adjustments applied).

    Returns
    -------
    dict or tuple
        If return_confidence=False:
            Mapping criterion_name -> piecewise-linear callable
        If return_confidence=True:
            (vf_dict, confidence_dict)
    """
    session_doc = load_session_data(data_dir, session_name)
    return build_value_functions_from_session(session_doc, criteria, return_confidence=return_confidence)


def build_comparisons_from_csv(data_dir, session_name):
    """Extract and format comparisons from CSV BWT file.

    Parameters
    ----------
    data_dir : str
        Path to data directory.
    session_name : str
        Elicitation session name (e.g., 'elicitation_1').

    Returns
    -------
    list[dict]
        List of comparison records with standard format.
    """
    session_doc = load_session_data(data_dir, session_name)
    return build_comparisons_from_session(session_doc)


def build_alternatives_from_csv(data_dir, session_name=None):
    """Build the decision matrix (alternatives dict) from the CSV files.

    Parameters
    ----------
    data_dir : str
        Path to data directory.
    session_name : str or None
        Session whose qualitative indicators (and practitioner confidence
        adjustments) fill the qualitative columns. Each decision-maker ranked
        the qualitative criteria separately, so build one matrix per session.
        Without a session the qualitative entries stay empty.

    Returns
    -------
    tuple
        (alternatives_dict, criteria_names_list)
    """
    input_data = load_input_data(data_dir)
    input_doc = {'criteria': input_data.get('criteria', [])}

    if not session_name:
        return build_alternatives_with_qualitative(input_doc)

    session_doc = load_session_data(data_dir, session_name)
    return build_alternatives_with_qualitative(
        input_doc,
        session_doc.get('qualitative_indicators'),
        session_doc.get('practitioner_settings'),
    )
