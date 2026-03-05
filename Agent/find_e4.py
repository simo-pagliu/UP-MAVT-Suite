#!/usr/bin/env python3
"""
Find session by name pattern E4
"""
import pymongo
from pymongo import MongoClient

client = MongoClient("mongodb://localhost:27017/elicitation")
db = client.elicitation

# Get all sessions
sessions = list(db.sessions.find({}, {"_id": 1, "name": 1}))

print("All sessions:")
for session in sessions:
    print(f"  ID: {session['_id']}, Name: {session.get('name', 'N/A')}")

# Search for E4
e4 = db.sessions.find_one({"name": "E4"})
if e4:
    print(f"\nFound E4: {e4['_id']}")
else:
    print("\nE4 not found by exact name match")
    # Try case-insensitive
    e4 = db.sessions.find_one({"name": {"$regex": "E4", "$options": "i"}})
    if e4:
        print(f"Found case-insensitive: {e4['name']} -> {e4['_id']}")

client.close()
