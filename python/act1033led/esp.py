"""Control the panel through the ESP32 bridge over HTTP (standard library only)."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
import uuid


class EspError(RuntimeError):
    pass


class Esp:
    def __init__(self, host: str, timeout: float = 10.0) -> None:
        self.base = host if host.startswith("http") else f"http://{host}"
        self.base = self.base.rstrip("/")
        self.timeout = timeout

    def _request(self, req: urllib.request.Request) -> dict:
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return json.loads(r.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read().decode()).get("error", "")
            except Exception:
                msg = ""
            raise EspError(f"HTTP {e.code}: {msg or e.reason}") from None
        except urllib.error.URLError as e:
            raise EspError(f"cannot reach the ESP at {self.base}: {e.reason}") from None

    def status(self, since: int = 0) -> dict:
        return self._request(urllib.request.Request(f"{self.base}/status?since={since}"))

    def demo(self, name: str) -> dict:
        return self._request(urllib.request.Request(f"{self.base}/demo?n={name}"))

    def upload_gif(self, gif: bytes, name: str = "upload.gif") -> dict:
        """Queue a GIF on the ESP (returns as soon as it is accepted)."""
        boundary = uuid.uuid4().hex
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"gif\"; filename=\"{name}\"\r\n"
                f"Content-Type: image/gif\r\n\r\n").encode() + gif + f"\r\n--{boundary}--\r\n".encode()
        req = urllib.request.Request(f"{self.base}/gif", data=body, method="POST",
                                     headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
        return self._request(req)

    def wait_idle(self, timeout: float = 120.0, log=lambda _m: None) -> dict:
        """Poll /status until the current job finishes; return the final status."""
        seen = 0
        deadline = time.time() + timeout
        time.sleep(0.5)
        while time.time() < deadline:
            try:
                s = self.status(seen)
            except EspError:
                time.sleep(1.0)       # the ESP does not answer while it connects over BLE
                continue
            for e in s["log"]:
                log(e["m"])
            seen = s["seq"]
            if not s["job"]["running"] and not s["job"]["pending"]:
                return s
            time.sleep(0.7)
        raise EspError("timed out waiting for the ESP")

    def send_gif(self, gif: bytes, name: str = "upload.gif", log=lambda _m: None) -> bool:
        """Upload a GIF and wait for the panel's confirmation. True on success."""
        self.upload_gif(gif, name)
        return bool(self.wait_idle(log=log)["last"]["ok"])
