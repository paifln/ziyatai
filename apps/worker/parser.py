"""Deterministic KTP adapters. Input is data, never instructions or executable code."""
import sys, os, json, re, uuid, zipfile, datetime, unicodedata, codecs
from pathlib import Path
from lxml import etree
from urllib.parse import unquote, urlsplit

MAX_EXPANDED = 100 * 1024 * 1024
MAX_COLUMNS = 200
MAX_CELLS = 100000
MAX_GRID_CELLS = 500000
MAX_RAW_ROWS = 10000


class BoundedTables(list):
 """Reject oversized extraction before retaining its cells in memory."""
 def __init__(self):
  super().__init__();self.cells=0;self.filled=0;self.characters=0
 def append(self,item):
  cells,_=item
  if len(cells)>MAX_COLUMNS or len(self)>=MAX_RAW_ROWS:raise ValueError('FILE_SIZE')
  lengths=[len(str(c)) if c is not None else 0 for c in cells]
  self.cells+=len(cells);self.filled+=sum(bool(n) for n in lengths);self.characters+=sum(lengths)
  if self.cells>MAX_GRID_CELLS or self.filled>MAX_CELLS or self.characters>2000000 or any(n>12000 for n in lengths):raise ValueError('FILE_SIZE')
  super().append(item)
HEADER = {
 'topic': ['тема урока','темы урока','темы уроков','тема','сабақтың тақырыбы','сабақ тақырыбы','тақырып','тақырыбы','theme','topic','lesson topic','lesson title'],
 'goals': ['цель обучения','цели обучения','учебные цели','оқу мақсаттары','оқу мақсаты','оқыту мақсаттары','learning objectives','learning objective'],
 'lessonGoals': ['цели урока','сабақ мақсаттары','lesson objectives','lesson objective'],
 'dateRaw': ['сроки','дата','дата проведения','мерзімі','күні','мерзімдер','date','dates'],
 'hours': ['количество часов','кол во часов','часы','сағат саны','сағат','hours','number of hours'],
 'lessonNumberRaw': ['№','No','no','no п/п','номер','номер урока','р/с','реті','n'],
 'section': ['раздел','раздел/ сквозные темы','бөлім','unit','units','units/ changing lessons','module'], 'notes': ['примечание','примечания','ескерту','notes','note'],
 'quarter': ['четверть','тоқсан','term','quarter'], 'grade': ['класс','сынып','grade']}

def grade_from_label(value, bare=False):
 text=clean(value)
 if re.search(r'(?:grades?\s*\d+\s*[-–]\s*\d+|\d+\s*[-–]\s*\d+\s*grades?)',text,re.I):return None
 if re.search(r'\d\s*[-–]\s*\d{1,2}\s*(?:класс|сынып)',text,re.I):return None
 match=re.search(r'(?<![^\W_])(1[01]|[1-9])\s*[-–]?\s*(?:класс(?:а|ы)?|сынып)(?![^\W\d_])',text,re.I) or re.search(r'(?:класс|сынып)\s*[:№-]?\s*(1[01]|[1-9])(?!\d)',text,re.I)
 if not match:match=re.search(r'\bgrade\s*[:№-]?\s*(1[01]|[1-9])(?!\d)',text,re.I) or re.search(r'\b(1[01]|[1-9])\s*(?:st|nd|rd|th)?\s*grade\b',text,re.I)
 if not match and bare:match=re.fullmatch(r'\s*(1[01]|[1-9])\s*[А-ЯӘҒҚҢӨҰҮҺІA-Z]?\s*',text,re.I)
 return int(match.group(1)) if match else None

def clean(value):
 return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', str(value or '')).replace('\x00','')).strip()

def header_map(cells):
 result={}
 for i, cell in enumerate(cells):
  text=clean(cell).lower().replace('-', ' ').replace('№','no').strip(' .:')
  for key, values in HEADER.items():
   if text in values or any(text.replace(' ','')==v.replace(' ','') for v in values) or any(text.startswith(v+' ') for v in values if len(v)>5):
    result.setdefault(key,i); break
 return result if 'topic' in result and ('goals' in result or 'hours' in result or 'dateRaw' in result) else {}

