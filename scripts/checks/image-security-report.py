import json, subprocess, sys
from pathlib import Path
from collections import Counter
reports=[]
for kind in ('web','renderer','worker','antivirus'):
 path=Path('.local')/f'security-{kind}-final.json'
 if not path.exists():raise SystemExit(f'Missing scan: {path}')
 data=json.loads(path.read_text());findings=[{k:v.get(k) for k in ('VulnerabilityID','PkgName','InstalledVersion','FixedVersion','Severity','Status','Title')} for result in data.get('Results',[]) for v in result.get('Vulnerabilities',[])]
 image=data['ArtifactName'];digest=data['Metadata']['ImageID']
 current=subprocess.check_output(['docker','image','inspect','--format','{{.Id}}',image],text=True).strip()
 if current!=digest:raise SystemExit(f'Stale scan for {image}: image changed; scan again')
 reports.append({'component':kind,'image':image,'digest':digest,'scannedAt':data.get('CreatedAt'),'os':data['Metadata'].get('OS'),'targets':[{'target':r.get('Target'),'type':r.get('Type'),'packageCount':len(r.get('Packages',[]))} for r in data.get('Results',[])],'counts':dict(Counter(f['Severity'] for f in findings)),'findings':findings})
Path('.local/reports').mkdir(parents=True,exist_ok=True)
Path('.local/reports/container-security.json').write_text(json.dumps({'date':max(r['scannedAt'] for r in reports)[:10],'scanner':'Trivy 0.76.0','filter':'HIGH,CRITICAL; includes unfixed findings; no CVE ignored','scope':'Recognized OS and language packages in four images; bundled worker JS dependencies also checked separately with npm audit','images':reports},indent=2),encoding='utf8')
for report in reports:print(report['component'],report['counts'])
if any(r['findings'] for r in reports):sys.exit(1)
