// PNG and GIF encoders producing files the BK-Light panel is known to accept
// (see docs/PROTOCOL.md): PNG = 1-bit indexed or 8-bit RGB with a "stored" deflate block,
// GIF = one global 16-entry colour table, no local tables, LZW min code size 4.

import { RenderError, type Frame } from "./types.ts";

// ------------------------------------------------------------------ PNG
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, start = 0, end = data.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32be(v: number): number[] {
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  out.set(u32be(data.length), 0);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  out.set(u32be(crc32(out, 4, 8 + data.length)), 8 + data.length);
  return out;
}

/** zlib stream made of "stored" (uncompressed) deflate blocks. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  let o = 0;
  out[o++] = 0x78;
  out[o++] = 0x01;
  for (let b = 0; b < blocks; b++) {
    const part = raw.subarray(b * 65535, Math.min(raw.length, (b + 1) * 65535));
    const last = b === blocks - 1 ? 1 : 0;
    const len = part.length;
    out[o++] = last;
    out[o++] = len & 255;
    out[o++] = len >> 8;
    out[o++] = ~len & 255;
    out[o++] = (~len >> 8) & 255;
    out.set(part, o);
    o += len;
  }
  out.set(u32be(adler32(raw)), o);
  return out;
}

function pngFile(w: number, h: number, depth: number, ctype: number, plte: Uint8Array | null, raw: Uint8Array): Uint8Array {
  const sig = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const ihdr = Uint8Array.of(...u32be(w), ...u32be(h), depth, ctype, 0, 0, 0);
  const parts = [sig, chunk("IHDR", ihdr)];
  if (plte) parts.push(chunk("PLTE", plte));
  parts.push(chunk("IDAT", zlibStored(raw)), chunk("IEND", new Uint8Array(0)));
  return concat(parts);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

const rgbOf = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

/** Distinct colours of a frame in first-appearance order, with `first` forced to index 0. */
export function paletteOf(frames: Frame[], first: number): number[] {
  const seen = new Set<number>([first]);
  const list = [first];
  for (const f of frames)
    for (let i = 0; i < f.length; i++) {
      const c = f[i]!;
      if (!seen.has(c)) {
        seen.add(c);
        list.push(c);
      }
    }
  return list;
}

/** PNG: 1-bit indexed when the frame has <= 2 colours, otherwise 8-bit RGB. */
export function encodePng(frame: Frame, w: number, h: number, background: number): Uint8Array {
  const pal = paletteOf([frame], background);
  if (pal.length <= 2) {
    const stride = (w + 7) >> 3;
    const raw = new Uint8Array((stride + 1) * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (pal.length > 1 && frame[y * w + x] === pal[1]) raw[y * (stride + 1) + 1 + (x >> 3)]! |= 0x80 >> (x & 7);
    const plte = new Uint8Array(6);
    pal.forEach((c, i) => plte.set(rgbOf(c), i * 3));
    return pngFile(w, h, 1, 3, plte, raw);
  }
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) raw.set(rgbOf(frame[y * w + x]!), y * (w * 3 + 1) + 1 + x * 3);
  return pngFile(w, h, 8, 2, null, raw);
}

// ------------------------------------------------------------------ GIF
/** Growable byte buffer (avoids `push(...array)` on large outputs). */
class Bytes {
  buf = new Uint8Array(4096);
  n = 0;
  private room(k: number) {
    if (this.n + k <= this.buf.length) return;
    const b = new Uint8Array(Math.max(this.buf.length * 2, this.n + k));
    b.set(this.buf.subarray(0, this.n));
    this.buf = b;
  }
  byte(x: number) {
    if (this.n >= this.buf.length) this.room(1);
    this.buf[this.n++] = x;
  }
  push(...v: number[]) {
    this.room(v.length);
    for (const x of v) this.buf[this.n++] = x;
  }
  add(v: Uint8Array) {
    this.room(v.length);
    this.buf.set(v, this.n);
    this.n += v.length;
  }
  out() {
    return this.buf.slice(0, this.n);
  }
}

// LZW dictionary as flat arrays indexed by (prefix code << 8 | pixel); a stamp marks the entries of the current table,
// so clearing the table is O(1). Shared between calls (the encoder is synchronous).
const DICT = new Int32Array(4096 << 8);
const STAMP = new Uint32Array(4096 << 8);
let gen = 0;

function lzw(pixels: Uint8Array, minCode = 4): Uint8Array {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let size = minCode + 1;
  let next = eoi + 1;
  const out = new Bytes();
  let cur = 0;
  let nb = 0;
  gen++;
  const emit = (code: number) => {
    cur |= code << nb;
    nb += size;
    while (nb >= 8) {
      out.byte(cur & 255);
      cur >>>= 8;
      nb -= 8;
    }
  };
  emit(clear);
  let prefix = pixels[0]!;
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i]!;
    const key = (prefix << 8) | k;
    if (STAMP[key] === gen) {
      prefix = DICT[key]!;
      continue;
    }
    emit(prefix);
    STAMP[key] = gen;
    DICT[key] = next++;
    if (next > 1 << size && size < 12) size++;
    if (next >= 4096) {
      emit(clear);
      gen++;
      size = minCode + 1;
      next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix);
  next++;
  if (next > 1 << size && size < 12) size++;
  emit(eoi);
  if (nb > 0) out.byte(cur & 255);
  return out.out();
}

export interface GifOptions {
  background: number;
  loop: number; // 0 = forever
  nonce: boolean; // random bytes after the trailer so an identical file is never byte-identical (panel quirk)
}

export function encodeGif(frames: Frame[], delaysMs: number[], w: number, h: number, opt: GifOptions): Uint8Array {
  const pal = paletteOf(frames, opt.background);
  if (pal.length > 16)
    throw new RenderError(`GIF supports at most 16 colours (the panel needs one shared 16-entry table); the scene uses ${pal.length}`, 422);
  const index = new Map(pal.map((c, i) => [c, i]));
  const b = new Bytes();
  b.push(...ascii("GIF89a"), w & 255, w >> 8, h & 255, h >> 8, 0xf3, 0, 0);
  for (let i = 0; i < 16; i++) b.push(...rgbOf(pal[i] ?? 0));
  b.push(0x21, 0xff, 0x0b, ...ascii("NETSCAPE2.0"), 3, 1, opt.loop & 255, opt.loop >> 8, 0);
  const blocks = new Map<Frame, Uint8Array>(); // the same frame object (a repeated scene) is compressed once
  frames.forEach((f, n) => {
    const cs = Math.max(1, Math.round(delaysMs[n]! / 10));
    b.push(0x21, 0xf9, 4, 0x04, cs & 255, cs >> 8, 0, 0);
    b.push(0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0, 4);
    let data = blocks.get(f);
    if (!data) {
      const px = new Uint8Array(f.length);
      for (let i = 0; i < f.length; i++) px[i] = index.get(f[i]!)!;
      const raw = lzw(px, 4);
      const sub = new Bytes();
      for (let o = 0; o < raw.length; o += 255) {
        const part = raw.subarray(o, o + 255);
        sub.push(part.length);
        sub.add(part);
      }
      sub.push(0);
      data = sub.out();
      blocks.set(f, data);
    }
    b.add(data);
  });
  b.push(0x3b);
  if (opt.nonce) b.push(...crypto.getRandomValues(new Uint8Array(4)));
  return b.out();
}
