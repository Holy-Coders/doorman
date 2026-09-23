"""Freeze a small stratified test sample before any Jev answer is observed."""
import json
from pathlib import Path
from evaluate import groups, assign_groups, fingerprint

root=Path('artifacts/external')
rows=json.loads((root/'fpagent-features.json').read_text())['rows']
group_ids=groups(rows)
humans=assign_groups([group_ids[i] for i,r in enumerate(rows) if not r['positive']],[.55,.15,.15,.15])
families=sorted({r['family'] for r in rows if r['positive']})
selected=[]
for f,family in enumerate(families):
    candidates=sorted([(i,r) for i,r in enumerate(rows) if r['family']==family],key=lambda pair:fingerprint('jev-pilot-v1:'+pair[1]['id']))
    selected.extend(dict(index=i,fold=family,positive=True,features=r['features']) for i,r in candidates[:6 if f<5 else 5])
candidates=sorted([(i,r) for i,r in enumerate(rows) if not r['positive'] and humans[group_ids[i]]==3],key=lambda pair:fingerprint('jev-pilot-v1:'+pair[1]['id']))
selected.extend(dict(index=i,fold=families[j%len(families)],positive=False,features=r['features']) for j,(i,r) in enumerate(candidates[:40]))
assert len(selected)==80
p=root/'jev-agent-cases.json';p.write_text(json.dumps(selected));p.chmod(0o600)
print('Frozen 80 FP-Agent pilot cases (40 human, 40 agent) from existing test folds')
