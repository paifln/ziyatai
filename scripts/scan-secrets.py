import re,subprocess,sys
from pathlib import Path
paths=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z']).decode('utf-8').split('\0')
bad=[]
for name in paths:
 p=Path(name)
 if not p.is_file():continue
 if p.suffix.lower() not in ('.ts','.tsx','.js','.mjs','.json','.md','.yml','.yaml','.sql','.py','.example','.pem','.key','.toml'):continue
 text=p.read_text(encoding='utf-8-sig',errors='replace')
 if (re.search(r'\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}',text)
     or re.search(r'\bgh[pousr]_[A-Za-z0-9]{36,}',text)
     or re.search(r'\bAKIA[A-Z0-9]{16}\b',text)
     or ('-----BEGIN '+'PRIVATE KEY-----') in text):bad.append(name)
if bad:print('Potential secret found in: '+', '.join(bad));sys.exit(1)
print('No recognizable OpenAI key or PEM private key found in tracked/unignored source.')