def normalize_date(raw):
 raw=clean(raw)
 warnings=[]
 if not raw:return None,None,['missing_date']
 matches=re.findall(r'(?<!\d)(?:(\d{1,2})[./](\d{1,2})[./](\d{4})|(\d{4})-(\d{2})-(\d{2}))(?!\d)',raw)
 try:
  dates=[datetime.date(int(y or iy),int(m or im),int(d or iday)).isoformat() for d,m,y,iy,im,iday in matches]
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
 rows=[];warnings=[];unrecognized=[];section='';quarter='';mapping={};last_sheet=None;grade=None
 for cells,source in tables:
  if source.get('sheet')!=last_sheet:
   mapping={};section='';quarter='';last_sheet=source.get('sheet');grade=grade_from_label(last_sheet or '',True)
  if not any(clean(c) for c in cells):continue
  discovered=header_map(cells)
  if discovered:mapping=discovered;continue
  joined=clean(' '.join(str(c or '') for c in cells))
  nonempty=list(dict.fromkeys(clean(c) for c in cells if clean(c)))
  heading_grade=grade_from_label(joined) if len(nonempty)<=2 else None
  if heading_grade and (not mapping or len(nonempty)==1):
   grade=heading_grade;continue
  if len(nonempty)==1 and (re.search(r'(четверть|тоқсан)',joined,re.I) or re.fullmatch(r'(?:term|quarter)\s*[1-4IVX]+',nonempty[0],re.I)):quarter=nonempty[0];continue
  if len(nonempty)==1 and not re.match(r'^\d+\s',joined):section=nonempty[0];unrecognized.append(nonempty[0]);continue
  if re.match(r'^(итого|барлығы|всего)\b',joined,re.I):continue
  if not mapping:unrecognized.append(joined);continue
  topic=clean(cells[mapping['topic']]) if mapping['topic']<len(cells) else ''
  if not topic:
   # Continuation is retained for teacher review, never silently attributed.
   unrecognized.append(joined);continue
  source['fragment']=joined[:12000]
  if 'section' in mapping and mapping['section']<len(cells) and clean(cells[mapping['section']]):section=clean(cells[mapping['section']])
  if 'quarter' in mapping and mapping['quarter']<len(cells) and clean(cells[mapping['quarter']]):quarter=clean(cells[mapping['quarter']])
  if len(rows)>=2000:raise ValueError('FILE_SIZE')
  rows.append(row_from(cells,mapping,source,len(rows)+1,section,quarter))
  grade_cell=cells[mapping['grade']] if 'grade' in mapping and mapping['grade']<len(cells) else ''
  rows[-1]['grade']=grade_from_label(grade_cell,True) or grade
  if len(rows)>2000:raise ValueError('FILE_SIZE')
 if not rows:warnings.append('no_lesson_rows_found')
 if unrecognized:warnings.append('unrecognized_fragments_require_review')
 return {'schemaVersion':'1.0','rows':rows,'warnings':warnings,'unrecognized':unrecognized,'parserVersion':'ktp-1.3'}

def inspect_pdf_catalog(document):
 from pdfminer.pdftypes import PDFObjRef,PDFStream
 forbidden_keys={'JS','JavaScript','AA','EmbeddedFiles','EF','AF','XFA','RichMediaContent','RichMediaSettings'}
 forbidden_actions={'JavaScript','Launch','SubmitForm','ImportData','GoToR','GoToE','Rendition','Movie','Sound'}
 pending=[(document.catalog,0,False)];seen=set();visited=0
 while pending:
  node,depth,automatic=pending.pop();visited+=1
  if visited>100000 or depth>100:raise ValueError('FILE_SIZE')
  if isinstance(node,PDFObjRef):
   # The same object may also be an automatic action; inspect that context
   # separately without following the cyclic Pages/Parent graph forever.
   identity=(node.objid,automatic)
   if identity in seen:continue
   seen.add(identity);pending.append((node.resolve(),depth+1,automatic));continue
  if isinstance(node,PDFStream):node=node.attrs
  if isinstance(node,dict):
   if forbidden_keys.intersection(node):raise ValueError('FILE_INVALID')
   action=getattr(node.get('S'),'name',None)
   if action in forbidden_actions or (automatic and action!='GoTo'):raise ValueError('FILE_INVALID')
   pending.extend((value,depth+1,key=='OpenAction') for key,value in node.items())
  elif isinstance(node,(list,tuple)):
   pending.extend((value,depth+1,False) for value in node)

def inspect_relationships(root):
 # Internal OPC relationships refer to package parts, never filesystem/network
 # URLs. Do not rely solely on a well-formed TargetMode="External" marker.
 for relation in root.iter():
  mode=relation.get('TargetMode')
  if mode is not None and mode!='Internal':raise ValueError('FILE_INVALID')
  if not isinstance(relation.tag,str) or relation.tag.rsplit('}',1)[-1]!='Relationship':continue
  target=relation.get('Target')
  if target is None:raise ValueError('FILE_INVALID')
  decoded=unquote(target)
  if '\\' in decoded or any(ord(character)<32 for character in decoded):raise ValueError('FILE_INVALID')
  try:location=urlsplit(decoded)
  except ValueError:raise ValueError('FILE_INVALID') from None
  if location.scheme or location.netloc:raise ValueError('FILE_INVALID')

