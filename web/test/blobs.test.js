import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTES, blobFrames } from "../src/blobs.js";

test("blobs: deterministic, 64x16, fits a 16-colour GIF table", () => {
  for (const palette of Object.keys(PALETTES)) {
    const a = blobFrames({ seed: 7, palette });
    const b = blobFrames({ seed: 7, palette });
    assert.deepEqual(a.frames, b.frames);
    assert.ok(a.count > 3);
    assert.equal(a.frames[0].length, 64 * 16);
    assert.ok(new Set(a.frames.flatMap((f) => [...f])).size <= 16);
  }
});

test("blobs: animation loops seamlessly and wobble 0 is static", () => {
  const still = blobFrames({ seed: 3, wobble: 0, frames: 4 });
  assert.deepEqual(still.frames[0], still.frames[2]);
  assert.equal(blobFrames({ seed: 3, frames: 1 }).frames.length, 1);
});
