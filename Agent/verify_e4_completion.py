#!/usr/bin/env python3
"""
Verify E4 completion status using same logic as frontend
"""

from pymongo import MongoClient

def is_input_complete(criteria):
    """Check if input definition is complete"""
    if not isinstance(criteria, list) or len(criteria) == 0:
        return False
    for crit in criteria:
        if not crit.get('criterion_name') or not crit.get('unit'):
            return False
        alts = crit.get('alternatives', [])
        if len(alts) == 0:
            return False
        if not all(alt.get('name') for alt in alts):
            return False
    return True

def is_qualitative_complete(criteria, qi_data):
    """Check if qualitative indicators are complete"""
    if not isinstance(criteria, list):
        return False
    qual_criteria = [c for c in criteria if c.get('is_qualitative')]
    if len(qual_criteria) == 0:
        return True
    if not qi_data or not isinstance(qi_data, dict):
        return False
    for crit in qual_criteria:
        name = crit.get('criterion_name')
        data = qi_data.get(name)
        if not data or not isinstance(data, dict):
            return False
        ranking = data.get('ranking', {})
        values = data.get('values', {})
        if not ranking or not values or len(ranking) == 0 or len(values) == 0:
            return False
    return True

def is_value_functions_complete(criteria, vf_data):
    """Check if value functions are complete"""
    if not isinstance(criteria, list):
        return False
    criteria_map = vf_data.get('criteria', {}) if isinstance(vf_data, dict) else {}
    non_qual = [c for c in criteria if not c.get('is_qualitative')]
    if len(non_qual) == 0:
        return True
    for crit in non_qual:
        name = crit.get('criterion_name')
        cfg = criteria_map.get(name)
        if not cfg or not isinstance(cfg, dict):
            return False
        points = cfg.get('points', [])
        if not isinstance(points, list) or len(points) == 0:
            return False
    return True

def is_pile_bwt_complete(criteria, bwt_data):
    """Check if PILE-BWT is complete"""
    if not isinstance(criteria, list) or len(criteria) == 0:
        return False
    comparisons = bwt_data.get('comparisons', []) if isinstance(bwt_data, dict) else []
    
    # Group criteria by group name
    group_map = {}
    for crit in criteria:
        group_name = crit.get('group', 'Ungrouped')
        if group_name not in group_map:
            group_map[group_name] = []
        group_map[group_name].append(crit)
    
    base_groups = list(group_map.items())
    
    # Check each base group has enough comparisons
    for group_name, group_criteria in base_groups:
        expected = max(1, 2 * len(group_criteria) - 3)
        group_comps = [c for c in comparisons if c.get('group') == group_name]
        if len(group_comps) < expected:
            print(f"  ❌ {group_name}: {len(group_comps)}/{expected} comparisons")
            return False
        print(f"  ✓ {group_name}: {len(group_comps)}/{expected} comparisons")
    
    # Check intra-B and intra-W if multiple groups
    has_multiple_groups = len(base_groups) > 1
    if has_multiple_groups:
        intra_expected = max(1, 2 * len(base_groups) - 3)
        intra_b_comps = [c for c in comparisons if c.get('group') == 'intra-B']
        intra_w_comps = [c for c in comparisons if c.get('group') == 'intra-W']
        
        if len(intra_b_comps) < intra_expected:
            print(f"  ❌ intra-B: {len(intra_b_comps)}/{intra_expected} comparisons")
            return False
        print(f"  ✓ intra-B: {len(intra_b_comps)}/{intra_expected} comparisons")
        
        if len(intra_w_comps) < intra_expected:
            print(f"  ❌ intra-W: {len(intra_w_comps)}/{intra_expected} comparisons")
            return False
        print(f"  ✓ intra-W: {len(intra_w_comps)}/{intra_expected} comparisons")
    
    return len(base_groups) > 0

# Connect and check
client = MongoClient('mongodb://localhost:27017/')
db = client['elicitation']

e4 = db.sessions.find_one({'name': 'E4'})
if not e4:
    print("❌ E4 not found!")
    exit(1)

print(f"Checking E4 session: {e4['_id']}\n")

criteria = e4.get('criteria', [])
qi_data = e4.get('qualitative_indicators')
vf_data = e4.get('value_functions')
bwt_data = e4.get('bwt')

print("📋 Input Definition:")
input_complete = is_input_complete(criteria)
print(f"  Status: {'✅ Complete' if input_complete else '❌ Missing'}")

print("\n🎯 Qualitative Indicators:")
qi_complete = is_qualitative_complete(criteria, qi_data)
print(f"  Status: {'✅ Complete' if qi_complete else '❌ Missing'}")

print("\n📈 Value Functions:")
vf_complete = is_value_functions_complete(criteria, vf_data)
print(f"  Status: {'✅ Complete' if vf_complete else '❌ Missing'}")

print("\n📊 PILE-BWT:")
bwt_complete = is_pile_bwt_complete(criteria, bwt_data)
print(f"  Status: {'✅ Complete' if bwt_complete else '❌ Missing'}")

print("\n" + "="*50)
if input_complete and qi_complete and vf_complete and bwt_complete:
    print("🎉 ALL STEPS COMPLETE!")
else:
    print("⚠️  Some steps are missing")

client.close()
