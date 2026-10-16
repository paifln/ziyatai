"""Deterministic KTP adapters. Input is data, never instructions or executable code."""
import sys, os, json, re, uuid, zipfile, datetime, unicodedata, codecs
from pathlib import Path
from lxml import etree

MAX_EXPANDED = 100 * 1024 * 1024
HEADER = {
 'topic': ['тема урока','темы урока','темы уроков','тема','сабақтың тақырыбы','сабақ тақырыбы','тақырып','тақырыбы'],
 'goals': ['цель обучения','цели обучения','учебные цели','оқу мақсаттары','оқу мақсаты','оқыту мақсаттары'],
 'lessonGoals': ['цели урока','сабақ мақсаттары'],
 'dateRaw': ['сроки','дата','дата проведения','мерзімі','күні','мерзімдер'],
 'hours': ['количество часов','кол во часов','часы','сағат саны','сағат'],
 'lessonNumberRaw': ['№','No','no','no п/п','номер','номер урока','р/с','реті','n'],
 'section': ['раздел','раздел/ сквозные темы','бөлім'], 'notes': ['примечание','примечания','ескерту'],
 'quarter': ['четверть','тоқсан']}

def clean(value):
 return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', str(value or '')).replace('\x00','')).strip()

def header_map(cells):
 result={}
 for i, cell in enumerate(cells):
  text=clean(cell).lower().replace('-', ' ').replace('№','no')
  for key, values in HEADER.items():
   if text in values or any(text.replace(' ','')==v.replace(' ','') for v in values) or any(text.startswith(v+' ') for v in values if len(v)>5):
    result[key]=i; break
 return result if 'topic' in result and ('goals' in result or 'hours' in result or 'dateRaw' in result) else {}

def normalize_date(raw):
 raw=clean(raw)
 warnings=[]
 if not raw:return None,None,['missing_date']
 full=re.findall(r'(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)',raw)
 iso=re.findall(r'\b\d{4}-\d{2}-\d{2}\b',raw)
 try:
  dates=[datetime.date(int(y),int(m),int(d)).isoformat() for d,m,y in full] or [datetime.date.fromisoformat(v).isoformat() for v in iso]
 except ValueError:return None,None,['invalid_date']
 if not dates:return None,None,['date_requires_year_or_review']
 if len(dates)>2:return None,None,['multiple_dates_require_review']
 if len(dates)==2 and dates[0]>dates[1]:return None,None,['invalid_date_range']
 return dates[0], dates[-1] if len(dates)==2 else None,warnings

def row_from(cells,mapping,source,order,section,quarter):
 def get(k):return clean(cells[mapping[k]]) if k in mapping and mapping[k]<len(cells) else ''
 topic=get('topic'); goals=get('goals')
 start,end,warnings=normalize_date(get('dateRaw'))
 if not goals:warnings.append('missing_objective_text')
 codes=re.findall(r'(?<!\d)\d{1,2}\.\d+\.\d+\.\d+(?!\d)',goals)
 if goals and not any(c.isalpha() for c in goals):warnings.append('objective_code_only')
 if source['method']=='ocr':warnings.append('ocr_requires_review')
 if any('[formula without cached value]' in str(c) for c in cells):warnings.append('formula_without_cached_value')
 return {'id':str(uuid.uuid4()),'sourceOrder':order,'lessonNumberRaw':get('lessonNumberRaw'),'section':get('section') or section,'quarter':get('quarter') or quarter,'topic':topic,'goals':goals,'objectiveCodes':codes,'lessonGoals':get('lessonGoals'),'hours':get('hours'),'dateRaw':get('dateRaw'),'dateStart':start,'dateEnd':end,'notes':get('notes'),'warnings':warnings,'source':source}

