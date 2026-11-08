// The browser's Game of Life must match python/act1033led/render.py frame for frame.
// Expected values come from: life_frames(40, density, seed, wrap, True) -> sha256 of all frames, number of live pixels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lifeFrames } from "../src/life.js";

function digest(frames) {
  const bytes = Buffer.concat(frames.map((f) => Buffer.from(f.map((v) => (v ? 1 : 0)))));
  return [createHash("sha256").update(bytes).digest("hex").slice(0, 16), frames.reduce((n, f) => n + f.filter(Boolean).length, 0)];
}

test("matches Python: seed 1, density 0.30, wrap", () => {
  assert.deepEqual(digest(lifeFrames(40, { density: 0.3, seed: 1, wrap: true, fg: 1, bg: 0 })), ["f2badc3d0da76540", 8548]);
});

test("matches Python: seed 12345, density 0.25, no wrap", () => {
  assert.deepEqual(digest(lifeFrames(40, { density: 0.25, seed: 12345, wrap: false, fg: 1, bg: 0 })), ["62a4454ce6394346", 6708]);
});

test("frames are 64x16 and use the given colours", () => {
  const [f] = lifeFrames(1, { fg: 0xff0000, bg: 0x000010 });
  assert.equal(f.length, 64 * 16);
  assert.ok(f.every((v) => v === 0xff0000 || v === 0x000010));
});
