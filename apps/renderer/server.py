"""Private, serial execution boundary: no DB, S3 or OpenAI credentials."""
import os,sys,json,tempfile,subprocess,hmac,signal,io
from pathlib import Path
from http.server import HTTPServer,BaseHTTPRequestHandler
sys.path.insert(0,'/scripts')
from parser import inspect,extract
MAX_BYTES=26*1024*1024
token=os.environ['RENDERER_TOKEN']
if len(token)<32:raise RuntimeError('Renderer token must contain at least 32 characters')
def deadline(signum,frame):raise ValueError('OCR_UNAVAILABLE')
signal.signal(signal.SIGALRM,deadline)
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path=='/health':self.send_response(200);self.end_headers();self.wfile.write(b'{"status":"ok"}')
  else:self.send_response(404);self.end_headers()
 def do_POST(self):
  if not hmac.compare_digest(self.headers.get('Authorization','').encode('utf-8'),('Bearer '+token).encode('utf-8')):self.send_response(401);self.end_headers();return
  if self.path not in ('/inspect','/parse','/preview','/render'):self.send_response(404);self.end_headers();return
  try:size=int(self.headers.get('Content-Length','0'))
  except ValueError:self.send_response(400);self.end_headers();return
  if not 0<size<=MAX_BYTES:self.send_response(413);self.end_headers();return
  ext=self.headers.get('X-Format','');font=self.headers.get('X-Font','Times New Roman')
  if ext not in ('pdf','docx','xls','xlsx') or font not in ('Times New Roman','Arial','Calibri'):self.send_response(415);self.end_headers();return
  try:
   self.connection.settimeout(15)
   signal.alarm(240)
   with tempfile.TemporaryDirectory(prefix='ziyatai-sandbox-') as tmp:
    body=self.rfile.read(size)
    if len(body)!=size:raise ValueError('FILE_INVALID')
    path=Path(tmp)/('source.'+ext);path.write_bytes(body);inspect(path)
    if self.path=='/inspect':payload=b'{"valid":true}';mime='application/json'
    elif self.path=='/parse':payload=json.dumps(extract(path,self.headers.get('X-Include-Hidden')=='true'),ensure_ascii=False).encode();mime='application/json'
    elif self.path=='/preview' and ext=='pdf':
     from pdf_adapter import preview_page
     page_number=int(self.headers.get('X-Page','1'))
     with preview_page(path,page_number-1) as image:
      buffer=io.BytesIO();image.save(buffer,format='PNG');payload=buffer.getvalue();mime='image/png'
    elif self.path=='/render' and ext=='docx':
     match=subprocess.check_output(['fc-match','-f','%{family}',font],timeout=10).decode()
     if font not in match:raise ValueError('FONT_UNAVAILABLE')
     subprocess.run(['libreoffice','-env:UserInstallation=file://'+tmp+'/lo-profile','--headless','--convert-to','pdf','--outdir',tmp,str(path)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=100,env={'PATH':os.environ.get('PATH',''),'HOME':tmp,'LANG':'C.UTF-8'})
     payload=(Path(tmp)/'source.pdf').read_bytes();mime='application/pdf'
     import pdfplumber
     with pdfplumber.open(io.BytesIO(payload)) as document:
      if not len(document.pages) or not any((page.extract_text() or '').strip() for page in document.pages):raise ValueError('RENDER_UNAVAILABLE')
    else:self.send_response(404);self.end_headers();return
   self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
  except Exception as e:
   safe=str(e) if str(e) in ('FILE_INVALID','FILE_SIZE','OCR_UNAVAILABLE','FONT_UNAVAILABLE') else 'RENDER_UNAVAILABLE' if self.path=='/render' else 'FILE_INVALID'
   payload=json.dumps({'code':safe}).encode();self.send_response(413 if safe=='FILE_SIZE' else 422);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(payload)
  finally:signal.alarm(0)
HTTPServer(('0.0.0.0',8090),Handler).serve_forever()
