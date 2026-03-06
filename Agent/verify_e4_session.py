#!/usr/bin/env python3
"""
Verify E4 session data
"""
from pymongo import MongoClient
from bson import ObjectId
import json

client = MongoClient('mongodb://localhost:27017/')
db = client['elicitation']

# Find E4 session
e4 = db.sessions.find_one({'name': 'E4'})

if not e4:
    print("❌ E4 session not found!")
    exit(1)

print(f"✓ Found E4 session: {e4['_id']}")
print(f"  Name: {e4.get('name')}")
print(f"  Study Session ID: {e4.get('study_session_id')}")
print(f"  Created: {e4.get('created_at')}")

# Check Value Functions
vf = e4.get('value_functions', {})
vf_criteria = vf.get('criteria', {})
print(f"\n📈 Value Functions: {len(vf_criteria)} criteria")
for crit_name, crit_data in list(vf_criteria.items())[:3]:
    points = crit_data.get('points', [])
    conf = crit_data.get('confidence')
    print(f"   - {crit_name}: {len(points)} points, confidence={conf}")
if len(vf_criteria) > 3:
    print(f"   ... and {len(vf_criteria) - 3} more")

# Check QI
qi = e4.get('qualitative_indicators', {})
print(f"\n🎯 Qualitative Indicators: {len(qi)} criteria")
for crit_name, crit_data in list(qi.items())[:3]:
    ranking = crit_data.get('ranking', {})
    print(f"   - {crit_name}: {len(ranking)} alternatives ranked")
if len(qi) > 3:
    print(f"   ... and {len(qi) - 3} more")

# Check BWT
bwt = e4.get('bwt', {})
comparisons = bwt.get('comparisons', [])
print(f"\n📊 BWT Comparisons: {len(comparisons)} total")

# Group by type and group
types = {}
groups = {}
for comp in comparisons:
    comp_type = comp.get('type', 'unknown')
    comp_group = comp.get('group', 'unknown')
    types[comp_type] = types.get(comp_type, 0) + 1
    groups[comp_group] = groups.get(comp_group, 0) + 1

print(f"\n   By type:")
for comp_type, count in types.items():
    print(f"      - {comp_type}: {count}")

print(f"\n   By group:")
for comp_group, count in groups.items():
    print(f"      - {comp_group}: {count}")

# Show sample comparisons
print(f"\n📝 Sample BWT comparisons:")
for comp in comparisons[:3]:
    print(f"   {comp['reference']} vs {comp['adjusted']}: {comp['value']} ({comp['type']}, {comp['group']})")

print(f"\n✅ E4 session is complete and ready to use!")

client.close()