def normalize(tables):
 rows=[];warnings=[];unrecognized=[];section='';quarter='';mapping={};last_sheet=None
 for cells,source in tables:
  if source.get('sheet')!=last_sheet:
   mapping={};section='';quarter='';last_sheet=source.get('sheet')
  if not any(clean(c) for c in cells):continue
  discovered=header_map(cells)
  if discovered:mapping=discovered;continue
  joined=clean(' '.join(str(c or '') for c in cells))
  nonempty=list(dict.fromkeys(clean(c) for c in cells if clean(c)))
  if len(nonempty)==1 and re.search(r'(четверть|тоқсан)',joined,re.I):quarter=nonempty[0];continue
  if len(nonempty)==1 and not re.match(r'^\d+\s',joined):section=nonempty[0];unrecognized.append(nonempty[0]);continue
  if re.match(r'^(итого|барлығы|всего)\b',joined,re.I):continue
  if not mapping:unrecognized.append(joined);continue
  topic=clean(cells[mapping['topic']]) if mapping['topic']<len(cells) else ''
  if not topic:
   # Continuation is retained for teacher review, never silently attributed.
   unrecognized.append(joined);continue
  source['fragment']=joined[:12000]
  rows.append(row_from(cells,mapping,source,len(rows)+1,section,quarter))
  if len(rows)>2000:raise ValueError('FILE_SIZE')
 if not rows:warnings.append('no_lesson_rows_found')
 if unrecognized:warnings.append('unrecognized_fragments_require_review')
 return {'schemaVersion':'1.0','rows':rows,'warnings':warnings,'unrecognized':unrecognized,'parserVersion':'ktp-1.1'}

def inspect(path):
 ext=Path(path).suffix.lower()
 if ext in ('.docx','.xlsx'):
  with zipfile.ZipFile(path) as z:
   entries=z.infolist()
   if len(entries)>10000 or sum(i.file_size for i in entries)>MAX_EXPANDED:raise ValueError('FILE_SIZE')
   for entry in entries:
    parts=Path(entry.filename.replace('\\','/')).parts
    if '..' in parts or entry.filename.startswith(('/','\\')) or ':' in entry.filename:raise ValueError('FILE_INVALID')
    if entry.flag_bits & 1:raise ValueError('FILE_INVALID')
    if entry.file_size>1000000 and entry.file_size/max(entry.compress_size,1)>200:raise ValueError('FILE_SIZE')
    if any(v in entry.filename.lower() for v in ('vbaproject','embeddings/','activex/')):raise ValueError('FILE_INVALID')
    if entry.filename.lower().endswith(('.xml','.rels')):
     content=z.read(entry)
     if content.startswith((codecs.BOM_UTF32_LE,codecs.BOM_UTF32_BE)):decoded=content.decode('utf-32')
     elif content.startswith((codecs.BOM_UTF16_LE,codecs.BOM_UTF16_BE)):decoded=content.decode('utf-16')
     elif content.startswith(b'<\x00\x00\x00'):decoded=content.decode('utf-32-le')
     elif content.startswith(b'\x00\x00\x00<'):decoded=content.decode('utf-32-be')
     elif content.startswith(b'<\x00'):decoded=content.decode('utf-16-le')
     elif content.startswith(b'\x00<'):decoded=content.decode('utf-16-be')
     else:decoded=content.decode('utf-8-sig')
     if '<!DOCTYPE' in decoded or '<!ENTITY' in decoded:raise ValueError('FILE_INVALID')
     root=etree.fromstring(content,etree.XMLParser(resolve_entities=False,no_network=True,huge_tree=False))
     if any(r.get('TargetMode')=='External' for r in root.iter()):raise ValueError('FILE_INVALID')
   required='word/document.xml' if ext=='.docx' else 'xl/workbook.xml'
   if required not in z.namelist():raise ValueError('FILE_INVALID')
 elif ext=='.pdf':
  import pdfplumber
  with pdfplumber.open(path) as d:
   if d.doc.encryption:raise ValueError('FILE_INVALID')
   if not len(d.pages):raise ValueError('FILE_INVALID')
   if len(d.pages)>150:raise ValueError('FILE_SIZE')
 elif ext=='.xls':
  import xlrd
  w=xlrd.open_workbook(path,on_demand=True)
  if w.nsheets>20:raise ValueError('FILE_SIZE')
  w.release_resources()
 else:raise ValueError('FILE_TYPE')

def source(page=None,sheet=None,range='',method='digital'):
 return {'page':page,'sheet':sheet,'range':range,'fragment':'','method':method,'confidence':0.65 if method=='ocr' else 0.95}

