#!/usr/bin/env python3
"""
Fix E4 session by copying criteria from study session
"""

from pymongo import MongoClient

client = MongoClient('mongodb://localhost:27017/')
db = client['elicitation']

# Find E4 session
e4 = db.sessions.find_one({'name': 'E4'})
if not e4:
    print("❌ E4 session not found!")
    exit(1)

print(f"✓ Found E4 session: {e4['_id']}")

# Get study session
study_id = e4.get('study_session_id')
if not study_id:
    print("❌ E4 has no study_session_id!")
    exit(1)

study = db.study_sessions.find_one({'_id': study_id})
if not study:
    print("❌ Study session not found!")
    exit(1)

print(f"✓ Found study session: {study['_id']} (code: {study.get('code')})")

# Get criteria from study session
criteria = study.get('criteria', [])
print(f"✓ Study session has {len(criteria)} criteria")

# Update E4 session with criteria
result = db.sessions.update_one(
    {'_id': e4['_id']},
    {'$set': {'criteria': criteria}}
)

if result.modified_count > 0:
    print(f"✅ Updated E4 session with {len(criteria)} criteria")
    
    # Verify
    e4_updated = db.sessions.find_one({'_id': e4['_id']})
    if 'criteria' in e4_updated:
        print(f"✓ Verified: E4 now has criteria field with {len(e4_updated['criteria'])} items")
    else:
        print("❌ ERROR: criteria field still missing after update")
else:
    print("⚠️  No changes made (criteria already exists?)")
    if 'criteria' in e4:
        print(f"   E4 already has {len(e4.get('criteria', []))} criteria")

client.close()
