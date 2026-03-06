#!/usr/bin/env python3
"""Check E4 session structure"""

from pymongo import MongoClient
import json

client = MongoClient('mongodb://localhost:27017/')
db = client['elicitation']

e4 = db.sessions.find_one({'name': 'E4'})

if not e4:
    print("E4 not found!")
    exit(1)

print(f"E4 ID: {e4['_id']}")
print(f"E4 has 'criteria' field: {'criteria' in e4}")
print(f"E4 has 'bwt' field: {'bwt' in e4}")

bwt = e4.get('bwt')
if bwt:
    print(f"\nBWT structure:")
    print(f"  Keys: {list(bwt.keys())}")
    comps = bwt.get('comparisons', [])
    print(f"  Number of comparisons: {len(comps)}")
    
    if comps:
        print(f"\n  First comparison:")
        print(f"    {json.dumps(comps[0], indent=4)}")
        
        # Check unique groups
        groups = set(c.get('group') for c in comps)
        print(f"\n  Unique groups: {groups}")
        
        # Count by group
        print(f"\n  Comparisons by group:")
        for group in sorted(groups):
            count = len([c for c in comps if c.get('group') == group])
            print(f"    {group}: {count}")
else:
    print("\nNo BWT data found")

# Check study session criteria
study_id = e4.get('study_session_id')
if study_id:
    study = db.study_sessions.find_one({'_id': study_id})
    if study:
        criteria = study.get('criteria', [])
        print(f"\nStudy session has {len(criteria)} criteria")
        if criteria:
            # Check groups
            groups = set(c.get('group') for c in criteria)
            print(f"  Criterion groups: {groups}")
            for group in sorted(groups):
                crit_names = [c.get('criterion_name') for c in criteria if c.get('group') == group]
                print(f"    {group}: {len(crit_names)} criteria - {crit_names}")

client.close()
