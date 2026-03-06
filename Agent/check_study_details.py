#!/usr/bin/env python3
"""Check study session details"""

from pymongo import MongoClient

client = MongoClient('mongodb://localhost:27017/')
db = client['elicitation']

# Get all study sessions
study_sessions = list(db.study_sessions.find({}))

print(f"Found {len(study_sessions)} study session(s):\n")

for study in study_sessions:
    print(f"Study Session ID: {study['_id']}")
    print(f"  Code: {study.get('code')}")
    print(f"  Created: {study.get('created_at')}")
    print(f"  Features: {study.get('features')}")
    
    criteria = study.get('criteria', [])
    print(f"  Criteria: {len(criteria)} defined")
    
    if criteria:
        print(f"  Criterion names:")
        for crit in criteria:
            print(f"    - {crit.get('criterion_name')} (group: {crit.get('group')})")
    
    # Check elicitation sessions
    sessions = list(db.sessions.find({'study_session_id': study['_id']}, {'_id': 1, 'name': 1}))
    print(f"  Elicitation sessions: {len(sessions)}")
    for sess in sessions:
        print(f"    - {sess.get('name')} ({sess['_id']})")
    
    print()

client.close()
