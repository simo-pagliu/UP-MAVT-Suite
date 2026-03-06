#!/usr/bin/env python3
"""Detailed check of E4 data structure"""

from pymongo import MongoClient
import json

client = MongoClient('mongodb://localhost:27017/')
db = client['elicitation']

e4 = db.sessions.find_one({'name': 'E4'})

print("="*60)
print("VALUE FUNCTIONS CHECK")
print("="*60)

vf = e4.get('value_functions', {})
vf_criteria = vf.get('criteria', {})
print(f"\nVF structure:")
print(f"  Type: {type(vf)}")
print(f"  Keys: {list(vf.keys())}")
print(f"  Criteria count: {len(vf_criteria)}")

if vf_criteria:
    first_crit = list(vf_criteria.items())[0]
    print(f"\nFirst criterion: {first_crit[0]}")
    print(json.dumps(first_crit[1], indent=2))

print("\n" + "="*60)
print("BWT CHECK")
print("="*60)

bwt = e4.get('bwt', {})
print(f"\nBWT structure:")
print(f"  Type: {type(bwt)}")
print(f"  Keys: {list(bwt.keys())}")

comps = bwt.get('comparisons', [])
print(f"  Total comparisons: {len(comps)}")

# Check by group
groups = {}
for comp in comps:
    g = comp.get('group')
    if g not in groups:
        groups[g] = []
    groups[g].append(comp)

print(f"\n  By group:")
for g in sorted(groups.keys()):
    print(f"    {g}: {len(groups[g])}")

# Check intra groups specifically
print(f"\n  Intra-B comparisons:")
intra_b = groups.get('intra-B', [])
for comp in intra_b:
    print(f"    {comp.get('reference')} vs {comp.get('adjusted')}: {comp.get('type')}")

print(f"\n  Intra-W comparisons:")
intra_w = groups.get('intra-W', [])
for comp in intra_w:
    print(f"    {comp.get('reference')} vs {comp.get('adjusted')}: {comp.get('type')}")

client.close()
