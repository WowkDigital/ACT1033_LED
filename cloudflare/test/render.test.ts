import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "../src/render.ts";
import { crc32 } from "../src/encode.ts";
import worker from "../src/index.ts";

test("PNG has valid signature and 64x16 header, 1-bit for 2 colours", () => {
  const r = render({ elements: [{ type: "text", text: "Hi", color: "#ff0000" }] });
  assert.equal(r.contentType, "image/png");
  assert.deepEqual([...r.body.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const dv = new DataView(r.body.buffer, r.body.byteOffset);
  assert.equal(dv.getUint32(16), 64);
  assert.equal(dv.getUint32(20), 16);
  assert.equal(r.body[24], 1); // bit depth
  assert.equal(r.body[25], 3); // indexed
  assert.ok(r.body.length < 400);
});

test("PNG chunk CRCs are valid", () => {
  const b = render({ elements: [{ type: "text", text: "Wrocław", color: "#00ff00" }, { type: "rect", x: 0, y: 0, w: 3, h: 3, color: "#0000ff" }] }).body;
  const dv = new DataView(b.buffer, b.byteOffset);
  let o = 8;
  let n = 0;
  while (o < b.length) {
    const len = dv.getUint32(o);
    assert.equal(dv.getUint32(o + 8 + len), crc32(b, o + 4, o + 8 + len));
    o += 12 + len;
    n++;
  }
  assert.equal(n, 3); // 3 colours -> RGB: IHDR, IDAT, IEND
});

test("GIF scroll yields many frames and respects the 16-colour limit", () => {
  const r = render({ format: "gif", elements: [{ type: "text", text: "Hello", anim: "scroll", speed: 3 }] });
  assert.equal(r.contentType, "image/gif");
  assert.ok(r.frames > 40);
  assert.equal(String.fromCharCode(...r.body.subarray(0, 6)), "GIF89a");
  assert.equal(r.body.at(-1), 0x3b);
  assert.throws(
    () => render({ format: "gif", elements: Array.from({ length: 17 }, (_, i) => ({ type: "pixel" as const, x: i, y: 0, color: `#${(i + 1).toString(16).padStart(2, "0")}0000` })) }),
    /16 colours/,
  );
});

test("static GIF is duplicated to two frames; nonce appends bytes after trailer", () => {
  const a = render({ format: "gif", elements: [{ type: "text", text: "A" }], nonce: true });
  assert.equal(a.frames, 2);
  assert.notEqual(a.body.at(-5), undefined);
  assert.equal(a.body.at(-5), 0x3b);
});

test("validation errors", () => {
  assert.throws(() => render({ elements: [{ type: "text", text: "x", color: "zzz" }] }), /invalid colour/);
  assert.throws(() => render({ width: 9999 }), /width and height/);
  assert.throws(() => render({ elements: [{ type: "nope" } as never] }), /unknown element/);
  assert.throws(() => render({ elements: [{ type: "text", text: "a", anim: "scroll" }, { type: "text", text: "b", anim: "blink" }] }), /only one animated/);
});

test("HTTP: GET /render and POST /render", async () => {
  const g = await worker.fetch(new Request("https://x/render?text=Test&format=gif&anim=blink"));
  assert.equal(g.status, 200);
  assert.equal(g.headers.get("content-type"), "image/gif");
  const p = await worker.fetch(new Request("https://x/render", { method: "POST", body: JSON.stringify({ elements: [{ type: "text", text: "Zażółć" }] }) }));
  assert.equal(p.headers.get("content-type"), "image/png");
  const bad = await worker.fetch(new Request("https://x/render", { method: "POST", body: "{" }));
  assert.equal(bad.status, 400);
  assert.equal((await worker.fetch(new Request("https://x/nope"))).status, 404);
});
