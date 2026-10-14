import re,subprocess,sys
from pathlib import Path
paths=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard'],text=True).splitlines()
bad=[]
for name in paths:
 p=Path(name)
 if p.suffix.lower() not in ('.ts','.tsx','.js','.mjs','.json','.md','.yml','.yaml','.sql','.py','.example'):continue
 text=p.read_text(encoding='utf-8-sig',errors='replace')
 if re.search(r'\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}',text) or ('-----BEGIN '+'PRIVATE KEY-----') in text:bad.append(name)
if bad:print('Potential secret found in: '+', '.join(bad));sys.exit(1)
print('No recognizable OpenAI key or PEM private key found in tracked/unignored source.')
