import sys,json,importlib.util
from pathlib import Path
import pytest
sys.path.insert(0, str(Path('apps/worker').resolve()))
spec=importlib.util.spec_from_file_location('ktp_parser','apps/worker/parser.py');parser=importlib.util.module_from_spec(spec);spec.loader.exec_module(parser)
manifest=json.loads(Path('tests/fixtures/manifest.json').read_text(encoding='utf-8'))

def test_class_context_changes_inside_one_sheet_and_grade_column_wins():
 def src():return parser.source(sheet='Общий план')
 result=parser.normalize([
  (['7 класс'],src()),
  (['Тема урока','Цели обучения','Часы'],src()),
  (['Алгоритмы','Описывать алгоритмы','1'],src()),
  (['8-сынып'],src()),
  (['Тема урока','Цели обучения','Часы','Класс'],src()),
  (['Циклы','Составлять циклы','1','9А'],src()),
  (['Массивы','Обрабатывать массивы','1',''],src()),
 ])
 assert [r['grade'] for r in result['rows']]==[7,9,8]

def test_class_context_does_not_leak_between_sheets():
 result=parser.normalize([
  (['Тема урока','Цели обучения','Часы'],parser.source(sheet='11А')),
  (['Алгоритмы','Описывать алгоритмы','1'],parser.source(sheet='11А')),
  (['Тема урока','Цели обучения','Часы'],parser.source(sheet='Без класса')),
  (['Циклы','Составлять циклы','1'],parser.source(sheet='Без класса')),
 ])
 assert [r['grade'] for r in result['rows']]==[11,None]
 assert parser.grade_from_label('1-11 классы') is None
 assert parser.grade_from_label('7.1.1.1') is None
 assert parser.grade_from_label('3 класс__') == 3

@pytest.mark.parametrize('kind',['javascript','attachment','launch','additional-action','automatic-uri'])
def test_active_pdf_content_is_rejected_without_executing_it(tmp_path,kind):
 from pypdf import PdfWriter
 from pypdf.generic import DictionaryObject,NameObject,TextStringObject,ArrayObject
 writer=PdfWriter();writer.add_blank_page(width=595,height=842)
 if kind=='javascript':
  action=DictionaryObject({NameObject('/S'):NameObject('/JavaScript'),NameObject('/JS'):TextStringObject('void(0);')})
  writer.root_object[NameObject('/Names')]=DictionaryObject({NameObject('/JavaScript'):DictionaryObject({NameObject('/Names'):ArrayObject([TextStringObject('synthetic'),writer._add_object(action)])})})
 elif kind=='attachment':writer.add_attachment('sample.txt',b'harmless synthetic fixture')
 else:
  action=DictionaryObject({NameObject('/S'):NameObject('/Launch' if kind=='launch' else '/URI'),NameObject('/F' if kind=='launch' else '/URI'):TextStringObject('sample.txt' if kind=='launch' else 'https://example.invalid/')})
  if kind=='additional-action':writer.root_object[NameObject('/AA')]=DictionaryObject({NameObject('/WC'):action})
  else:writer.root_object[NameObject('/OpenAction')]=action
 path=tmp_path/(kind+'.pdf')
 with path.open('wb') as output:writer.write(output)
 with pytest.raises(ValueError,match='FILE_INVALID'):parser.inspect(path)

def test_passive_pdf_destination_and_user_opened_link_remain_readable(tmp_path):
 from pypdf import PdfWriter
 from pypdf.generic import DictionaryObject,NameObject,TextStringObject,ArrayObject,NumberObject
 writer=PdfWriter();page=writer.add_blank_page(width=595,height=842)
 writer.root_object[NameObject('/OpenAction')]=ArrayObject([page.indirect_reference,NameObject('/Fit')])
 annotation=DictionaryObject({NameObject('/Type'):NameObject('/Annot'),NameObject('/Subtype'):NameObject('/Link'),NameObject('/Rect'):ArrayObject([NumberObject(n) for n in (0,0,20,20)]),NameObject('/A'):DictionaryObject({NameObject('/S'):NameObject('/URI'),NameObject('/URI'):TextStringObject('https://example.invalid/')})})
 page[NameObject('/Annots')]=ArrayObject([writer._add_object(annotation)])
 path=tmp_path/'passive.pdf'
 with path.open('wb') as output:writer.write(output)
 parser.inspect(path)

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

def test_plural_topic_singular_goal_and_merged_quarter():
 headers=['№ п/п','Раздел/ Сквозные темы','Темы урока','Цель обучения','Кол-во часов','Сроки']
 mapping=parser.header_map(headers)
 assert mapping=={'lessonNumberRaw':0,'section':1,'topic':2,'goals':3,'hours':4,'dateRaw':5}
 tables=[(headers,parser.source(sheet='1 класс')),
   (['3 четверть']*6,parser.source(sheet='1 класс')),
   (['1','Раздел 1','Первая тема','1.1.1.1 объяснять назначение устройств','1',''],parser.source(sheet='1 класс',range='row:8')),
   (['Оглавление другого листа','X','X','X','X',''],parser.source(sheet='2 класс')),
   (headers,parser.source(sheet='2 класс')),
   (['1','Раздел 2','Вторая тема','2.1.1.1 сравнивать устройства','1',''],parser.source(sheet='2 класс',range='row:8'))]
 result=parser.normalize(tables)
 assert len(result['rows'])==2
 assert result['rows'][0]['quarter']=='3 четверть'
 assert result['rows'][1]['quarter']==''
 assert [r['source']['sheet'] for r in result['rows']]==['1 класс','2 класс']
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

@pytest.mark.parametrize('suffix',['XML','RELS','Xml','Rels'])
def test_mixed_case_xml_parts_cannot_bypass_external_relationship_checks(tmp_path,suffix):
 import zipfile
 path=tmp_path/'external.docx'
 with zipfile.ZipFile(path,'w') as z:
  z.writestr('word/document.xml','<document/>')
  z.writestr('word/extra.'+suffix,'<Relationships><Relationship TargetMode="External" Target="https://example.invalid/"/></Relationships>')
 with pytest.raises(ValueError,match='FILE_INVALID'):parser.inspect(path)
