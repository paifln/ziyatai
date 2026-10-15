import json,zipfile,sys
from pathlib import Path
from lxml import etree
import pdfplumber
sys.path.insert(0,str(Path('apps/worker').resolve()))
from pdf_adapter import render_page
root=Path('.local/qa');ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
with zipfile.ZipFile(root/'full.docx') as z:
 xml=etree.fromstring(z.read('word/document.xml'));styles=etree.fromstring(z.read('word/styles.xml'))
 text=' '.join(xml.xpath('//w:t/text()',namespaces=ns))
 assert 'Ә Ғ Қ Ң Ө Ұ Ү Һ І' in text
 assert xml.xpath('//w:br[@w:type="page"]',namespaces=ns)
 assert styles.xpath('//w:rFonts[@w:ascii="Times New Roman"]',namespaces=ns)
 assert styles.xpath('//w:sz[@w:val="28"]',namespaces=ns)
with zipfile.ZipFile(root/'student.docx') as z:
 text=' '.join(etree.fromstring(z.read('word/document.xml')).xpath('//w:t/text()',namespaces=ns))
 assert 'Жауаптар және түсіндірмелер' not in text
 assert 'Қалай:' not in text and 'Неге:' not in text
if (root/'reviewed.docx').exists():
 with zipfile.ZipFile(root/'reviewed.docx') as z:
  reviewed_text=' '.join(etree.fromstring(z.read('word/document.xml')).xpath('//w:t/text()',namespaces=ns))
  assert 'Черновик. Требуется педагогическая проверка.' not in reviewed_text
  assert 'Жоба. Педагогикалық тексеру қажет.' not in reviewed_text
doc=pdfplumber.open(root/'full.pdf');pdftext='\n'.join(p.extract_text() or '' for p in doc.pages)
assert all(c in pdftext for c in 'ӘҒҚҢӨҰҮҺІ')
answer_page=next(i for i,p in enumerate(doc.pages) if 'Жауаптар және түсіндірмелер' in (p.extract_text() or ''))
assert answer_page>0
for i,p in enumerate(doc.pages):
 assert (p.extract_text() or '').strip()
 with render_page(root/'full.pdf',i,scale=1.25) as image:image.save(root/f'full-page-{i+1}.png')
report={'docxValid':True,'tnr14':True,'studentAnswersExcluded':True,'kazakhCharactersPreserved':True,'pdfPages':len(doc.pages),'answersBeginOnPage':answer_page+1,'visualInspection':'pending'}
doc.close()
(root/'document-report.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))