def docx_tables(path):
 with zipfile.ZipFile(path) as z:root=etree.fromstring(z.read('word/document.xml'),etree.XMLParser(resolve_entities=False,no_network=True))
 ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
 tables=[]
 for ti,tbl in enumerate(root.xpath('//w:tbl',namespaces=ns)):
  vertical={}
  for ri,tr in enumerate(tbl.xpath('./w:tr',namespaces=ns)):
   cells=[];col=0
   for tc in tr.xpath('./w:tc',namespaces=ns):
    text='\n'.join(''.join(p.xpath('.//w:t/text()',namespaces=ns)) for p in tc.xpath('./w:p',namespaces=ns))
    span=tc.xpath('./w:tcPr/w:gridSpan/@w:val',namespaces=ns);width=int(span[0]) if span else 1
    vm=tc.xpath('./w:tcPr/w:vMerge',namespaces=ns)
    if vm and vm[0].get('{'+ns['w']+'}val')!='restart':text=vertical.get(col,text)
    elif vm:vertical[col]=text
    else:vertical.pop(col,None)
    cells.extend([text]*width);col+=width
   tables.append((cells,source(range=f'table:{ti+1}/row:{ri+1}')))
 return tables

def spreadsheets(path,include_hidden=False):
 ext=Path(path).suffix.lower();tables=[];count=0
 if ext=='.xlsx':
  import openpyxl
  w=openpyxl.load_workbook(path,data_only=True,read_only=False,keep_links=False)
  wf=openpyxl.load_workbook(path,data_only=False,read_only=False,keep_links=False)
  if len(w.worksheets)>20:raise ValueError('FILE_SIZE')
  for sheet in w:
   if sheet.sheet_state!='visible' and not include_hidden:
    tables.append(([f'Hidden sheet excluded: {sheet.title}'],source(sheet=sheet.title)));continue
   if sheet.max_row*sheet.max_column>500000:raise ValueError('FILE_SIZE')
   merged={}
   for area in sheet.merged_cells.ranges:
    if area.size['rows']*area.size['columns']>100000:raise ValueError('FILE_SIZE')
    val=sheet.cell(area.min_row,area.min_col).value
    for rr in range(area.min_row,area.max_row+1):
     for cc in range(area.min_col,area.max_col+1):merged[(rr,cc)]=val
   for ri,row in enumerate(sheet.iter_rows(),1):
    if sheet.row_dimensions[ri].hidden and not include_hidden:
     tables.append(([f'Hidden row excluded: {ri}'],source(sheet=sheet.title,range=str(ri))));continue
    cells=[]
    for cell in row:
     value=merged.get((cell.row,cell.column),cell.value)
     if value is None and wf[sheet.title].cell(cell.row,cell.column).data_type=='f':value='[formula without cached value]'
     if isinstance(value,(datetime.datetime,datetime.date)):value=value.strftime('%d.%m.%Y')
     cells.append(str(value) if value is not None else '')
    count+=sum(bool(c) for c in cells)
    tables.append((cells,source(sheet=sheet.title,range=f'A{ri}:{row[-1].column_letter}{ri}')))
  w.close();wf.close()
 else:
  import xlrd
  w=xlrd.open_workbook(path,formatting_info=True)
  if w.nsheets>20:raise ValueError('FILE_SIZE')
  for sh in w.sheets():
   if sh.visibility and not include_hidden:
    tables.append(([f'Hidden sheet excluded: {sh.name}'],source(sheet=sh.name)));continue
   merged={}
   for rlo,rhi,clo,chi in sh.merged_cells:
    for rr in range(rlo,rhi):
     for cc in range(clo,chi):merged[(rr,cc)]=sh.cell(rlo,clo)
   for ri in range(sh.nrows):
    if sh.rowinfo_map.get(ri) and sh.rowinfo_map[ri].hidden and not include_hidden:
     tables.append(([f'Hidden row excluded: {ri+1}'],source(sheet=sh.name)));continue
    cells=[]
    for ci in range(sh.ncols):
     cell=merged.get((ri,ci),sh.cell(ri,ci));value=cell.value
     if cell.ctype==xlrd.XL_CELL_DATE:value=xlrd.xldate_as_datetime(value,w.datemode).strftime('%d.%m.%Y')
     elif isinstance(value,float) and value.is_integer():value=str(int(value))
     cells.append(str(value))
    count+=sum(bool(c) for c in cells);tables.append((cells,source(sheet=sh.name,range=f'row:{ri+1}')))
  w.release_resources()
 if count>100000:raise ValueError('FILE_SIZE')
 return tables

