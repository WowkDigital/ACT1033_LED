"""Direct BLE control of the panel from a PC (Windows, macOS, Linux) using bleak."""
from __future__ import annotations

import asyncio
from typing import Callable, Optional

from bleak import BleakClient, BleakScanner

from . import protocol as proto

Log = Callable[[str], None]


async def scan(timeout: float = 8.0, prefix: str = proto.NAME_PREFIX, show_all: bool = False):
    """Return ``[(address, name, rssi)]`` sorted by signal strength."""
    found = await BleakScanner.discover(timeout=timeout, return_adv=True)
    rows = []
    for dev, adv in found.values():
        name = dev.name or adv.local_name or ""
        if show_all or name.startswith(prefix):
            rows.append((dev.address, name, adv.rssi))
    return sorted(rows, key=lambda r: -r[2])


class Panel:
    """Async context manager: ``async with Panel(address) as p: await p.send_gif(data)``."""

    def __init__(self, address: Optional[str] = None, *, name_prefix: str = proto.NAME_PREFIX,
                 scan_timeout: float = 8.0, chunk: int = proto.CHUNK, chunk_delay: float = 0.01,
                 log: Log = lambda _msg: None) -> None:
        self.address = address
        self.name_prefix = name_prefix
        self.scan_timeout = scan_timeout
        self.chunk = chunk
        self.chunk_delay = chunk_delay
        self.log = log
        self.client: Optional[BleakClient] = None
        self._ev = {k: asyncio.Event() for k in ("stage1", "stage2", "ack", "done")}

    # ---- connection ----
    async def _find(self):
        if self.address:
            dev = await BleakScanner.find_device_by_address(self.address, timeout=self.scan_timeout)
            if dev is None:
                raise ConnectionError(f"panel {self.address} not found (powered on, in range, "
                                      f"not connected to a phone?)")
            return dev
        rows = await scan(self.scan_timeout, self.name_prefix)
        if not rows:
            raise ConnectionError(f"no '{self.name_prefix}*' device found")
        self.log(f"found {rows[0][1]} ({rows[0][0]}, RSSI {rows[0][2]} dBm)")
        return await BleakScanner.find_device_by_address(rows[0][0], timeout=self.scan_timeout)

    def _on_notify(self, _handle, data: bytearray) -> None:
        kind = proto.classify_notification(bytes(data))
        self.log("panel: " + bytes(data).hex(" "))
        if kind:
            self._ev[kind].set()
            if kind == "done":
                self._ev["ack"].set()

    async def connect(self) -> None:
        dev = await self._find()
        self.client = BleakClient(dev)
        await self.client.connect()
        await self.client.start_notify(proto.UUID_NOTIFY, self._on_notify)
        self.log("connected")

    async def disconnect(self) -> None:
        if self.client and self.client.is_connected:
            try:
                await self.client.stop_notify(proto.UUID_NOTIFY)
            except Exception:
                pass
            await self.client.disconnect()
        self.client = None

    async def __aenter__(self) -> "Panel":
        await self.connect()
        return self

    async def __aexit__(self, *exc) -> None:
        await self.disconnect()

    # ---- transfer ----
    async def _wait(self, name: str, timeout: float) -> bool:
        try:
            await asyncio.wait_for(self._ev[name].wait(), timeout)
            return True
        except asyncio.TimeoutError:
            return False

    async def _write(self, data: bytes) -> None:
        for i in range(0, len(data), self.chunk):
            await self.client.write_gatt_char(proto.UUID_WRITE, data[i:i + self.chunk], response=False)
            await asyncio.sleep(self.chunk_delay)

    async def handshake(self) -> None:
        for ev in self._ev.values():
            ev.clear()
        await self.client.write_gatt_char(proto.UUID_WRITE, proto.HANDSHAKE_1, response=False)
        if not await self._wait("stage1", 5):
            self.log("handshake 1: no reply (continuing)")
        await asyncio.sleep(0.2)
        await self.client.write_gatt_char(proto.UUID_WRITE, proto.HANDSHAKE_2, response=False)
        if not await self._wait("stage2", 5):
            self.log("handshake 2: no reply (continuing)")
        await asyncio.sleep(0.2)

    async def send_gif(self, gif: bytes, *, unique: bool = True, max_size: int = 512 * 1024,
                       progress: Optional[Callable[[int, int], None]] = None) -> bool:
        """Upload a GIF (it stays in the panel and keeps playing). True when the panel confirmed it."""
        if gif[:4] != b"GIF8":
            raise ValueError("not a GIF file")
        if unique:
            gif = proto.with_unique_tail(gif)
        if len(gif) > max_size:
            raise ValueError(f"GIF is {len(gif)} B, the limit is {max_size} B")
        frames = proto.gif_segments(gif)
        await self.handshake()
        for k, frame in enumerate(frames):
            self._ev["ack"].clear()
            await self._write(frame)
            self.log(f"segment {k + 1}/{len(frames)} sent ({len(frame)} B)")
            if progress:
                progress(k + 1, len(frames))
            if k < len(frames) - 1:
                await self._wait("ack", 2)
        ok = await self._wait("done", 6)
        await asyncio.sleep(0.5)
        return ok
