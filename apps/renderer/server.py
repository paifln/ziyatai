"""Private, serial execution boundary: no DB, S3 or OpenAI credentials."""
import os,sys,json,tempfile,subprocess,hmac,signal,io,socket,time
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
 header_timeout=15
 def setup(self):
  super().setup()
  self.connection.settimeout(self.header_timeout)
 def handle_one_request(self):
  # The serial service must also bound unauthenticated header reads. Socket
  # inactivity alone does not stop a peer trickling one byte at a time.
  signal.alarm(self.header_timeout)
  try:super().handle_one_request()
  except (TimeoutError,ValueError):self.close_connection=True
  finally:signal.alarm(0)
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path=='/health':self.send_response(200);self.end_headers();self.wfile.write(b'{"status":"ok"}')
  else:self.send_response(404);self.end_headers()
 def do_POST(self):
  if not hmac.compare_digest(self.headers.get('Authorization','').encode('utf-8'),('Bearer '+token).encode('utf-8')):self.send_response(401);self.end_headers();return
  if self.path not in ('/inspect','/parse','/preview','/render'):self.send_response(404);self.end_headers();return
  lengths=self.headers.get_all('Content-Length',[])
  if self.headers.get_all('Transfer-Encoding') or len(lengths)!=1 or not lengths[0].isascii() or not lengths[0].isdigit():self.send_response(400);self.end_headers();return
  try:size=int(lengths[0])
  except ValueError:self.send_response(400);self.end_headers();return
  if not 0<size<=MAX_BYTES:self.send_response(413);self.end_headers();return
  ext=self.headers.get('X-Format','');font=self.headers.get('X-Font','Times New Roman')
  if ext not in ('pdf','docx','xls','xlsx') or font not in ('Times New Roman','Arial','Calibri','Liberation Serif','Liberation Sans','Carlito'):self.send_response(415);self.end_headers();return
  try:
   started=time.monotonic();phase='inspect'
   self.connection.settimeout(15)
   signal.alarm(240)
   with tempfile.TemporaryDirectory(prefix='ziyatai-sandbox-') as tmp:
    body=self.rfile.read(size)
    if len(body)!=size:raise ValueError('FILE_INVALID')
    path=Path(tmp)/('source.'+ext);path.write_bytes(body);inspect(path)
    if self.path=='/inspect':payload=b'{"valid":true}';mime='application/json'
    elif self.path=='/parse':
     phase='parse';payload=json.dumps(extract(path,self.headers.get('X-Include-Hidden')=='true'),ensure_ascii=False).encode();mime='application/json'
    elif self.path=='/preview' and ext=='pdf':
     from pdf_adapter import preview_page
     page_number=int(self.headers.get('X-Page','1'))
     with preview_page(path,page_number-1) as image:
      buffer=io.BytesIO();image.save(buffer,format='PNG');payload=buffer.getvalue();mime='image/png'
    elif self.path=='/render' and ext=='docx':
     phase='font_match'
     match=subprocess.check_output(['fc-match','-f','%{family}',font],timeout=30).decode()
     if font not in match:raise ValueError('FONT_UNAVAILABLE')
     phase='convert'
     subprocess.run(['libreoffice','-env:UserInstallation=file://'+tmp+'/lo-profile','--headless','--convert-to','pdf','--outdir',tmp,str(path)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=100,env={'PATH':os.environ.get('PATH',''),'HOME':tmp,'LANG':'C.UTF-8'})
     payload=(Path(tmp)/'source.pdf').read_bytes();mime='application/pdf'
     phase='pdf_validation'
     import pdfplumber
     with pdfplumber.open(io.BytesIO(payload)) as document:
      if not len(document.pages) or not any((page.extract_text() or '').strip() for page in document.pages):raise ValueError('RENDER_UNAVAILABLE')
    else:self.send_response(404);self.end_headers();return
   self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
  except Exception as e:
   print(json.dumps({'operation':self.path[1:],'phase':phase,'outcome':'failed','errorType':type(e).__name__,'durationMs':round((time.monotonic()-started)*1000)}),file=sys.stderr,flush=True)
   safe=str(e) if str(e) in ('FILE_INVALID','FILE_SIZE','OCR_UNAVAILABLE','FONT_UNAVAILABLE') else 'RENDER_UNAVAILABLE' if self.path=='/render' else 'FILE_INVALID'
   payload=json.dumps({'code':safe}).encode();self.send_response(413 if safe=='FILE_SIZE' else 422);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(payload)
  finally:signal.alarm(0)
host=os.environ.get('RENDERER_HOST','::' if socket.has_dualstack_ipv6() else '0.0.0.0')
class RendererServer(HTTPServer):
 address_family=socket.AF_INET6 if ':' in host else socket.AF_INET
 def server_bind(self):
  if self.address_family==socket.AF_INET6 and socket.has_dualstack_ipv6():
   self.socket.setsockopt(socket.IPPROTO_IPV6,socket.IPV6_V6ONLY,0)
  super().server_bind()
if __name__=='__main__':
 RendererServer((host,int(os.environ.get('PORT','8090'))),Handler).serve_forever()
