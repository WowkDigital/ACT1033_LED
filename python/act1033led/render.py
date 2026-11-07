"""Frame rendering and GIF encoding for the 64x16 panel (no third-party dependencies).

Everything here mirrors the JavaScript in esp32/src/web.h, so the same text / seed / settings produce
the same animation from the web page and from Python.

A "frame" is ``bytes`` of length 64*16 holding palette indices; the palette has 16 entries, which keeps
the GIF layout the panel is known to accept (one global colour table of 16, no local tables).
"""
from __future__ import annotations

from typing import Callable

from . import font

W, H = 64, 16
LIMIT = 64 * 1024                       # what the ESP firmware accepts
LIFE_MAX = 600                          # longest Game of Life animation that is simulated

# (pixels per frame, delay in 1/100 s) for speeds 1..5
SPEEDS = [(1, 10), (1, 6), (1, 4), (1, 3), (2, 5)]


# ---------------------------------------------------------------- colours / palette
def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    if len(value) != 6:
        raise ValueError(f"colour must be RRGGBB, got {value!r}")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def make_palette(bg=(0, 0, 0), fg=(0, 255, 0)) -> list[tuple[int, int, int]]:
    """16-entry palette: index 0 = background, 1 = foreground."""
    return [tuple(bg), tuple(fg)] + [(0, 0, 0)] * 14


# ---------------------------------------------------------------- GIF encoder
def lzw(pixels: bytes, min_code: int = 4) -> bytes:
    """GIF LZW compression of palette indices."""
    clear, eoi = 1 << min_code, (1 << min_code) + 1
    size, nxt = min_code + 1, eoi + 1
    out = bytearray()
    cur = nb = 0
    table: dict[int, int] = {}

    def emit(code: int) -> None:
        nonlocal cur, nb
        cur |= code << nb
        nb += size
        while nb >= 8:
            out.append(cur & 0xFF)
            cur >>= 8
            nb -= 8

    emit(clear)
    prefix = pixels[0]
    for k in pixels[1:]:
        key = (prefix << 8) | k
        hit = table.get(key)
        if hit is not None:
            prefix = hit
            continue
        emit(prefix)
        table[key] = nxt
        nxt += 1
        if nxt > (1 << size) and size < 12:
            size += 1
        if nxt >= 4096:
            emit(clear)
            table.clear()
            size, nxt = min_code + 1, eoi + 1
        prefix = k
    emit(prefix)
    nxt += 1
    if nxt > (1 << size) and size < 12:
        size += 1
    emit(eoi)
    if nb > 0:
        out.append(cur & 0xFF)
    return bytes(out)


def gif_header(palette) -> bytes:
    b = bytearray(b"GIF89a")
    b += W.to_bytes(2, "little") + H.to_bytes(2, "little")
    b += bytes((0xF3, 0, 0))                          # global table of 16 colours
    for i in range(16):
        b += bytes(palette[i] if i < len(palette) else (0, 0, 0))
    b += bytes((0x21, 0xFF, 0x0B)) + b"NETSCAPE2.0" + bytes((3, 1, 0, 0, 0))   # loop forever
    return bytes(b)


def frame_block(frame: bytes, delay_cs: int) -> bytes:
    b = bytearray((0x21, 0xF9, 4, 0x04))
    b += delay_cs.to_bytes(2, "little") + bytes((0, 0))
    b += bytes((0x2C, 0, 0, 0, 0)) + W.to_bytes(2, "little") + H.to_bytes(2, "little") + bytes((0, 4))
    data = lzw(frame, 4)
    for o in range(0, len(data), 255):
        part = data[o:o + 255]
        b.append(len(part))
        b += part
    b.append(0)
    return bytes(b)


def encode_gif(frames: list[bytes], delays_cs: list[int], palette) -> bytes:
    out = bytearray(gif_header(palette))
    for f, d in zip(frames, delays_cs):
        out += frame_block(f, d)
    out.append(0x3B)
    return bytes(out)


