import json
from pathlib import Path
from collections import Counter
reports=[]
for kind in ('web','renderer','worker'):
 path=Path('.local')/f'security-{kind}-final.json'
 if not path.exists():continue
 data=json.loads(path.read_text());findings=[{k:v.get(k) for k in ('VulnerabilityID','PkgName','InstalledVersion','FixedVersion','Severity','Status','Title')} for result in data.get('Results',[]) for v in result.get('Vulnerabilities',[])]
 reports.append({'component':kind,'image':data.get('ArtifactName'),'digest':data.get('Metadata',{}).get('ImageID'),'counts':dict(Counter(f['Severity'] for f in findings)),'findings':findings})
Path('docs/reports').mkdir(parents=True,exist_ok=True)
Path('docs/reports/container-security.json').write_text(json.dumps({'date':'2026-10-15','scanner':'Trivy 0.76.0','filter':'HIGH,CRITICAL; includes unfixed findings; no CVE ignored','images':reports},indent=2),encoding='utf8')
for report in reports:print(report['component'],report['counts'])
