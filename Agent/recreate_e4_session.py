#!/usr/bin/env python3
"""
Recreate E4 elicitation session from CSV files
Usage: python recreate_e4_session.py
"""
import csv
import sys
from pymongo import MongoClient
from bson import ObjectId
from datetime import datetime, timezone

# Connect to MongoDB
client = MongoClient('mongodb://localhost:27017/')
db = client['elicitation']  # Use the same database as the backend

print("Connected to MongoDB")

# CSV file paths (downloaded files)
BWT_CSV = "/home/simo/Downloads/pile_bwt_E4(2).csv"
VF_CSV = "/home/simo/Downloads/value_functions_E4.csv"
QI_CSV = "/home/simo/Downloads/qualitative_E4.csv"

def parse_vf_points(points_str):
    """Parse points string like '4000.0:1.0;6000.0:0.75;8000.0:0.5'"""
    points = []
    for pair in points_str.split(';'):
        x_str, y_str = pair.split(':')
        points.append({
            'x': float(x_str),
            'y': float(y_str)
        })
    return points

def parse_vf_confidence(conf_str):
    """Parse confidence - can be single number or comma-separated"""
    conf_str = str(conf_str).strip()
    if ',' in conf_str:
        # Multiple confidences - return as list for now, but typically we use one value
        values = [int(c.strip()) for c in conf_str.split(',')]
        # Return the first or average
        return values[0]
    else:
        return int(conf_str)

