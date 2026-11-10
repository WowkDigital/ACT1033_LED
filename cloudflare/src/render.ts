// Scene description -> frames. Port of python/act1033led/render.py (text, scroll, blink) plus basic shapes.

import { BASE, GLYPHS } from "./font.ts";
import { encodeGif, encodePng } from "./encode.ts";
import { RenderError, type Element, type Frame, type Spec, type TextElement } from "./types.ts";

export const PANEL_W = 64;
export const PANEL_H = 16;
export const MAX_DIM = 256;
export const MAX_FRAMES = 600;
const MAX_TEXT = 500;

/** (pixels per frame, delay in 1/100 s) for scroll speeds 1..5 - same as the ESP / Python tools */
const SPEEDS: [number, number][] = [[1, 10], [1, 6], [1, 4], [1, 3], [2, 5]];

export function parseColor(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  let s = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.replace(/./g, (c) => c + c);
  if (!/^[0-9a-f]{6}$/i.test(s)) throw new RenderError(`invalid colour "${value}" (use RRGGBB, #RRGGBB or #RGB)`);
  return parseInt(s, 16);
}

// ------------------------------------------------------------------ text bitmap
interface Bitmap {
  w: number;
  h: number;
  /** 1 = pixel on */
  px: Uint8Array;
}

const bitmapCache = new Map<string, Bitmap>(); // the departure board draws the same few strings hundreds of times

export function textBitmap(text: string, scale: number): Bitmap {
  const key = scale + "|" + text;
  const hit = bitmapCache.get(key);
  if (hit) return hit;
  const bm = makeTextBitmap(text, scale);
  if (bitmapCache.size > 2000) bitmapCache.clear();
  bitmapCache.set(key, bm);
  return bm;
}

function makeTextBitmap(text: string, scale: number): Bitmap {
  const [top, bottom] = scale === 1 ? [-2, 8] : [0, 6];
  const h = (bottom - top + 1) * scale;
  const items: [number, Record<string, string>][] = [];
  let x = 0;
  for (let ch of text.replace(/\n/g, " ")) {
    if (scale !== 1 && BASE[ch]) ch = BASE[ch]!;
    const [width, rows] = GLYPHS[ch] ?? GLYPHS["?"]!;
    items.push([x, rows]);
    x += (width + 1) * scale;
  }
  const w = Math.max(1, x - scale);
  const px = new Uint8Array(w * h);
  for (const [gx, rows] of items)
    for (const [ys, row] of Object.entries(rows)) {
      const y = Number(ys);
      if (y < top || y > bottom) continue;
      for (let cx = 0; cx < row.length; cx++) {
        if (row[cx] !== "#") continue;
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const xx = gx + cx * scale + dx;
            const yy = (y - top) * scale + dy;
            if (xx < w && yy < h) px[yy * w + xx] = 1;
          }
      }
    }
  return { w, h, px };
}

// ------------------------------------------------------------------ canvas
class Canvas {
  readonly px: Frame;
  readonly w: number;
  readonly h: number;
  constructor(w: number, h: number, bg: number) {
    this.w = w;
    this.h = h;
    this.px = new Uint32Array(w * h).fill(bg);
  }
  set(x: number, y: number, c: number): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
  }
  blit(bm: Bitmap, ox: number, oy: number, c: number): void {
    for (let y = 0; y < bm.h; y++) for (let x = 0; x < bm.w; x++) if (bm.px[y * bm.w + x]) this.set(ox + x, oy + y, c);
  }
  rect(x: number, y: number, w: number, h: number, c: number, fill: boolean): void {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) if (fill || j === 0 || i === 0 || j === h - 1 || i === w - 1) this.set(x + i, y + j, c);
  }
  line(x1: number, y1: number, x2: number, y2: number, c: number): void {
    const dx = Math.abs(x2 - x1);
    const dy = -Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x1, y1, c);
      if (x1 === x2 && y1 === y2) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x1 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y1 += sy;
      }
    }
  }
}

