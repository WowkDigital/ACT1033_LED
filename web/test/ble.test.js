// The BLE frames must be byte-identical to the Python reference (python/act1033led/protocol.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildFrame, classify, crc32, gifSegments, withUniqueTail } from "../src/ble.js";

const hex = (b) => Buffer.from(b).toString("hex");
const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);

// reference values produced by protocol.gif_segments(bytes(range(256)) * 20 + b"\x3b")
const gif = Uint8Array.from({ length: 5121 }, (_, i) => (i === 5120 ? 0x3b : i % 256));

test("crc32 matches zlib", () => {
  assert.equal(crc32(gif), 0x6fd81fb3);
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("segments are byte-identical to the Python implementation", () => {
  const segs = gifSegments(gif);
  assert.equal(segs.length, 2);
  assert.deepEqual(segs.map((s) => s.length), [4111, 1040]);
  assert.equal(hex(segs[0].subarray(0, 15)), "0f1003000001140000b31fd86f0065");
  assert.equal(hex(segs[1].subarray(0, 15)), "100403000201140000b31fd86f0065");
  assert.deepEqual(segs.map(sha), ["a6941f60f0fe5468", "e6af71da4df13d81"]);
});

test("a single frame has its own length and CRC in the header", () => {
  const f = buildFrame(Uint8Array.of(1, 2, 3));
  assert.equal(f.length, 18);
  assert.equal(f[0], 18);
  assert.equal(f[14], 0x65);
});

test("unique tail goes after the trailer", () => {
  const out = withUniqueTail(Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x3b), Uint8Array.of(9, 9, 9, 9));
  assert.deepEqual([...out], [0x47, 0x49, 0x46, 0x38, 0x3b, 9, 9, 9, 9]);
});

test("notification classes", () => {
  assert.equal(classify(Uint8Array.of(0x0b, 0, 0x01, 0x80, 0x83, 6, 0x32, 0, 0, 1, 0)), "stage1");
  assert.equal(classify(Uint8Array.of(0x08, 0, 0x05, 0x80, 0x0e, 2, 7, 4)), "stage2");
  assert.equal(classify(Uint8Array.of(5, 0, 3, 0, 3)), "done");
  assert.equal(classify(Uint8Array.of(5, 0, 3, 0, 1)), "ack");
});
