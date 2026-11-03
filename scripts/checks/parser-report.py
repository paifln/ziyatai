import json,subprocess,sys,importlib.util
from pathlib import Path
sys.path.insert(0, str(Path('apps/worker').resolve()))
spec=importlib.util.spec_from_file_location('parser','apps/worker/parser.py');p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
manifest=json.loads(Path('tests/fixtures/manifest.json').read_text(encoding='utf8'));groups={}
for fixture in manifest:
 if fixture['ocr']:continue
 actual=p.extract('tests/fixtures/'+fixture['file']);g=groups.setdefault(fixture['kind'],{'fixtures':0,'expectedRows':0,'foundRows':0,'matchedFields':0,'totalFields':0});g['fixtures']+=1;g['expectedRows']+=len(fixture['expected']);g['foundRows']+=len(actual['rows'])
 for i,expected in enumerate(fixture['expected']):
  for key,value in expected.items():g['totalFields']+=1;g['matchedFields']+=int(i<len(actual['rows']) and p.clean(actual['rows'][i][key])==p.clean(value))
for g in groups.values():g['recall']=g['foundRows']/g['expectedRows'];g['fieldAccuracy']=g['matchedFields']/g['totalFields']
report={'source':'synthetic only; no approved real school corpus available','normalization':'NFKC + whitespace collapse; exact field values; immutable raw source retained','formats':groups,'ocr':'separate e2e verification; no digital thresholds claimed for OCR'}
Path('.local/reports').mkdir(parents=True,exist_ok=True);Path('.local/reports/parser.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(groups))