// ------------------------------------------------------------------ scene
interface Ctx {
  w: number;
  h: number;
  bg: number;
}

const int = (v: unknown, name: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new RenderError(`"${name}" must be a number`);
  return Math.trunc(v);
};

function textBox(el: TextElement): { bm: Bitmap; color: number; scale: number } {
  if (typeof el.text !== "string") throw new RenderError('text element needs a string "text"');
  if (el.text.length > MAX_TEXT) throw new RenderError(`text is limited to ${MAX_TEXT} characters`);
  const scale = el.scale === undefined ? 1 : int(el.scale, "scale");
  if (scale < 1 || scale > 4) throw new RenderError('"scale" must be 1..4');
  return { bm: textBitmap(el.text || " ", scale), color: parseColor(el.color, 0x00ff00), scale };
}

function placeText(el: TextElement, bm: Bitmap, ctx: Ctx, xOverride?: number): [number, number] {
  const x =
    xOverride ?? (el.x !== undefined ? int(el.x, "x") : el.align === "left" ? 0 : el.align === "right" ? ctx.w - bm.w : Math.floor((ctx.w - bm.w) / 2));
  const y =
    el.y !== undefined ? int(el.y, "y") : el.valign === "top" ? 0 : el.valign === "bottom" ? ctx.h - bm.h : Math.floor((ctx.h - bm.h) / 2);
  return [x, y];
}

function drawStatic(cv: Canvas, el: Element, ctx: Ctx): void {
  switch (el.type) {
    case "text": {
      const { bm, color } = textBox(el);
      const [x, y] = placeText(el, bm, ctx);
      cv.blit(bm, x, y, color);
      break;
    }
    case "rect":
      cv.rect(int(el.x, "x"), int(el.y, "y"), int(el.w, "w"), int(el.h, "h"), parseColor(el.color, 0x00ff00), el.fill !== false);
      break;
    case "pixel":
      cv.set(int(el.x, "x"), int(el.y, "y"), parseColor(el.color, 0x00ff00));
      break;
    case "line":
      cv.line(int(el.x1, "x1"), int(el.y1, "y1"), int(el.x2, "x2"), int(el.y2, "y2"), parseColor(el.color, 0x00ff00));
      break;
    case "bitmap": {
      if (!Array.isArray(el.rows) || el.rows.some((r) => typeof r !== "string")) throw new RenderError('bitmap needs "rows": string[]');
      const s = el.scale === undefined ? 1 : int(el.scale, "scale");
      if (s < 1 || s > 8) throw new RenderError('"scale" must be 1..8');
      const bw = Math.max(1, ...el.rows.map((r) => r.length)) * s;
      const bh = el.rows.length * s;
      const px = new Uint8Array(bw * bh);
      el.rows.forEach((r, j) =>
        [...r].forEach((c, i) => {
          if (c === "#") for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) px[(j * s + dy) * bw + i * s + dx] = 1;
        }),
      );
      const bm = { w: bw, h: bh, px };
      cv.blit(bm, el.x === undefined ? Math.floor((ctx.w - bw) / 2) : int(el.x, "x"), el.y === undefined ? Math.floor((ctx.h - bh) / 2) : int(el.y, "y"), parseColor(el.color, 0x00ff00));
      break;
    }
    default:
      throw new RenderError(`unknown element type "${(el as { type?: string }).type}"`);
  }
}

function drawScene(ctx: Ctx, elements: Element[], skip?: Element, extra?: (cv: Canvas) => void): Frame {
  const cv = new Canvas(ctx.w, ctx.h, ctx.bg);
  for (const el of elements) if (el !== skip) drawStatic(cv, el, ctx);
  extra?.(cv);
  return cv.px;
}

export interface Animation {
  frames: Frame[];
  delaysMs: number[];
}

