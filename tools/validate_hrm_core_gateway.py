from pathlib import Path
import json,hashlib,zipfile,sys
ROOT=Path(r'D:\MANIFEST'); REPO=ROOT/'GitHub'/'HRM-Manifesto'; CORE=REPO/'core'/'1.0.0'; GW=REPO/'gateway'/'1.0.0'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
rel=json.loads((CORE/'release.json').read_text(encoding='utf-8')); bad=[x['path'] for x in rel['payload'] if sha(CORE/x['path'])!=x['sha256']]
units=[json.loads(x) for x in (GW/'units.jsonl').read_text(encoding='utf-8').splitlines() if x.strip()]
counts={(d,l):sum(1 for u in units if u['document_id']==d and u['language']==l) for d in ('charter','decalogue') for l in ('pl','en','sv')}
concepts=json.loads((GW/'concepts.json').read_text(encoding='utf-8'))['concepts']; links=['catalog.json','concepts.json','units.jsonl','relations.json','retrieval.md','unit.schema.json']
checks={'payload_hashes':not bad,'unique_unit_ids':len({u['id'] for u in units})==len(units),'charter_46_each':all(counts[('charter',l)]==46 for l in ('pl','en','sv')),'decalogue_10_each':all(counts[('decalogue',l)]==10 for l in ('pl','en','sv')),'concepts_12':len(concepts)==12,'website_gateway_complete':all((REPO/'website'/'ai'/'1.0.0'/x).exists() for x in links),'signature_external_rule':rel.get('signature',{}).get('artifact')=='release.json.minisig' and 'status_rule' in rel.get('signature',{})}
zip_path=ROOT/'Wydania'/'DO_ZATWIERDZENIA'/'HRM-Core-1.0.0-UNSIGNED.zip'
with zipfile.ZipFile(zip_path) as z: checks['zip_has_release']='release.json' in z.namelist()
ok=all(checks.values()); print(json.dumps({'ok':ok,'checks':checks,'counts':{str(k):v for k,v in counts.items()},'bad_hashes':bad},ensure_ascii=False,indent=2)); sys.exit(0 if ok else 1)