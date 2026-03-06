#!/usr/bin/env python3
"""Quick check of E4 criteria structure"""

from pymongo import MongoClient

client = MongoClient('mongodb://localhost:27017/')
db = client['elicitation']

e4 = db.sessions.find_one({'name': 'E4'})
criteria = e4.get('criteria', [])

print(f'E4 has {len(criteria)} criteria\n')

# Check first criterion
crit = criteria[0]
print(f'First criterion ({crit.get("criterion_name")}):')
print(f'  Unit: {crit.get("unit")}')
print(f'  Group: {crit.get("group")}')
print(f'  Is qualitative: {crit.get("is_qualitative")}')
print(f'  Alternatives: {len(crit.get("alternatives", []))}')
if crit.get('alternatives'):
    print(f'  Example alt: {crit["alternatives"][0]}')

# Check qualitative criterion
qual_crit = next((c for c in criteria if c.get('is_qualitative')), None)
if qual_crit:
    print(f'\nQualitative criterion ({qual_crit.get("criterion_name")}):')
    print(f'  Alternatives: {len(qual_crit.get("alternatives", []))}')
    if qual_crit.get('alternatives'):
        alt_names = [a.get('name') for a in qual_crit['alternatives']]
        print(f'  Alternative names: {alt_names}')

client.close()