def fit_to_limit(frames: list[bytes], delay_cs: int, palette, limit: int = LIMIT) -> tuple[int, int]:
    """Return (frames_that_fit, resulting_size) for a constant frame delay."""
    total = len(gif_header(palette)) + 1
    fit = 0
    for f in frames:
        size = len(frame_block(f, delay_cs))
        if total + size > limit:
            break
        total += size
        fit += 1
    return fit, total


# ---------------------------------------------------------------- text
class Bitmap:
    def __init__(self, w: int, h: int, px: bytearray) -> None:
        self.w, self.h, self.px = w, h, px


def text_bitmap(text: str, scale: int = 1) -> Bitmap:
    """Render text with the 5x7 font. scale=2 gives 10x14 glyphs without diacritics."""
    top, bottom = (-2, 8) if scale == 1 else (0, 6)
    h = (bottom - top + 1) * scale
    items, x = [], 0
    for ch in text.replace("\n", " "):
        if scale != 1 and ch in font.BASE:
            ch = font.BASE[ch]
        width, rows = font.GLYPHS.get(ch) or font.GLYPHS["?"]
        items.append((x, rows))
        x += (width + 1) * scale
    w = max(1, x - scale)
    px = bytearray(w * h)
    for gx, rows in items:
        for y, row in rows.items():
            if y < top or y > bottom:
                continue
            for cx, c in enumerate(row):
                if c != "#":
                    continue
                for dy in range(scale):
                    for dx in range(scale):
                        xx, yy = gx + cx * scale + dx, (y - top) * scale + dy
                        if xx < w and yy < h:
                            px[yy * w + xx] = 1
    return Bitmap(w, h, px)


def blit(bm: Bitmap, x_off: int) -> bytes:
    f = bytearray(W * H)
    y_off = (H - bm.h) // 2
    for y in range(bm.h):
        for x in range(bm.w):
            X, Y = x + x_off, y + y_off
            if bm.px[y * bm.w + x] and 0 <= X < W and 0 <= Y < H:
                f[Y * W + X] = 1
    return bytes(f)


