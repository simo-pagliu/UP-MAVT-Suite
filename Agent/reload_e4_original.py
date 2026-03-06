#!/usr/bin/env python3
"""
Reload E4 session with ORIGINAL CORRECT data
"""
import csv
from pymongo import MongoClient
from datetime import datetime, timezone

# Connect to MongoDB
client = MongoClient('mongodb://localhost:27017/')
db = client['elicitation']

print("Connected to MongoDB\n")

# CSV file paths - USE ORIGINAL FILES (these are correct!)
BWT_CSV = "/home/simo/GitHub/elicitation-tools/Agent/pile_bwt_E4(2).csv"
VF_CSV = "/home/simo/GitHub/elicitation-tools/Agent/value_functions_E4.csv"
QI_CSV = "/home/simo/GitHub/elicitation-tools/Agent/qualitative_E4.csv"

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
        values = [int(c.strip()) for c in conf_str.split(',')]
        return values[0]
    else:
        return int(conf_str)

# Load BWT data
print(f"📊 Loading BWT data from {BWT_CSV}")
bwt_comparisons = []
try:
    with open(BWT_CSV, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            comp = {
                'reference': row['REFERENCE_CRITERION'],
                'adjusted': row['ADJUSTED_CRITERION'],
                'value': float(row['DATA_VALUE']),
                'type': row['TYPE'],
                'group': row['GROUP']
            }
            bwt_comparisons.append(comp)
    print(f"✓ Loaded {len(bwt_comparisons)} BWT comparisons")
except FileNotFoundError as e:
    print(f"ERROR: {e}")
    exit(1)

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
except FileNotFoundError as e:
    print(f"ERROR: {e}")
    exit(1)

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
            qi_data[criterion_name]['confidences'][str(rank)] = confidence
    
    print(f"✓ Loaded QI data for {len(qi_data)} criteria")
except FileNotFoundError as e:
    print(f"ERROR: {e}")
    exit(1)

# Find E4 session
print("\n🔍 Looking for E4 session...")
e4 = db.sessions.find_one({'name': 'E4'})
if not e4:
    print("ERROR: E4 session not found!")
    exit(1)

e4_id = e4['_id']
print(f"✓ Found E4 session: {e4_id}")

# Update E4 with all data
print("\n💾 Updating E4 session with ORIGINAL CORRECT data...")

update_data = {}

# Add Value Functions - WITH PROPER VALUE CURVES
update_data['value_functions'] = {
    'criteria': vf_criteria
}

# Add Qualitative Indicators
update_data['qualitative_indicators'] = qi_data

# Add BWT data
update_data['bwt'] = {
    'comparisons': bwt_comparisons,
    'criteria_signature': ''
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
    print(f"\n🎉 E4 session reloaded with ORIGINAL CORRECT data!")
else:
    print("❌ ERROR: Failed to update E4 session")
    exit(1)

client.close()