def pdf_tables(path):
 import pdfplumber
 from pdf_adapter import render_page
 tables=[]
 with pdfplumber.open(path) as plumber:
  for pi,page in enumerate(plumber.pages):
   text=page.extract_text() or '';letters=sum(c.isalpha() for c in text);bad=sum(c=='\ufffd' for c in text)
   if letters<30 or bad/max(len(text),1)>0.05:
    import pytesseract
    pytesseract.pytesseract.tesseract_cmd=os.getenv('TESSERACT_PATH','tesseract')
    try:
     im=render_page(path,pi,scale=2)
     text=pytesseract.image_to_string(im,lang='kaz+rus',config='--psm 6',timeout=60)
    except ValueError:raise
    except Exception:raise ValueError('OCR_UNAVAILABLE')
    # Detect ruled tables geometrically before OCR, retaining page/cell provenance.
    grey=im.convert('L');width,height=grey.size;pixels=grey.load()
    def peaks(values):
     groups=[]
     for value in values:
      if not groups or value>groups[-1][-1]+2:groups.append([value])
      else:groups[-1].append(value)
     return [sum(g)//len(g) for g in groups]
    vertical=[sum(pixels[x,y]<100 for y in range(0,height,2)) for x in range(width)]
    horizontal=[sum(pixels[x,y]<100 for x in range(0,width,2)) for y in range(height)]
    xs=peaks([x for x,value in enumerate(vertical) if value>max(vertical)*.8])
    ys=peaks([y for y,value in enumerate(horizontal) if value>max(horizontal)*.8])
    if 4<=len(xs)<=20 and 3<=len(ys)<=200:
     cells=[]
     for ri in range(len(ys)-1):
      cells.append([pytesseract.image_to_string(im.crop((xs[ci]+3,ys[ri]+3,xs[ci+1]-3,ys[ri+1]-3)),lang='kaz+rus',config='--psm 6',timeout=15).strip() for ci in range(len(xs)-1)])
     for ri,row in enumerate(cells):tables.append((row,source(page=pi+1,range=f'ocr-table/row:{ri+1}',method='ocr')))
    else:
     # Non-ruled or ambiguous scans stay visible for manual reconstruction.
     for line in text.splitlines():tables.append((re.split(r'\s*\|\s*|\t+| {2,}',line),source(page=pi+1,method='ocr')))
   else:
    extracted=plumber.pages[pi].extract_tables()
    if extracted:
     for ti,table in enumerate(extracted):
      for ri,cells in enumerate(table):tables.append((cells,source(page=pi+1,range=f'table:{ti+1}/row:{ri+1}')))
    else:
     for line in text.splitlines():tables.append((re.split(r'\s*\|\s*|\t+| {2,}',line),source(page=pi+1)))
 return tables

def extract(path,include_hidden=False):
 inspect(path);ext=Path(path).suffix.lower()
 tables=docx_tables(path) if ext=='.docx' else spreadsheets(path,include_hidden) if ext in ('.xls','.xlsx') else pdf_tables(path)
 return normalize(tables)

if __name__=='__main__':
 try:
  if '--inspect' in sys.argv:inspect(sys.argv[-1]);print('{"valid":true}')
  else:print(json.dumps(extract(sys.argv[1],'--include-hidden' in sys.argv),ensure_ascii=False))
 except Exception as e:
  code=str(e) if str(e) in ('FILE_SIZE','FILE_TYPE','OCR_UNAVAILABLE','FILE_INVALID') else 'FILE_INVALID'
  print('ZIYAT_ERROR:'+code,file=sys.stderr);sys.exit(1)