def text_frames(text: str, mode: str = "scroll", scale: int = 1, speed: int = 3) -> tuple[list[bytes], list[int]]:
    """Frames and per-frame delays (1/100 s) for static / scroll / blink text."""
    bm = text_bitmap(text or " ", scale)
    if mode == "static" and bm.w > W:
        mode = "scroll"                                # does not fit -> scroll instead
    if mode == "static":
        f = blit(bm, (W - bm.w) // 2)
        return [f, f], [100, 100]
    if mode == "blink":
        return [blit(bm, (W - bm.w) // 2), bytes(W * H)], [60, 40]
    step, delay = SPEEDS[max(1, min(5, speed)) - 1]
    xs = range(W, -bm.w - 1, -step)
    return [blit(bm, x) for x in xs], [delay] * len(xs)


# ---------------------------------------------------------------- Game of Life
def mulberry32(seed: int) -> Callable[[], float]:
    a = seed & 0xFFFFFFFF
    M = 0xFFFFFFFF

    def rnd() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & M
        t = ((a ^ (a >> 15)) * (1 | a)) & M
        t = (((t + (((t ^ (t >> 7)) * (61 | t)) & M)) & M) ^ t) & M
        return ((t ^ (t >> 14)) & M) / 4294967296

    return rnd


def life_step(g: list[int], wrap: bool) -> list[int]:
    gw, gh = 32, 8
    out = [0] * (gw * gh)
    for y in range(gh):
        for x in range(gw):
            s = 0
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if not dx and not dy:
                        continue
                    yy, xx = y + dy, x + dx
                    if wrap:
                        yy, xx = yy % gh, xx % gw
                    elif not (0 <= yy < gh and 0 <= xx < gw):
                        continue
                    s += g[yy * gw + xx]
            out[y * gw + x] = 1 if (g[y * gw + x] and s in (2, 3)) or (not g[y * gw + x] and s == 3) else 0
    return out


def life_frames(n: int, density: float = 0.30, seed: int = 1, wrap: bool = True,
                reseed: bool = True) -> tuple[list[bytes], int]:
    """Simulate Conway's Game of Life on a 32x8 grid (2x2 px cells). Returns (frames, reseed_count)."""
    gw, gh = 32, 8
    rnd = mulberry32(seed)
    g = [0] * (gw * gh)
    hist: list[int] = []
    reseeds = 0

    def sow() -> None:
        nonlocal hist
        for i in range(len(g)):
            g[i] = 1 if rnd() < density else 0
        hist = []

    def digest(a) -> int:
        h = 2166136261
        for v in a:
            h = ((h ^ v) * 16777619) & 0xFFFFFFFF
        return h

    sow()
    frames: list[bytes] = []
    for _ in range(n):
        f = bytearray(W * H)
        for y in range(H):
            for x in range(W):
                f[y * W + x] = g[(y >> 1) * gw + (x >> 1)]
        frames.append(bytes(f))
        g[:] = life_step(g, wrap)
        h = digest(g)
        if reseed and (h in hist or not any(g)):
            sow()
            reseeds += 1
        else:
            hist.append(h)
            if len(hist) > 4:
                hist.pop(0)
    return frames, reseeds


# ---------------------------------------------------------------- built-in demos (same as the ESP's A and B)
DEMO_PALETTE = [(0, 0, 0), (0, 90, 0), (90, 0, 0), (0, 0, 90), (90, 90, 0), (90, 0, 90), (0, 90, 90),
                (90, 90, 90), (0, 40, 0), (40, 0, 0), (0, 0, 40), (40, 40, 0), (40, 0, 40), (0, 40, 40),
                (40, 40, 40), (120, 120, 120)]


def demo_a() -> bytes:
    """A green bar sweeps to the right; white lines at the top and bottom."""
    frames = []
    for i in range(32):
        f = bytearray(W * H)
        x0 = int(i * (W - 8) / 31)
        for y in range(2, H - 2):
            for x in range(x0, x0 + 8):
                f[y * W + x] = 1
        for x in range(W):
            f[x] = f[(H - 1) * W + x] = 15
        frames.append(bytes(f))
    return encode_gif(frames, [8] * len(frames), DEMO_PALETTE)


def demo_b() -> bytes:
    """A blinking red/blue checkerboard."""
    frames = []
    for i in range(8):
        f = bytearray(W * H)
        for y in range(H):
            for x in range(W):
                if (x // 4 + y // 4 + i // 4) % 2 == 0:
                    f[y * W + x] = 2 if i % 2 == 0 else 3
        frames.append(bytes(f))
    return encode_gif(frames, [25] * len(frames), DEMO_PALETTE)


# ---------------------------------------------------------------- arbitrary GIF -> panel-friendly GIF
def normalize_gif(data: bytes) -> bytes:
    """Re-encode any GIF to 64x16 with one shared 16-colour palette (requires Pillow)."""
    from PIL import Image, ImageSequence

    src = Image.open(__import__("io").BytesIO(data))
    frames, delays = [], []
    for fr in ImageSequence.Iterator(src):
        im = fr.convert("RGB")
        if im.size != (W, H):
            im = im.resize((W, H), Image.Resampling.NEAREST)
        frames.append(im)
        delays.append(max(1, round(fr.info.get("duration", 100) / 10)))
    sheet = Image.new("RGB", (W, H * len(frames)))
    for i, im in enumerate(frames):
        sheet.paste(im, (0, i * H))
    pal_img = sheet.quantize(colors=16, dither=Image.Dither.NONE)
    flat = pal_img.getpalette()[:48]
    palette = [tuple(flat[i:i + 3]) for i in range(0, 48, 3)]
    indexed = [im.quantize(palette=pal_img, dither=Image.Dither.NONE).tobytes() for im in frames]
    return encode_gif(indexed, delays, palette)