export function buildAnimation(spec: Spec, ctx: Ctx): Animation {
  if (spec.frames !== undefined) {
    if (!Array.isArray(spec.frames) || spec.frames.length === 0) throw new RenderError('"frames" must be a non-empty array');
    if (spec.frames.length > MAX_FRAMES) throw new RenderError(`at most ${MAX_FRAMES} frames`);
    const frames: Frame[] = [];
    const delaysMs: number[] = [];
    for (const f of spec.frames) {
      if (!Array.isArray(f.elements)) throw new RenderError('every frame needs "elements": []');
      if (f.elements.some((e) => e.type === "text" && e.anim && e.anim !== "none")) throw new RenderError('"anim" is only allowed in top-level "elements"');
      frames.push(drawScene(ctx, f.elements));
      delaysMs.push(f.duration === undefined ? 100 : Math.max(10, int(f.duration, "duration")));
    }
    return { frames, delaysMs };
  }

  const elements = spec.elements ?? [];
  if (!Array.isArray(elements)) throw new RenderError('"elements" must be an array');
  const animated = elements.filter((e): e is TextElement => e.type === "text" && !!e.anim && e.anim !== "none");
  if (animated.length > 1) throw new RenderError("only one animated text element per scene (use explicit \"frames\" for more)");
  const an = animated[0];

  if (!an) return { frames: [drawScene(ctx, elements)], delaysMs: [1000] };

  const { bm, color } = textBox(an);
  if (an.anim === "blink") {
    const [x, y] = placeText(an, bm, ctx);
    return {
      frames: [drawScene(ctx, elements, an, (cv) => cv.blit(bm, x, y, color)), drawScene(ctx, elements, an)],
      delaysMs: [600, 400],
    };
  }
  if (an.anim !== "scroll") throw new RenderError('"anim" must be none, scroll or blink');
  const speed = an.speed === undefined ? 3 : Math.max(1, Math.min(5, int(an.speed, "speed")));
  const [step, delayCs] = SPEEDS[speed - 1]!;
  const [, y] = placeText(an, bm, ctx);
  const frames: Frame[] = [];
  for (let x = ctx.w; x > -bm.w - 1; x -= step) frames.push(drawScene(ctx, elements, an, (cv) => cv.blit(bm, x, y, color)));
  if (frames.length > MAX_FRAMES) throw new RenderError(`text too long to scroll (${frames.length} frames, max ${MAX_FRAMES}); shorten it or increase speed`);
  return { frames, delaysMs: frames.map(() => delayCs * 10) };
}

export interface Rendered {
  body: Uint8Array;
  contentType: string;
  width: number;
  height: number;
  frames: number;
}

export function render(spec: Spec): Rendered {
  if (typeof spec !== "object" || spec === null) throw new RenderError("spec must be a JSON object");
  const w = spec.width === undefined ? PANEL_W : int(spec.width, "width");
  const h = spec.height === undefined ? PANEL_H : int(spec.height, "height");
  if (w < 1 || h < 1 || w > MAX_DIM || h > MAX_DIM) throw new RenderError(`width and height must be 1..${MAX_DIM}`);
  const format = spec.format ?? "png";
  if (format !== "png" && format !== "gif") throw new RenderError('"format" must be png or gif');
  const bg = parseColor(spec.background, 0x000000);

  const anim = buildAnimation(spec, { w, h, bg });
  if (format === "png") {
    const n = spec.frame === undefined ? 0 : int(spec.frame, "frame");
    const frame = anim.frames[n];
    if (!frame) throw new RenderError(`frame ${n} does not exist (scene has ${anim.frames.length})`, 404);
    return { body: encodePng(frame, w, h, bg), contentType: "image/png", width: w, height: h, frames: anim.frames.length };
  }

  let { frames, delaysMs } = anim;
  if (frames.length === 1) {
    // the panel's known-good static GIF is two identical frames
    frames = [frames[0]!, frames[0]!];
    delaysMs = [1000, 1000];
  }
  const loop = spec.loop === undefined ? 0 : int(spec.loop, "loop");
  const body = encodeGif(frames, delaysMs, w, h, { background: bg, loop, nonce: spec.nonce === true });
  return { body, contentType: "image/gif", width: w, height: h, frames: frames.length };
}
