#!/usr/bin/env python3
"""Check all collections in the database"""

from pymongo import MongoClient

# Connect to MongoDB
client = MongoClient('mongodb://localhost:27017/')
db = client['elicitation_tools']

# List all collections
print("Collections in 'elicitation_tools' database:")
for collection_name in db.list_collection_names():
    count = db[collection_name].count_documents({})
    print(f"  - {collection_name}: {count} document(s)")
    
print("\n--- Study Sessions ---")
study_sessions = list(db.study_sessions.find({}, {'_id': 1, 'code': 1}))
for session in study_sessions:
    print(f"  Code: '{session.get('code', 'N/A')}' | ID: {session['_id']}")

print("\n--- Elicitation Sessions ---")
sessions = list(db.sessions.find({}, {'_id': 1, 'name': 1}))
for session in sessions:
    print(f"  Name: '{session.get('name', 'N/A')}' | ID: {session['_id']}")

client.close()
