import json,zipfile
from pathlib import Path
from lxml import etree
import pymupdf as fitz
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
doc=fitz.open(root/'full.pdf');pdftext='\n'.join(p.get_text() for p in doc)
assert all(c in pdftext for c in 'ӘҒҚҢӨҰҮҺІ')
answer_page=next(i for i,p in enumerate(doc) if 'Жауаптар және түсіндірмелер' in p.get_text())
assert answer_page>0
for i,p in enumerate(doc):
 assert p.get_text().strip()
 p.get_pixmap(matrix=fitz.Matrix(1.25,1.25)).save(root/f'full-page-{i+1}.png')
report={'docxValid':True,'tnr14':True,'studentAnswersExcluded':True,'kazakhCharactersPreserved':True,'pdfPages':len(doc),'answersBeginOnPage':answer_page+1,'visualInspection':'pending'}
(root/'document-report.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))
