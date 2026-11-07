"""Pure protocol helpers for the BK-Light panel (no I/O, no third-party imports).

See docs/PROTOCOL.md for the description of the frames and the measurements behind these constants.
"""
from __future__ import annotations

import os
import struct
import zlib
from dataclasses import dataclass, field

UUID_WRITE = "0000fa02-0000-1000-8000-00805f9b34fb"
UUID_NOTIFY = "0000fa03-0000-1000-8000-00805f9b34fb"

HANDSHAKE_1 = bytes.fromhex("08 00 01 80 0E 06 32 00")
HANDSHAKE_2 = bytes.fromhex("04 00 05 80")

TYPE_PNG = 0x02
TYPE_GIF = 0x03
MARKER = 0x65          # byte 14 of every frame; any other value breaks playback
SEGMENT = 4096         # data bytes per segment
CHUNK = 509            # bytes per BLE write
WIDTH, HEIGHT = 64, 16
NAME_PREFIX = "LED_BLE"


def with_unique_tail(gif: bytes, tail: bytes | None = None) -> bytes:
    """Append 4 random bytes after the GIF trailer (0x3B).

    The panel recognises a re-sent identical file (same size and CRC) and then corrupts the stored
    animation. Decoders ignore the bytes after the trailer, so this makes every upload unique.
    """
    return gif + (tail if tail is not None else os.urandom(4))


def build_frame(data: bytes, data_type: int, *, first: bool = True, total: bytes | None = None) -> bytes:
    """Build one frame (or one segment of a multi-segment transfer).

    ``data``   the bytes carried by this frame.
    ``total``  the complete file; its length and CRC32 go into the header of every segment.
               Defaults to ``data`` (single frame).
    """
    whole = data if total is None else total
    out = bytearray()
    out += struct.pack("<H", len(data) + 15)
    out.append(data_type)
    out += b"\x00"
    out.append(0x00 if first else 0x02)
    out += struct.pack("<I", len(whole))
    out += struct.pack("<I", zlib.crc32(whole) & 0xFFFFFFFF)
    out += bytes((0x00, MARKER))
    out += data
    return bytes(out)


def gif_segments(gif: bytes, segment: int = SEGMENT) -> list[bytes]:
    """Split a GIF into ready-to-send segment frames."""
    return [
        build_frame(gif[off:off + segment], TYPE_GIF, first=(off == 0), total=gif)
        for off in range(0, len(gif), segment)
    ]


def classify_notification(data: bytes) -> str | None:
    """Classify a notification from the panel: stage1, stage2, ack, done (complete) or None."""
    if len(data) >= 4 and data[2:4] == b"\x01\x80":
        return "stage1"
    if len(data) >= 4 and data[2:4] == b"\x05\x80":
        return "stage2"
    if len(data) == 5 and data[3] == 0x00:
        return "done" if data[4] == 0x03 else "ack"
    return None


@dataclass
class GifInfo:
    width: int = 0
    height: int = 0
    frames: int = 0
    global_colors: int = 0
    local_colors: list[int] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.warnings


def inspect_gif(gif: bytes) -> GifInfo:
    """Parse a GIF and report anything known to misbehave on the panel."""
    info = GifInfo()
    if gif[:4] != b"GIF8":
        info.warnings.append("not a GIF file")
        return info
    info.width, info.height = struct.unpack("<HH", gif[6:10])
    flags = gif[10]
    pos = 13
    if flags & 0x80:
        info.global_colors = 2 << (flags & 7)
        pos += 3 * info.global_colors
    while pos < len(gif):
        block = gif[pos]
        if block == 0x3B:
            break
        if block == 0x21:                                  # extension: skip its sub-blocks
            pos += 2
            while pos < len(gif) and gif[pos]:
                pos += gif[pos] + 1
            pos += 1
        elif block == 0x2C:                                # image descriptor
            info.frames += 1
            f = gif[pos + 9]
            pos += 10
            if f & 0x80:
                n = 2 << (f & 7)
                info.local_colors.append(n)
                pos += 3 * n
            pos += 1                                       # LZW minimum code size
            while pos < len(gif) and gif[pos]:
                pos += gif[pos] + 1
            pos += 1
        else:
            info.warnings.append(f"unexpected block 0x{block:02x}")
            break
    if (info.width, info.height) != (WIDTH, HEIGHT):
        info.warnings.append(f"size is {info.width}x{info.height}, the panel is {WIDTH}x{HEIGHT}")
    if info.local_colors and any(n != info.global_colors for n in info.local_colors):
        info.warnings.append("local colour tables differ in size from the global table "
                             "(can freeze the animation on the first frame)")
    if info.frames == 0:
        info.warnings.append("no frames")
    return info
