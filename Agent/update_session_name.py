#!/usr/bin/env python3
"""Quick script to rename a session in the database"""

from pymongo import MongoClient

# Connect to MongoDB
client = MongoClient('mongodb://localhost:27017/')
db = client['elicitation_tools']

# Update the session name
old_name = 'ref'
new_name = 'ref_old'

result = db.sessions.update_one(
    {'name': old_name},
    {'$set': {'name': new_name}}
)

if result.modified_count > 0:
    print(f"✓ Successfully renamed session '{old_name}' to '{new_name}'")
    # Show the updated document
    doc = db.sessions.find_one({'name': new_name})
    if doc:
        print(f"  Session ID: {doc['_id']}")
        print(f"  New name: {doc['name']}")
else:
    print(f"✗ No session found with name '{old_name}' or no changes needed")
    # Check if new name already exists
    doc = db.sessions.find_one({'name': new_name})
    if doc:
        print(f"  Note: A session with name '{new_name}' already exists")

client.close()
