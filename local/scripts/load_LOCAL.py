#!/usr/bin/env python3
"""
Load data from local CSV files for UPMAVT analysis.

This module provides functions to extract data from CSV files and format it
for use by the core analysis modules (upmavt.py, weight_space_definition.py).

The key principle: these functions normalize CSV structures into the same
standardized Python dictionaries/lists that load_DB.py produces, ensuring
seamless drop-in replacement.
"""

import os
import csv
import json
from pathlib import Path


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
    
    criteria = []
    alternatives = {}
    criteria_names = []
    
    with open(input_csv, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    
    if not rows:
        raise ValueError("input.csv is empty")
    
    # First row has the structure: Alternative, Criterion1, Criterion2, ...
    # and metadata rows follow
    # Assuming first column is criterion data, rest are alternatives
    # This is a simplified parser - adjust based on actual input.csv structure
    
    # For now, parse the header row to identify criteria
    headers = rows[0].keys()
    
    # Skip 'Alternative' and metadata columns, extract criteria names
    for header in headers:
        if header.lower() not in ['alternative', 'group', 'unit', 'description']:
            if header:  # Non-empty header
                criteria_names.append(header)
    
    # Parse alternatives from rows (Alternative column contains alt names)
    for row in rows:
        alt_name = row.get('Alternative', '')
        if alt_name and alt_name.lower() not in ['group', 'unit', 'description']:
            if alt_name not in alternatives:
                alternatives[alt_name] = {}
            
            for crit_name in criteria_names:
                value = row.get(crit_name, '')
                alternatives[alt_name][crit_name] = str(value) if value else ''
    
    # Build criteria dicts from the data
    # This is a simplified version - you may need to enhance this
    for crit_name in criteria_names:
        criteria.append({
            'criterion_name': crit_name,
            'alternatives': [
                {'name': alt_name, 'value': alternatives[alt_name].get(crit_name, '')}
                for alt_name in alternatives.keys()
            ]
        })
    
    return {
        'criteria': criteria,
        'alternatives': alternatives,
        'criteria_names': criteria_names,
    }


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
            'bwt': {...}
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
    
    return session_doc


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
    
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        fieldnames_lower = {str(name).strip().lower() for name in fieldnames if name}

        has_compact_points = 'list of points' in fieldnames_lower or 'list_of_points' in fieldnames_lower

        for row in reader:
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
    
    Expected CSV columns: criterion_name, rank, value, confidence
    
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
    
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
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
    
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
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
    
    with open(weights_csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        has_session_id = any(str(name).strip().lower() == 'session_id' for name in fieldnames if name)

        for row in reader:
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
        if os.path.isdir(item_path) and item.startswith('elicitation_'):
            sessions.append(item)
    
    return sorted(sessions)

# ============================================================================
# HELPER FUNCTIONS FOR DATA EXTRACTION & PROCESSING
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
        If True, also return confidence dict.
    
    Returns
    -------
    dict or tuple
        If return_confidence=False:
            Mapping criterion_name -> scipy interp1d function
        If return_confidence=True:
            (vf_dict, confidence_dict)
    """
    from scipy.interpolate import interp1d
    
    vf_dict = {}
    confidence_dict = {}

    session_dir = os.path.join(data_dir, session_name)
    vf_path = os.path.join(session_dir, 'value_functions.csv')
    qi_path = os.path.join(session_dir, 'qualitative_indicators.csv')

    value_functions_data = _load_value_functions_csv(vf_path) if os.path.exists(vf_path) else {'criteria': {}}
    criteria_map = value_functions_data.get('criteria', {}) if isinstance(value_functions_data, dict) else {}
    qualitative_indicators = _load_qualitative_indicators_csv(qi_path) if os.path.exists(qi_path) else {}
    
    # Build interpolation functions
    for criterion in criteria:
        if not isinstance(criterion, dict):
            continue
        name = criterion.get('criterion_name')
        if not name:
            continue
        
        points = []
        
        if criterion.get('is_qualitative'):
            # For weight computation, qualitative criteria MUST use identity function: vf(x) = x
            # This is required for constraint checking (a_value = 1/vf(x))
            points = [{'x': 0, 'y': 0}, {'x': 1, 'y': 1}]
            if return_confidence and name in qualitative_indicators:
                qi_data = qualitative_indicators[name]
                conf_map = qi_data.get('confidences', {}) if isinstance(qi_data, dict) else {}
                if isinstance(conf_map, dict):
                    confidence_dict[name] = {
                        int(k) if isinstance(k, str) and k.isdigit() else k: _parse_confidence_value(v, default=4)
                        for k, v in conf_map.items()
                    }
        else:
            # Quantitative criterion
            cfg = criteria_map.get(name, {}) if isinstance(criteria_map, dict) else {}
            if isinstance(cfg, dict):
                points = cfg.get('points', [])
                if return_confidence:
                    confidence_dict[name] = _parse_confidence_value(cfg.get('confidence', 4), default=4)

        if not points or len(points) < 2:
            continue
        
        x_vals = [float(p['x']) for p in points if 'x' in p and 'y' in p]
        y_vals = [float(p['y']) for p in points if 'x' in p and 'y' in p]
        
        if len(x_vals) < 2:
            continue
        
        min_y, max_y = min(y_vals), max(y_vals)
        interp_func = interp1d(
            x_vals,
            y_vals,
            kind='linear',
            fill_value=(min_y, max_y),
            bounds_error=False,
        )
        vf_dict[name] = interp_func
    
    if return_confidence:
        return vf_dict, confidence_dict
    return vf_dict


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
    session_dir = os.path.join(data_dir, session_name)
    bwt_path = os.path.join(session_dir, 'bwt_comparisons.csv')
    
    comparisons = []
    
    if not os.path.exists(bwt_path):
        return comparisons

    bwt_data = _load_bwt_csv(bwt_path)
    for comp in bwt_data.get('comparisons', []):
        comparisons.append({
            'REFERENCE_CRITERION': comp.get('reference_criterion', ''),
            'ADJUSTED_CRITERION': comp.get('adjusted_criterion', ''),
            'DATA_VALUE': float(comp.get('data_value', 0) or 0),
            'TYPE': comp.get('type', ''),
            'GROUP': comp.get('group', ''),
        })
    
    return comparisons


def build_alternatives_from_csv(data_dir, session_name=None):
    """Build alternatives dict from input CSV.
    
    Parameters
    ----------
    data_dir : str
        Path to data directory.
    session_name : str or None
        Optional session name for qualitative substitution.
    
    Returns
    -------
    tuple
        (alternatives_dict, criteria_names_list)
    """
    input_data = load_input_data(data_dir)
    alternatives = input_data.get('alternatives', {})
    criteria_names = input_data.get('criteria_names', [])
    
    # TODO: Add qualitative substitution if session_name is provided
    # This would require loading qualitative_indicators from the session
    
    return alternatives, criteria_names
