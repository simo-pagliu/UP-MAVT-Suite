#!/usr/bin/env python3
"""
Check what sessions exist in the database
"""
import pymongo
from pymongo import MongoClient

client = MongoClient("mongodb://localhost:27017/elicitation")
db = client.elicitation

# List all sessions
sessions = list(db.sessions.find({}, {"_id": 1, "case_study_name": 1}))
print("Sessions in database:")
for session in sessions:
    print(f"  {session.get('_id')}: {session.get('case_study_name', 'N/A')}")

# Look for any session with E4 in the name
e4_sessions = list(db.sessions.find({"_id": {"$regex": "E4"}}, {"_id": 1}))
print(f"\nSessions matching 'E4': {e4_sessions}")

client.close()
