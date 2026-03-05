#!/usr/bin/env python3
"""Search for 'ref' in all collections"""

from pymongo import MongoClient

# Connect to MongoDB
client = MongoClient('mongodb://localhost:27017/')

# Check all databases
print("Searching for 'ref' in all databases...\n")

for db_name in client.list_database_names():
    if db_name in ['admin', 'config', 'local']:
        continue
    
    db = client[db_name]
    print(f"Database: {db_name}")
    
    for collection_name in db.list_collection_names():
        collection = db[collection_name]
        
        # Search for 'ref' in name field
        docs_with_name = list(collection.find({'name': 'ref'}))
        if docs_with_name:
            print(f"  Collection '{collection_name}' - found in 'name' field:")
            for doc in docs_with_name:
                print(f"    ID: {doc['_id']}, name: {doc.get('name')}")
        
        # Search for 'ref' in code field
        docs_with_code = list(collection.find({'code': 'ref'}))
        if docs_with_code:
            print(f"  Collection '{collection_name}' - found in 'code' field:")
            for doc in docs_with_code:
                print(f"    ID: {doc['_id']}, code: {doc.get('code')}")
        
        # Show all documents in this collection
        all_docs = list(collection.find({}, {'_id': 1, 'name': 1, 'code': 1}))
        if all_docs:
            print(f"  Collection '{collection_name}' has {len(all_docs)} documents:")
            for doc in all_docs:
                name = doc.get('name', 'N/A')
                code = doc.get('code', 'N/A')
                print(f"    ID: {doc['_id']}, name: {name}, code: {code}")

client.close()
