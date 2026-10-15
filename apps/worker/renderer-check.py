import sys, zipfile
from lxml import etree
import pdfplumber
path=sys.argv[1]
try:
 if path.endswith('.docx'):
  with zipfile.ZipFile(path) as z:
   root=etree.fromstring(z.read('word/document.xml'))
   if len(root)==0:raise ValueError()
   etree.fromstring(z.read('word/styles.xml'))
 else:
  with pdfplumber.open(path) as d:
   if not len(d.pages) or not any((p.extract_text() or '').strip() for p in d.pages):raise ValueError()
 print('{"valid":true}')
except Exception:
 print('ZIYAT_ERROR:RENDER_UNAVAILABLE',file=sys.stderr);sys.exit(1)