# Load BWT data
print(f"\n📊 Loading BWT data from {BWT_CSV}")
bwt_comparisons = []
try:
    with open(BWT_CSV, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            comp = {
                'reference': row['REFERENCE_CRITERION'],
                'adjusted': row['ADJUSTED_CRITERION'],
                'value': float(row['DATA_VALUE']),
                'type': row['TYPE'],  # best, worst, intra-best, intra-worst
                'group': row['GROUP']  # Technical, Economic, etc. or intra-B, intra-W
            }
            bwt_comparisons.append(comp)
    print(f"✓ Loaded {len(bwt_comparisons)} BWT comparisons")
except FileNotFoundError:
    print(f"ERROR: Could not find {BWT_CSV}")
    sys.exit(1)

# Load VF data
print(f"\n📈 Loading VF data from {VF_CSV}")
vf_criteria = {}
try:
    with open(VF_CSV, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            criterion_name = row['CRITERION_NAME']
            confidence = parse_vf_confidence(row['CONFIDENCE'])
            points = parse_vf_points(row['LIST OF POINTS'])
            
            vf_criteria[criterion_name] = {
                'points': points,
                'confidence': confidence
            }
    print(f"✓ Loaded VF data for {len(vf_criteria)} criteria")
except FileNotFoundError:
    print(f"ERROR: Could not find {VF_CSV}")
    sys.exit(1)

# Load QI data
print(f"\n🎯 Loading QI data from {QI_CSV}")
qi_data = {}
try:
    with open(QI_CSV, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            criterion_name = row['CRITERION_NAME']
            alternative = row['ALTERNATIVE']
            rank = int(row['RANK'])
            value = float(row['VALUE'])
            confidence = int(row['CONFIDENCE'])
            
            if criterion_name not in qi_data:
                qi_data[criterion_name] = {
                    'ranking': {},
                    'values': {},
                    'confidences': {}
                }
            
            qi_data[criterion_name]['ranking'][alternative] = rank
            qi_data[criterion_name]['values'][alternative] = value
            # Convert rank to string for MongoDB compatibility
            qi_data[criterion_name]['confidences'][str(rank)] = confidence
    
    print(f"✓ Loaded QI data for {len(qi_data)} criteria")
except FileNotFoundError:
    print(f"ERROR: Could not find {QI_CSV}")
    sys.exit(1)

# Find or create study session
print("\n🔍 Looking for study session...")
study_session = db.study_sessions.find_one({'code': 'ref'})
if not study_session:
    # Check if ReactorSelection exists and rename it
    reactor_session = db.study_sessions.find_one({'code': 'ReactorSelection'})
    if reactor_session:
        print("Found ReactorSelection, renaming to 'ref'...")
        db.study_sessions.update_one(
            {'_id': reactor_session['_id']},
            {'$set': {'code': 'ref'}}
        )
        study_session_id = reactor_session['_id']
        print(f"✓ Renamed to 'ref': {study_session_id}")
    else:
        print("Study session not found. Creating one...")
        study_session_id = db.study_sessions.insert_one({
            'code': 'ref',
            'created_at': datetime.now(timezone.utc),
            'features': {'qi': True, 'vf': True, 'bwt': True}
        }).inserted_id
        print(f"✓ Created study session: {study_session_id}")
else:
    study_session_id = study_session['_id']
    print(f"✓ Found existing study session: {study_session_id}")

# Extract criteria from VF and QI data to build input definition
print("\n📋 Building input definition from elicitation data...")
all_criteria_names = set(vf_criteria.keys()) | set(qi_data.keys())

# Get groups from BWT data
criterion_to_group = {}
for comp in bwt_comparisons:
    group = comp['group']
    if group not in ['intra-B', 'intra-W']:  # Skip intra-groups
        criterion_to_group[comp['reference']] = group
        criterion_to_group[comp['adjusted']] = group

# Get all alternative names from QI data (should be consistent across all criteria)
all_alternatives = set()
for qi_criterion in qi_data.values():
    ranking = qi_criterion.get('ranking', {})
    all_alternatives.update(ranking.keys())

alternatives_list = sorted(all_alternatives)
print(f"✓ Found {len(alternatives_list)} alternatives: {alternatives_list}")

criteria_input = []
for crit_name in sorted(all_criteria_names):
    is_qualitative = crit_name in qi_data
    group = criterion_to_group.get(crit_name, 'Unknown')
    
    criterion_def = {
        'criterion_name': crit_name,
        'unit': 'unit',  # Placeholder - not available in export data
        'group': group,
        'description': '',
        'is_qualitative': is_qualitative,
        'use_mid_splitting': True,  # Default
        'alternatives': []
    }
    
    # Add all alternatives to every criterion
    # For qualitative: empty values
    # For quantitative: placeholder numeric values
    for alt_name in alternatives_list:
        criterion_def['alternatives'].append({
            'name': alt_name,
            'value': '' if is_qualitative else '1'  # Placeholder for quantitative
        })
    
    criteria_input.append(criterion_def)

# Update study session with criteria
db.study_sessions.update_one(
    {'_id': study_session_id},
    {'$set': {'criteria': criteria_input}}
)
print(f"✓ Added {len(criteria_input)} criteria to study session")

# Find or create E4 elicitation session
print("\n🔍 Looking for E4 session...")
e4_session = db.sessions.find_one({'name': 'E4', 'study_session_id': study_session_id})

if e4_session:
    e4_id = e4_session['_id']
    print(f"✓ Found existing E4 session: {e4_id}")
    print("Updating existing session...")
else:
    print("E4 session not found. Creating one...")
    e4_id = db.sessions.insert_one({
        'name': 'E4',
        'study_session_id': study_session_id,
        'created_at': datetime.now(timezone.utc),
        'session_locked': False,
        'qualitative_indicators': None,
        'value_functions': None,
        'bwt': None
    }).inserted_id
    print(f"✓ Created E4 session: {e4_id}")

# Update E4 with all data
print("\n💾 Updating E4 session with data...")

update_data = {}

# Add Value Functions
update_data['value_functions'] = {
    'criteria': vf_criteria
}

# Add Qualitative Indicators
update_data['qualitative_indicators'] = qi_data

# Add BWT data
update_data['bwt'] = {
    'comparisons': bwt_comparisons,
    'criteria_signature': ''  # Will be set by the workflow
}

result = db.sessions.update_one(
    {'_id': e4_id},
    {'$set': update_data}
)

if result.modified_count > 0 or result.matched_count > 0:
    print("✓ E4 session updated successfully!")
    
    # Verify
    e4_verified = db.sessions.find_one({'_id': e4_id})
    vf_count = len(e4_verified.get('value_functions', {}).get('criteria', {}))
    qi_count = len(e4_verified.get('qualitative_indicators', {}))
    bwt_count = len(e4_verified.get('bwt', {}).get('comparisons', []))
    
    print(f"\n✅ Verification:")
    print(f"   - Value Functions: {vf_count} criteria")
    print(f"   - Qualitative Indicators: {qi_count} criteria")
    print(f"   - BWT Comparisons: {bwt_count} comparisons")
    print(f"\n🎉 E4 session ready! Session ID: {e4_id}")
else:
    print("❌ ERROR: Failed to update E4 session")
    sys.exit(1)

client.close()