def inspect(path):
 ext=Path(path).suffix.lower()
 if ext in ('.docx','.xlsx'):
  with zipfile.ZipFile(path) as z:
   entries=z.infolist()
   if len(entries)>10000 or sum(i.file_size for i in entries)>MAX_EXPANDED:raise ValueError('FILE_SIZE')
   names=[i.filename.replace('\\','/').lower() for i in entries]
   if len(names)!=len(set(names)):raise ValueError('FILE_INVALID')
   workbook_cells=0;workbook_merged=0;worksheet_count=0
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
     inspect_relationships(root)
     if ext=='.docx' and entry.filename.lower()=='word/document.xml':
      ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
      for span in root.iter('{'+ns+'}gridSpan'):
       width=int(span.get('{'+ns+'}val','1'))
       if not 1<=width<=MAX_COLUMNS:raise ValueError('FILE_SIZE')
     if ext=='.xlsx' and re.fullmatch(r'xl/worksheets/[^/]+\.xml',entry.filename,re.I):
      worksheet_count+=1
      if worksheet_count>20:raise ValueError('FILE_SIZE')
      ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
      workbook_cells+=sum(1 for _ in root.iter('{'+ns+'}c'))
      if workbook_cells>MAX_CELLS:raise ValueError('FILE_SIZE')
      # openpyxl allocates every merged cell during load, before adapter checks.
      from openpyxl.utils.cell import range_boundaries
      for merge in root.iter('{'+ns+'}mergeCell'):
       left,top,right,bottom=range_boundaries(merge.get('ref',''))
       if not all(v is not None for v in (left,top,right,bottom)) or min(left,top)<1 or right<left or bottom<top:raise ValueError('FILE_INVALID')
       workbook_merged+=(right-left+1)*(bottom-top+1)
       if workbook_merged>MAX_CELLS:raise ValueError('FILE_SIZE')
   required='word/document.xml' if ext=='.docx' else 'xl/workbook.xml'
   if required not in z.namelist():raise ValueError('FILE_INVALID')
 elif ext=='.pdf':
  import pdfplumber
  with pdfplumber.open(path) as d:
   if d.doc.encryption:raise ValueError('FILE_INVALID')
   if not len(d.pages):raise ValueError('FILE_INVALID')
   if len(d.pages)>150:raise ValueError('FILE_SIZE')
   inspect_pdf_catalog(d.doc)
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
 tables=BoundedTables();seen_paragraphs=set();logical_columns=None
 for ti,tbl in enumerate(root.xpath('//w:tbl',namespaces=ns)):
  table_rows=tbl.xpath('./w:tr',namespaces=ns)
  # Word may change its underlying grid between header/data or continuation
  # tables. If the logical cells stay consistent, index those rather than the
  # duplicated gridSpan slots (which can shift objectives into the hours column).
  for candidate in table_rows[:10]:
   header_cells=['\n'.join(''.join(p.xpath('.//w:t/text()',namespaces=ns)) for p in tc.xpath('./w:p',namespaces=ns)) for tc in candidate.xpath('./w:tc',namespaces=ns)]
   if header_map(header_cells):logical_columns=len(header_cells);break
  logical_layout=logical_columns is not None and all(len(tr.xpath('./w:tc',namespaces=ns)) in (0,1,logical_columns) for tr in table_rows)
  for paragraph in tbl.xpath('preceding-sibling::w:p',namespaces=ns):
   identity=root.getroottree().getpath(paragraph)
   if identity in seen_paragraphs:continue
   seen_paragraphs.add(identity)
   text=clean(' '.join(paragraph.xpath('.//w:t/text()',namespaces=ns)))
   if grade_from_label(text):tables.append(([text],source(range=f'heading:{len(seen_paragraphs)}')))
  vertical={}
  for ri,tr in enumerate(table_rows):
   cells=[];logical=[];col=0
   for tc in tr.xpath('./w:tc',namespaces=ns):
    text='\n'.join(''.join(p.xpath('.//w:t/text()',namespaces=ns)) for p in tc.xpath('./w:p',namespaces=ns))
    span=tc.xpath('./w:tcPr/w:gridSpan/@w:val',namespaces=ns);width=int(span[0]) if span else 1
    if not 1<=width<=MAX_COLUMNS or col+width>MAX_COLUMNS:raise ValueError('FILE_SIZE')
    vm=tc.xpath('./w:tcPr/w:vMerge',namespaces=ns)
    if vm and vm[0].get('{'+ns['w']+'}val')!='restart':text=vertical.get(col,text)
    elif vm:vertical[col]=text
    else:vertical.pop(col,None)
    logical.append(text);cells.extend([text]*width);col+=width
   tables.append((logical if logical_layout else cells,source(range=f'table:{ti+1}/row:{ri+1}')))
 return tables

def spreadsheets(path,include_hidden=False):
 ext=Path(path).suffix.lower();tables=BoundedTables();count=0;merged_count=0
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
    merged_count+=area.size['rows']*area.size['columns']
    if merged_count>MAX_CELLS:raise ValueError('FILE_SIZE')
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
   if sh.nrows*sh.ncols>MAX_GRID_CELLS:raise ValueError('FILE_SIZE')
   if sh.visibility and not include_hidden:
    tables.append(([f'Hidden sheet excluded: {sh.name}'],source(sheet=sh.name)));continue
   merged={}
   for rlo,rhi,clo,chi in sh.merged_cells:
    merged_count+=(rhi-rlo)*(chi-clo)
    if merged_count>MAX_CELLS:raise ValueError('FILE_SIZE')
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
 tables=BoundedTables()
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
