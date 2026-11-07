"""Offline tests: protocol framing, GIF encoder/parser, renderers. No hardware needed.

Run:  python -m unittest discover -s tests      (from the python/ directory)
"""
import io
import struct
import sys
import unittest
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from act1033led import protocol as proto  # noqa: E402
from act1033led import render  # noqa: E402


class ProtocolTests(unittest.TestCase):
    def test_single_frame_header(self):
        data = b"GIF89a" + bytes(10)
        f = proto.build_frame(data, proto.TYPE_GIF)
        self.assertEqual(struct.unpack("<H", f[0:2])[0], len(data) + 15)
        self.assertEqual(f[2], 0x03)
        self.assertEqual(f[4], 0x00)
        self.assertEqual(struct.unpack("<I", f[5:9])[0], len(data))
        self.assertEqual(struct.unpack("<I", f[9:13])[0], zlib.crc32(data) & 0xFFFFFFFF)
        self.assertEqual(f[13:15], b"\x00\x65")
        self.assertEqual(f[15:], data)

    def test_segmentation(self):
        gif = bytes(range(256)) * 40          # 10240 B -> 3 segments
        segs = proto.gif_segments(gif)
        self.assertEqual(len(segs), 3)
        self.assertEqual([s[4] for s in segs], [0x00, 0x02, 0x02])
        for s in segs:                         # size and CRC always describe the whole file
            self.assertEqual(struct.unpack("<I", s[5:9])[0], len(gif))
            self.assertEqual(struct.unpack("<I", s[9:13])[0], zlib.crc32(gif) & 0xFFFFFFFF)
        self.assertEqual(b"".join(s[15:] for s in segs), gif)
        self.assertEqual(struct.unpack("<H", segs[-1][0:2])[0], len(gif) - 2 * 4096 + 15)

    def test_unique_tail_changes_crc(self):
        gif = render.demo_a()
        a, b = proto.with_unique_tail(gif), proto.with_unique_tail(gif)
        self.assertNotEqual(a, b)
        self.assertEqual(a[:len(gif)], gif)

    def test_notifications(self):
        c = proto.classify_notification
        self.assertEqual(c(bytes.fromhex("0B 00 01 80 83 06 32 00 00 01 00")), "stage1")
        self.assertEqual(c(bytes.fromhex("08 00 05 80 0E 02 07 04")), "stage2")
        self.assertEqual(c(bytes.fromhex("05 00 03 00 03")), "done")
        self.assertEqual(c(bytes.fromhex("05 00 03 00 01")), "ack")
        self.assertIsNone(c(b"\x01\x02"))


class RenderTests(unittest.TestCase):
    def test_gif_structure(self):
        for gif in (render.demo_a(), render.demo_b()):
            info = proto.inspect_gif(gif)
            self.assertTrue(info.ok, info.warnings)
            self.assertEqual((info.width, info.height, info.global_colors), (64, 16, 16))
            self.assertEqual(info.local_colors, [])

    def test_roundtrip_with_pillow(self):
        try:
            from PIL import Image, ImageSequence
        except ImportError:
            self.skipTest("Pillow not installed")
        frames, delays = render.text_frames("Zażółć gęślą jaźń", "scroll", 1, 5)
        pal = render.make_palette((0, 0, 0), (0, 255, 0))
        gif = render.encode_gif(frames, delays, pal)
        im = Image.open(io.BytesIO(gif))
        self.assertEqual(im.n_frames, len(frames))
        for n, fr in enumerate(ImageSequence.Iterator(im)):
            got = bytes(1 if p == (0, 255, 0) else 0 for p in fr.convert("RGB").getdata())
            self.assertEqual(got, frames[n], f"frame {n} differs")

    def test_lzw_large_frame_table_reset(self):
        # incompressible content forces the 4096-entry table to fill and reset
        import random
        rnd = random.Random(5)
        frames = [bytes(rnd.randrange(16) for _ in range(render.W * render.H)) for _ in range(6)]
        pal = [(i * 16, i * 8, 255 - i * 16) for i in range(16)]
        gif = render.encode_gif(frames, [5] * 6, pal)
        try:
            from PIL import Image, ImageSequence
        except ImportError:
            self.skipTest("Pillow not installed")
        im = Image.open(io.BytesIO(gif))
        for n, fr in enumerate(ImageSequence.Iterator(im)):
            self.assertEqual(fr.convert("RGB").tobytes(), b"".join(bytes(pal[i]) for i in frames[n]))

    def test_text_geometry(self):
        bm = render.text_bitmap("AB", 1)
        self.assertEqual((bm.w, bm.h), (11, 11))           # 5 + 1 + 5 wide, rows -2..8
        big = render.text_bitmap("AB", 2)
        self.assertEqual((big.w, big.h), (22, 14))
        frames, delays = render.text_frames("x", "static")
        self.assertEqual(len(frames), 2)

    def test_life_is_deterministic(self):
        a, ra = render.life_frames(60, 0.3, 42, True, True)
        b, rb = render.life_frames(60, 0.3, 42, True, True)
        self.assertEqual(a, b)
        self.assertEqual(ra, rb)
        c, _ = render.life_frames(60, 0.3, 43, True, True)
        self.assertNotEqual(a, c)
        self.assertTrue(all(len(f) == render.W * render.H for f in a))

    def test_life_blinker(self):
        # a vertical blinker becomes horizontal after one step (non-wrapping grid)
        g = [0] * 256
        for y in (3, 4, 5):
            g[y * 32 + 10] = 1
        n = render.life_step(g, False)
        self.assertEqual([i for i, v in enumerate(n) if v], [4 * 32 + 9, 4 * 32 + 10, 4 * 32 + 11])

    def test_fit_to_limit(self):
        frames, _ = render.life_frames(600, 0.3, 1)
        pal = render.make_palette()
        fit, size = render.fit_to_limit(frames, 10, pal, 20000)
        gif = render.encode_gif(frames[:fit], [10] * fit, pal)
        self.assertLessEqual(len(gif), 20000)
        self.assertEqual(len(gif), size)
        over = render.encode_gif(frames[:fit + 1], [10] * (fit + 1), pal)
        self.assertGreater(len(over), 20000)


if __name__ == "__main__":
    unittest.main()
