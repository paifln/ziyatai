import sys,json,importlib.util
from pathlib import Path
import pytest
sys.path.insert(0, str(Path('apps/worker').resolve()))
spec=importlib.util.spec_from_file_location('ktp_parser','apps/worker/parser.py');parser=importlib.util.module_from_spec(spec);spec.loader.exec_module(parser)
manifest=json.loads(Path('tests/fixtures/manifest.json').read_text(encoding='utf-8'))

def test_large_pdf_page_rejected_before_native_bitmap_allocation(tmp_path, monkeypatch):
 from reportlab.pdfgen import canvas
 from pdf_adapter import render_page
 import pypdfium2
 path=tmp_path/'large.pdf'
 doc=canvas.Canvas(str(path),pagesize=(10000,10000));doc.drawString(10,10,'bounded');doc.showPage();doc.save()
 called=[]
 def forbidden(*args,**kwargs):called.append(True);raise AssertionError('must not allocate')
 monkeypatch.setattr(pypdfium2.PdfPage,'render',forbidden)
 with pytest.raises(ValueError,match='FILE_SIZE'):render_page(path)
 assert called==[]

def test_preview_is_bounded_and_preserves_page_dimensions():
 from pdf_adapter import preview_page
 with preview_page('tests/fixtures/ru-digital.pdf',0) as image:
  assert image.width<=1201 and image.height<=1601
  assert image.width>image.height

@pytest.mark.parametrize('fixture',[f for f in manifest if not f['ocr']],ids=lambda f:f['file'])
def test_digital_corpus(fixture):
 result=parser.extract('tests/fixtures/'+fixture['file'])
 assert len(result['rows'])==len(fixture['expected'])
 for actual,expected in zip(result['rows'],fixture['expected']):
  for key,value in expected.items():assert actual[key]==value,(fixture['file'],key,actual[key],value)
  assert actual['source']['range'] and actual['source']['fragment']
@pytest.mark.parametrize('filename',['corrupt.pdf','wrong-mime.xlsx','zip-bomb.docx','encrypted.pdf','external-link.docx'])
def test_rejects_unsafe_input(filename):
 with pytest.raises(Exception):parser.inspect('tests/fixtures/'+filename)
def test_missing_dates_not_invented():
 rows=parser.extract('tests/fixtures/ru-table-2.docx')['rows']
 assert rows[1]['dateRaw']=='02.09' and rows[1]['dateStart'] is None
 assert rows[2]['dateRaw']=='' and rows[2]['dateStart'] is None
def test_grade_not_inferred_from_code():
 result=parser.extract('tests/fixtures/ru-table-1.docx');assert 'grade' not in result
def test_normalization():
 assert parser.normalize_date('31.02.2026')[2]==['invalid_date']
 assert parser.normalize_date('01.09.2026–04.09.2026')[:2]==('2026-09-01','2026-09-04')
 assert parser.header_map(['Сағат саны','Оқу мақсаттары','Сабақтың тақырыбы'])=={'hours':0,'goals':1,'topic':2}
def test_hidden_sheets_excluded_and_auditable():
 result=parser.extract('tests/fixtures/kk-workbook-2.xlsx')
 assert len(result['rows'])==3 and any('Hidden sheet' in s for s in result['unrecognized'])
 included=parser.extract('tests/fixtures/kk-workbook-2.xlsx',True);assert len(included['rows'])==4
@pytest.mark.parametrize('encoding',['utf-8','utf-16','utf-32'])
def test_dtd_rejected_before_xml_parser_even_with_wide_encoding(tmp_path,encoding):
 import zipfile
 path=tmp_path/'xxe.docx'
 with zipfile.ZipFile(path,'w') as z:z.writestr('word/document.xml',('<!DOCTYPE document [<!ENTITY x SYSTEM "file:///etc/passwd">]><document>&x;</document>').encode(encoding))
 with pytest.raises(ValueError,match='FILE_INVALID'):parser.inspect(path)
