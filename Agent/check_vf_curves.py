#!/usr/bin/env python3
"""Check specific VF curves"""

from pymongo import MongoClient
import json

client = MongoClient('mongodb://localhost:27017/')
db = client['elicitation']

e4 = db.sessions.find_one({'name': 'E4'})
vf = e4.get('value_functions', {})
vf_criteria = vf.get('criteria', {})

# Show several criteria to verify curves
criteria_to_check = ['Construction Complexity', 'Design Maturity', 'Design Complexity']

for crit_name in criteria_to_check:
    if crit_name in vf_criteria:
        crit = vf_criteria[crit_name]
        points = crit.get('points', [])
        print(f"\n{crit_name}:")
        for p in points:
            print(f"  {p['x']:.3f} → {p['y']:.3f}")

client.close()
