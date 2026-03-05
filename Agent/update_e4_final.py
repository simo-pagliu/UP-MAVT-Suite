#!/usr/bin/env python3
"""
Update E4 session's weight elicitation data from BWT_results_4.csv
"""
import csv
import pymongo
from pymongo import MongoClient

# Connect to MongoDB
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

# Update E4 session (ID: 699c6833d57a26fdfd9f7d4b)
result = db.sessions.update_one(
    {"_id": "699c6833d57a26fdfd9f7d4b"},
    {
        "$set": {
            "weight_elicitation.comparisons": comparisons,
            "weight_elicitation.modified_from_csv": "BWT_results_4.csv",
        }
    },
)

print(f"Matched: {result.matched_count}, Modified: {result.modified_count}")

if result.matched_count == 0:
    print("ERROR: E4 session not found")
else:
    print("✓ E4 weight elicitation data updated successfully")
    
    # Verify the update
    e4 = db.sessions.find_one({"_id": "699c6833d57a26fdfd9f7d4b"})
    if e4 and "weight_elicitation" in e4:
        comp_count = len(e4["weight_elicitation"].get("comparisons", []))
        print(f"✓ Verified: E4 now has {comp_count} comparisons")

client.close()
