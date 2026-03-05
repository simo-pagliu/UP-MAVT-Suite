#!/usr/bin/env python3
"""
Update E4 session with proper ObjectId handling
"""
import csv
from pymongo import MongoClient
from bson import ObjectId

client = MongoClient("mongodb://localhost:27017/elicitation")
db = client.elicitation

# Read BWT CSV
comparisons = []
with open("BWT_results_4.csv", "r") as f:
    reader = csv.DictReader(f)
    for row in reader:
        comp = {
            "TYPE": row["Type"],
            "REFERENCE_CRITERION": row["Reference"],
            "ADJUSTED_CRITERION": row["Other"],
            "DATA_VALUE": float(row["Value"]),
            "GROUP": row["Group"],
            "CONFIDENCE": int(row["Confidence"]),
            "a": float(row["a"]),
        }
        comparisons.append(comp)

print(f"Loaded {len(comparisons)} comparisons from CSV")

# Try with ObjectId
e4_id = ObjectId("699c6833d57a26fdfd9f7d4b")
print(f"Using ObjectId: {e4_id}")

result = db.sessions.update_one(
    {"_id": e4_id},
    {
        "$set": {
            "weight_elicitation.comparisons": comparisons,
        }
    },
)

print(f"Matched: {result.matched_count}, Modified: {result.modified_count}")

if result.modified_count > 0:
    print("✓ E4 updated successfully")
    e4 = db.sessions.find_one({"_id": e4_id})
    if e4:
        comp_count = len(e4.get("weight_elicitation", {}).get("comparisons", []))
        print(f"✓ Verified: E4 now has {comp_count} comparisons")
else:
    print("ERROR: Update failed")

client.close()
