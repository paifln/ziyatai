"""Exercise the real serial renderer HTTP boundary with synthetic connections."""
import http.client
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import unittest


ROOT = Path(__file__).resolve().parents[2]
TOKEN = "synthetic-renderer-boundary-token-1234567890"


@unittest.skipUnless(hasattr(signal, "SIGALRM"), "Renderer runs on Linux with SIGALRM")
class RendererHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        code = """
import importlib.util, os, sys
from pathlib import Path
root = Path.cwd()
sys.path.insert(0, str(root / 'apps/worker'))
spec = importlib.util.spec_from_file_location('renderer', root / 'apps/renderer/server.py')
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)
renderer.Handler.header_timeout = 1
server = renderer.RendererServer(('127.0.0.1', 0), renderer.Handler)
print(server.server_port, flush=True)
server.serve_forever()
"""
        cls.process = subprocess.Popen(
            [sys.executable, "-c", code],
            cwd=ROOT,
            env={**os.environ, "RENDERER_TOKEN": TOKEN, "RENDERER_HOST": "127.0.0.1"},
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        cls.addClassCleanup(cls.stop_server)
        cls.port = int(cls.process.stdout.readline().strip())

    @classmethod
    def stop_server(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait(timeout=5)
        cls.process.stdout.close()

    def health(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=4)
        try:
            connection.request("GET", "/health")
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(response.read(), b'{"status":"ok"}')
        finally:
            connection.close()

    def assert_peer_closed(self, peer):
        try:
            self.assertEqual(peer.recv(1024), b"")
        except ConnectionResetError:
            # A hard close with unread trickled bytes can legally send RST.
            pass

    def test_idle_unauthenticated_connection_releases_serial_service(self):
        with socket.create_connection(("127.0.0.1", self.port), timeout=4) as peer:
            peer.sendall(b"POST /inspect HTTP/1.1\r\nHost: localhost\r\n")
            self.assert_peer_closed(peer)
        self.health()

    def test_trickled_headers_cannot_extend_total_header_deadline(self):
        with socket.create_connection(("127.0.0.1", self.port), timeout=4) as peer:
            peer.sendall(b"POST /inspect HTTP/1.1\r\nX-Slow: ")
            start = time.monotonic()
            for _ in range(7):
                time.sleep(0.2)
                try:
                    peer.sendall(b"x")
                except OSError:
                    break
            self.assert_peer_closed(peer)
            self.assertLess(time.monotonic() - start, 3)
        self.health()

    def test_rejects_ambiguous_lengths_and_transfer_encoding_before_body(self):
        for framing in (
            b"Content-Length: 1\r\nContent-Length: 1\r\n",
            b"Content-Length: 1\r\nContent-Length: 2\r\n",
            b"Content-Length: +1\r\n",
            b"Content-Length: 1\r\nTransfer-Encoding: chunked\r\n",
            b"Transfer-Encoding: chunked\r\n",
        ):
            with self.subTest(framing=framing):
                with socket.create_connection(("127.0.0.1", self.port), timeout=4) as peer:
                    peer.sendall(
                        b"POST /inspect HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer "
                        + TOKEN.encode() + b"\r\nX-Format: docx\r\n" + framing + b"\r\n"
                    )
                    response = http.client.HTTPResponse(peer)
                    response.begin()
                    self.assertEqual(response.status, 400)
                    response.read()
        self.health()


if __name__ == "__main__":
    unittest.main()
