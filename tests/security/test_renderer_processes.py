"""The real production entry point must isolate alarms across worker processes."""
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import unittest
import http.client

ROOT = Path(__file__).resolve().parents[2]

@unittest.skipUnless(hasattr(signal, 'SIGALRM'), 'Renderer workers run on Linux')
class RendererProcessTests(unittest.TestCase):
    def test_pending_headers_do_not_block_the_second_process(self):
        with socket.socket() as reserve:
            reserve.bind(('127.0.0.1', 0))
            port = reserve.getsockname()[1]
        code = "import runpy,sys;sys.path.insert(0,'apps/worker');runpy.run_path('apps/renderer/server.py',run_name='__main__')"
        process = subprocess.Popen([sys.executable, '-c', code], cwd=ROOT,
            env={**os.environ, 'PORT':str(port), 'RENDERER_HOST':'127.0.0.1', 'RENDERER_PROCESSES':'2', 'RENDERER_TOKEN':'synthetic-process-isolation-token-12345'},
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline=time.monotonic()+10
            while True:
                try:
                    slow=socket.create_connection(('127.0.0.1',port),timeout=1)
                    break
                except OSError:
                    if time.monotonic()>deadline: self.fail('Renderer did not start')
                    time.sleep(.05)
            with slow:
                slow.sendall(b'POST /inspect HTTP/1.1\r\nHost: localhost\r\n')
                time.sleep(.1)
                connection=http.client.HTTPConnection('127.0.0.1',port,timeout=2)
                try:
                    connection.request('GET','/health')
                    response=connection.getresponse()
                    self.assertEqual(response.status,200)
                    response.read()
                finally: connection.close()
        finally:
            process.terminate()
            try: process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill();process.wait(timeout=3)
