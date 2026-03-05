#!/usr/bin/env python3
"""List all sessions in the database"""

from pymongo import MongoClient

# Connect to MongoDB
client = MongoClient('mongodb://localhost:27017/')
db = client['elicitation_tools']

# List all sessions
sessions = list(db.sessions.find({}, {'_id': 1, 'name': 1}))

print(f"Found {len(sessions)} session(s):\n")
for session in sessions:
    print(f"  Name: '{session.get('name', 'N/A')}' | ID: {session['_id']}")

client.close()
