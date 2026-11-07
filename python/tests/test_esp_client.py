"""Tests for the ESP32 HTTP client against a local fake of the ESP firmware's API."""
import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from act1033led import render  # noqa: E402
from act1033led.esp import Esp, EspError  # noqa: E402


class FakeEsp(BaseHTTPRequestHandler):
    uploads = []
    polls = 0
    busy = False

    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/status"):
            FakeEsp.polls += 1
            running = FakeEsp.polls < 3 and bool(FakeEsp.uploads)
            self._json(200, {"seq": FakeEsp.polls, "log": [{"i": FakeEsp.polls, "t": 0, "l": "i", "m": f"poll {FakeEsp.polls}"}],
                             "job": {"running": running, "pending": False, "phase": "send", "pct": 50},
                             "last": {"ok": True, "msg": "OK", "ago_s": 0}})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        n = int(self.headers["Content-Length"])
        body = self.rfile.read(n)
        if FakeEsp.busy:
            return self._json(409, {"error": "panel is busy"})
        ctype = self.headers["Content-Type"]
        boundary = ctype.split("boundary=")[1].encode()
        part = body.split(b"--" + boundary)[1]
        head, data = part.split(b"\r\n\r\n", 1)
        FakeEsp.uploads.append((head.decode(), data[:-2]))     # strip the trailing CRLF
        self._json(202, {"ok": True})


class EspClientTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), FakeEsp)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        FakeEsp.uploads, FakeEsp.polls, FakeEsp.busy = [], 0, False

    def test_upload_and_wait(self):
        gif = render.demo_a()
        esp = Esp(f"127.0.0.1:{self.port}")
        logs = []
        self.assertTrue(esp.send_gif(gif, "demo a", log=logs.append))
        head, data = FakeEsp.uploads[0]
        self.assertIn('name="gif"', head)
        self.assertIn('filename="demo a"', head)
        self.assertEqual(data, gif)                            # the bytes arrive unchanged
        self.assertTrue(logs)

    def test_busy_is_reported(self):
        FakeEsp.busy = True
        with self.assertRaises(EspError) as cm:
            Esp(f"127.0.0.1:{self.port}").upload_gif(render.demo_b())
        self.assertIn("busy", str(cm.exception))

    def test_unreachable(self):
        with self.assertRaises(EspError):
            Esp("127.0.0.1:1", timeout=0.5).status()


if __name__ == "__main__":
    unittest.main()
