#!/usr/bin/env python3
"""
Check session details to find E4
"""
import pymongo
from pymongo import MongoClient
import json

client = MongoClient("mongodb://localhost:27017/elicitation")
db = client.elicitation

# Get all sessions with more details
sessions = list(db.sessions.find({}, {
    "_id": 1,
    "case_study_name": 1,
    "study_name": 1,
    "case_study_id": 1,
}))

print("All sessions in database:")
for session in sessions:
    _id = session.get('_id')
    case_study = session.get('case_study_name', session.get('case_study_id', 'N/A'))
    study = session.get('study_name', 'N/A')
    print(f"  {_id}: case_study={case_study}, study={study}")

# Try to find which one might be E4
print("\nLet me dump the first session's structure:")
if sessions:
    first = db.sessions.find_one({})
    print(json.dumps(first, default=str, indent=2)[:1500])

client.close()
