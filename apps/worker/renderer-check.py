import sys, zipfile
from lxml import etree
import pymupdf as fitz
path=sys.argv[1]
try:
 if path.endswith('.docx'):
  with zipfile.ZipFile(path) as z:
   root=etree.fromstring(z.read('word/document.xml'))
   if len(root)==0:raise ValueError()
   etree.fromstring(z.read('word/styles.xml'))
 else:
  with fitz.open(path) as d:
   if not len(d) or not any(p.get_text().strip() for p in d):raise ValueError()
 print('{"valid":true}')
except Exception:
 print('ZIYAT_ERROR:RENDER_UNAVAILABLE',file=sys.stderr);sys.exit(1)
