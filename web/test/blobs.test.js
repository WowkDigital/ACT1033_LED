import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTES, quantize } from "../src/blobs.js";

test("every preset fits a 16-colour GIF table", () => {
  for (const p of Object.values(PALETTES)) assert.ok(1 + p.rings.length <= 16);
});

test("quantize votes per block and returns only palette colours", () => {
  const pal = { bg: 0x000000, rings: [0xff0000, 0x0000ff] };
  const scale = 2, full = 64 * scale;
  const rgba = new Uint8ClampedArray(full * 16 * scale * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba[i + 3] = 255;
  const set = (x, y, r, g, b) => { const o = (y * full + x) * 4; rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; };
  for (const [x, y] of [[0, 0], [1, 0], [0, 1]]) set(x, y, 250, 10, 10); // 3 of 4 pixels reddish
  const f = quantize(rgba, scale, pal);
  assert.equal(f[0], 0xff0000);
  assert.equal(f[1], 0x000000);
  assert.ok(f.every((v) => v === 0 || v === 0xff0000 || v === 0x0000ff));
});
