// Departure board: turns a list of departures into the frames of one countdown GIF for the 64x16 panel.
// Pure code (no Worker APIs), shared by the Worker's departures job (mpk.ts) and the control page's live preview.
//
// The GIF is built as a timeline (all times in 1/100 s, the GIF delay unit), starting at `startS`:
//  - countdown: two rows "13   3m 10s", one per departure, changing every `step` seconds;
//  - stop screen (optional): every `every` seconds, for `dur` seconds, "POLESKA 21:37:30" + the lines ("131, N");
//  - departure animation (optional): when a vehicle leaves, a bus / tram sprite carrying its number drives off its row.
// Consecutive identical frames are merged, so a still picture costs one frame however long it stays.

import { BASE } from "./font.ts";
import { encodeGif } from "./encode.ts";
import { buildAnimation, parseColor, textBitmap, PANEL_H, PANEL_W } from "./render.ts";
import type { Element, Frame } from "./types.ts";

/** One upcoming departure: `t` = epoch seconds, `x` = exact (from the timetable; live vehicles only have rounded minutes). */
export interface Dep {
  l: string;
  t: number;
  x: boolean;
}

export interface Row {
  left: string;
  right: string;
}

export interface InfoOptions {
  /** a stop screen starts every `every` seconds (aligned to the wall clock) */
  every: number;
  /** and stays for `dur` seconds */
  dur: number;
  /** stop name shown on the first row */
  label: string;
  /** lines shown on the second row */
  lines: string[];
  /** HH:MM:SS (true) or HH:MM */
  seconds: boolean;
}

export interface BoardOptions {
  color: string;
  /** countdown resolution in seconds */
  step: number;
  info: InfoOptions | null;
  anim: boolean;
}

// ---------------------------------------------------------------- departures helpers
/** Wrocław tram lines are 0L, 0P and 1-33; everything else (100+, letters) is a bus. */
export function lineType(line: string): "tram" | "bus" {
  const l = String(line).trim();
  if (/^0[LP]$/i.test(l)) return "tram";
  return /^\d+$/.test(l) && Number(l) >= 1 && Number(l) <= 33 ? "tram" : "bus";
}

export const sortLines = (a: string, b: string) => (parseInt(a) || 999) - (parseInt(b) || 999) || a.localeCompare(b);

export function warsawSecondsOfDay(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(ms);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 3600 + get("minute") * 60 + get("second");
}

interface RawDep {
  line?: string | number;
  min?: string | number;
  time?: string;
}

/** Absolute departure times. Timetable rows have HH:MM (Warsaw time) -> exact; live vehicles only a rounded `min` -> approximate. */
export function toDeps(list: RawDep[], nowMs: number, timetableOnly = false): Dep[] {
  const nowS = Math.floor(nowMs / 1000);
  const sod = warsawSecondsOfDay(nowMs);
  const out: Dep[] = [];
  for (const d of list) {
    const line = String(d.line ?? "").slice(0, 5);
    const m = d.time ? /^(\d{1,2}):(\d{2})$/.exec(d.time) : null;
    if (m) {
      let delta = Number(m[1]) * 3600 + Number(m[2]) * 60 - sod;
      if (delta < -43200) delta += 86400; // after midnight
      out.push({ l: line, t: nowS + delta, x: true });
    } else if (!timetableOnly && d.min !== undefined && d.min !== "") {
      const min = String(d.min).startsWith("<") ? 0.5 : Number(d.min);
      if (Number.isFinite(min)) out.push({ l: line, t: nowS + Math.round(min * 60), x: false });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** The next two departures still to come at `atS`. */
export const upcoming = (deps: Dep[], atS: number) => deps.filter((d) => d.t - atS > 0).slice(0, 2);

/** "3m 10s" (resolution 10 s, floored), "45s" below a minute. */
export function formatRemaining(seconds: number, step = 10): string {
  const r = Math.max(0, Math.floor(seconds / step) * step);
  const m = Math.floor(r / 60);
  return m > 0 ? `${m}m ${String(r % 60).padStart(2, "0")}s` : `${r}s`;
}

// ---------------------------------------------------------------- small 3x5 font (clock / long stop names)
const SMALL: Record<string, string[]> = {
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "###", "#..", "###"],
  "3": ["###", "..#", ".##", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", "..#", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "###"],
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["#", "#", "#", "#", "#"],
  J: ["..#", "..#", "..#", "#.#", ".#."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "##.", ".##"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  ":": [".", "#", ".", "#", "."],
  ".": [".", ".", ".", ".", "#"],
  ",": [".", ".", ".", "#", "#"],
  "-": ["..", "..", "##", "..", ".."],
  "+": ["...", ".#.", "###", ".#.", "..."],
  "/": ["..#", "..#", ".#.", "#..", "#.."],
  "'": ["#", "#", ".", ".", "."],
  " ": ["..", "..", "..", "..", ".."],
  "?": ["###", "..#", ".#.", "...", ".#."],
};

const smallGlyph = (ch: string) => SMALL[(BASE[ch] ?? ch).toUpperCase()] ?? SMALL["?"]!;

const smallCache = new Map<string, string[]>();

/** Rows of a text in the 3x5 font ('#' = on), 1 px between letters. */
export function smallRows(text: string): string[] {
  let rows = smallCache.get(text);
  if (rows) return rows;
  if (smallCache.size > 2000) smallCache.clear();
  smallCache.set(text, (rows = makeSmallRows(text)));
  return rows;
}

function makeSmallRows(text: string): string[] {
  const rows = ["", "", "", "", ""];
  [...text].forEach((ch, i) => {
    const g = smallGlyph(ch);
    for (let r = 0; r < 5; r++) rows[r] += (i ? "." : "") + g[r];
  });
  return rows;
}
export const smallWidth = (text: string) => (text ? smallRows(text)[0]!.length : 0);
export const bigWidth = (text: string) => (text ? textBitmap(text, 1).w : 0);

// ---------------------------------------------------------------- vehicle sprites (7 rows, facing left)
export const SPRITES: Record<"bus" | "tram", string[]> = {
  bus: [
    "..##########",
    ".#.#..#..#.#",
    "#..#..#..#.#",
    "############",
    "############",
    "############",
    ".##......##.",
  ],
  tram: [
    "........#.#.....",
    ".##############.",
    "#.#..#..#..#..##",
    "################",
    "################",
    "################",
    "..##........##..",
  ],
};

/** Departure animation: pixels moved per frame and the frame time (1/100 s). 16 frames, 0.8 s. */
export const ANIM_PX = 4;
export const ANIM_CS = 5;

// ---------------------------------------------------------------- scene pieces
const TOPS = [-2, 7]; // big text box tops: glyph rows land on pixel rows 0-6 and 9-15
const ROW_Y = [0, 9]; // first pixel row of each text row

function countdownRow(els: Element[], i: number, d: Dep, atS: number, step: number, color: string): void {
  els.push({ type: "text", text: d.l || " ", color, y: TOPS[i], align: "left" });
  els.push({ type: "text", text: formatRemaining(d.t - atS, step), color, y: TOPS[i], align: "right" });
}

/** Elements of the plain countdown (or "NO DATA"). */
export function rowElements(rows: Row[], color: string): Element[] {
  const els: Element[] = [];
  if (rows.length === 0) els.push({ type: "text", text: "NO DATA", color, y: TOPS[0], align: "left" });
  rows.forEach((r, i) => {
    els.push({ type: "text", text: r.left || " ", color, y: TOPS[i], align: "left" });
    els.push({ type: "text", text: r.right || " ", color, y: TOPS[i], align: "right" });
  });
  return els;
}

/** Animation frames: the sprite + its number start right-aligned and drive left until they are gone (64 px). */
export const ANIM_FRAMES = Math.ceil(PANEL_W / ANIM_PX);

function vehicleRow(els: Element[], i: number, line: string, k: number, color: string): void {
  const sprite = SPRITES[lineType(line)];
  const groupW = sprite[0]!.length + 2 + bigWidth(line);
  const x = PANEL_W - groupW - k * ANIM_PX;
  els.push({ type: "bitmap", rows: sprite, x, y: ROW_Y[i], color });
  els.push({ type: "text", text: line || " ", color, x: x + sprite[0]!.length + 2, y: TOPS[i] });
}

/** Text on one row, big (5x7) or small (3x5, bottom-aligned with the big letters). */
function put(els: Element[], row: number, text: string, small: boolean, x: number, color: string): void {
  if (!text) return;
  if (small) els.push({ type: "bitmap", rows: smallRows(text), x, y: ROW_Y[row]! + 2, color });
  else els.push({ type: "text", text, color, x, y: TOPS[row] });
}

/** First row of the stop screen: the name on the left, the clock on the right; shrinks the fonts (then the name) to fit 64 px. */
export function infoTopRow(label: string, clock: string, color: string): Element[] {
  const name = label.toUpperCase();
  const els: Element[] = [];
  const tries: [boolean, boolean][] = [[false, false], [false, true], [true, true]]; // [name small, clock small]
  for (const [ns, cs] of tries) {
    const nw = ns ? smallWidth(name) : bigWidth(name);
    const cw = cs ? smallWidth(clock) : bigWidth(clock);
    if (nw + (name ? 3 : 0) + cw <= PANEL_W) {
      put(els, 0, name, ns, 0, color);
      put(els, 0, clock, cs, PANEL_W - cw, color);
      return els;
    }
  }
  const cw = smallWidth(clock);
  let cut = name;
  while (cut && smallWidth(cut) + 3 + cw > PANEL_W) cut = cut.slice(0, -1);
  put(els, 0, cut.trimEnd(), true, 0, color);
  put(els, 0, clock, true, PANEL_W - cw, color);
  return els;
}

/** Second row of the stop screen: "131, N"; tighter, then smaller, then cut with a "+". */
export function infoLinesRow(lines: string[], color: string): Element[] {
  const els: Element[] = [];
  if (!lines.length) return els;
  for (const [sep, small] of [[", ", false], [",", false], [", ", true], [",", true]] as [string, boolean][]) {
    const text = lines.join(sep);
    if ((small ? smallWidth(text) : bigWidth(text)) <= PANEL_W) {
      put(els, 1, text, small, 0, color);
      return els;
    }
  }
  let n = lines.length - 1;
  while (n > 1 && smallWidth(lines.slice(0, n).join(",") + ",+") > PANEL_W) n--;
  put(els, 1, lines.slice(0, n).join(",") + ",+", true, 0, color);
  return els;
}

const hhmmss = (sod: number, seconds: boolean) => {
  const s = ((sod % 86400) + 86400) % 86400;
  const p = (n: number) => String(n).padStart(2, "0");
  return p(Math.floor(s / 3600)) + ":" + p(Math.floor(s / 60) % 60) + (seconds ? ":" + p(s % 60) : "");
};

// ---------------------------------------------------------------- timeline
export interface Segment {
  elements: Element[];
  /** 1/100 s */
  cs: number;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * Where in each `every`-second cycle the stop screen starts. Timetable departures fall on whole minutes, so the window is put
 * in the middle of the largest gap between the minute marks (mod `every`): it then never hides a departure or its animation.
 * Example: every 40 s -> minutes land on 0 and 20 (mod 40) -> the screen shows at 5..15 and 25..35.
 */
export function infoOffset(every: number, dur: number): number {
  const marks = [...new Set(Array.from({ length: every }, (_, k) => (k * 60) % every))].sort((a, b) => a - b);
  let best = 0;
  let bestGap = -1;
  marks.forEach((m, i) => {
    const gap = (i + 1 < marks.length ? marks[i + 1]! : marks[0]! + every) - m;
    if (gap > bestGap) [best, bestGap] = [m, gap];
  });
  return mod(best + Math.max(1, Math.floor((bestGap - dur) / 2)), every);
}

/**
 * Timeline of the board from `startS` for `horizonS` seconds. `sod0` = Warsaw seconds-of-day at `startS` (for the clock).
 * `startS` should be a multiple of `step` so the countdown changes on round seconds ("3m 10s", "3m 00s", ...).
 */
export function boardSegments(deps: Dep[], startS: number, horizonS: number, opt: BoardOptions, sod0: number): Segment[] {
  const { step, color, info } = opt;
  const T = horizonS * 100;
  const off = info ? infoOffset(info.every, info.dur) : 0;
  const inInfo = (aS: number) => !!info && info.dur > 0 && mod(Math.floor(aS) - off, info.every) < info.dur;
  const bp = new Set<number>([0]);
  const add = (cs: number) => cs > 0 && cs < T && bp.add(Math.round(cs));

  for (let s = step; s < horizonS; s += step) add(s * 100);
  for (const d of deps) add((d.t - startS) * 100);
  if (info && info.dur > 0) {
    for (let w0 = startS - mod(startS - off, info.every); w0 < startS + horizonS; w0 += info.every) {
      add((w0 - startS) * 100);
      add((w0 + info.dur - startS) * 100);
      if (info.seconds) for (let s = 1; s < info.dur; s++) add((w0 + s - startS) * 100);
      else for (let s = 1; s < info.dur; s++) if (mod(sod0 + w0 + s - startS, 60) === 0) add((w0 + s - startS) * 100);
    }
  }
  // a departure animation plays when a vehicle leaves (not during a stop screen)
  const leaving = new Map<number, number>(); // departure time -> frames
  if (opt.anim)
    for (const d of deps) {
      if (d.t <= startS || d.t >= startS + horizonS || inInfo(d.t) || leaving.has(d.t)) continue;
      const before = upcoming(deps, d.t - 0.5).filter((x) => x.t === d.t);
      if (!before.length) continue;
      const n = ANIM_FRAMES;
      leaving.set(d.t, n);
      for (let k = 0; k <= n; k++) add((d.t - startS) * 100 + k * ANIM_CS);
    }

  const stateAt = (cs: number): Element[] => {
    const aS = startS + Math.floor(cs / 100); // whole seconds are enough for the clock and the stop-screen windows
    const atStep = startS + Math.floor(cs / 100 / step) * step; // the countdown shows the value of the step it is in
    if (info && inInfo(aS)) {
      const clock = hhmmss(sod0 + aS - startS, info.seconds);
      return [...infoTopRow(info.label, clock, color), ...infoLinesRow(info.lines, color)];
    }
    for (const [td, n] of leaving) {
      const k = Math.floor((cs - (td - startS) * 100) / ANIM_CS); // integer maths: epoch seconds + 0.05 s lose precision
      if (k < 0 || k >= n) continue;
      const els: Element[] = [];
      upcoming(deps, td - 0.5).forEach((d, i) => (d.t === td ? vehicleRow(els, i, d.l, k, color) : countdownRow(els, i, d, atStep, step, color)));
      return els;
    }
    const rows = upcoming(deps, atStep);
    if (!rows.length) return rowElements([], color);
    const els: Element[] = [];
    rows.forEach((d, i) => countdownRow(els, i, d, atStep, step, color));
    return els;
  };

  const points = [...bp].sort((a, b) => a - b);
  const maxCs = step * 100; // a frame never lasts longer than the known-good 10 s
  const out: (Segment & { key: string })[] = [];
  points.forEach((p, i) => {
    const next = points[i + 1] ?? T;
    const elements = stateAt(p);
    const key = JSON.stringify(elements);
    let cs = next - p;
    const last = out[out.length - 1];
    if (last && last.key === key && last.cs < maxCs) {
      const take = Math.min(cs, maxCs - last.cs);
      last.cs += take;
      cs -= take;
    }
    while (cs > 0) {
      const take = Math.min(cs, maxCs);
      out.push({ elements, key, cs: take });
      cs -= take;
    }
  });
  return out.map(({ elements, cs }) => ({ elements, cs }));
}

export interface BoardFrames {
  frames: Frame[];
  delaysMs: number[];
}

/** Draws the segments (identical scenes are drawn once). */
export function drawSegments(segs: Segment[]): BoardFrames {
  const cache = new Map<string, Frame>();
  const ctx = { w: PANEL_W, h: PANEL_H, bg: 0 };
  const frames = segs.map((s) => {
    const key = JSON.stringify(s.elements);
    let f = cache.get(key);
    if (!f) {
      f = buildAnimation({ frames: [{ elements: s.elements }] }, ctx).frames[0]!;
      cache.set(key, f);
    }
    return f;
  });
  return { frames, delaysMs: segs.map((s) => s.cs * 10) };
}

export function encodeBoard(b: BoardFrames): Uint8Array {
  let { frames, delaysMs } = b;
  if (frames.length === 1) {
    frames = [frames[0]!, frames[0]!]; // the panel's known-good static GIF is two identical frames
    delaysMs = [delaysMs[0]! / 2, delaysMs[0]! / 2];
  }
  return encodeGif(frames, delaysMs, PANEL_W, PANEL_H, { background: 0, loop: 0, nonce: false });
}

// ---------------------------------------------------------------- fitting into the size budget
export interface FitResult {
  gif: Uint8Array;
  frames: number;
  horizonS: number;
  /** what had to be given up to fit the budget, empty when nothing */
  dropped: string[];
  board: BoardFrames;
}

/**
 * Builds the GIF and makes sure it fits `maxBytes`. When it does not, it gives things up in this order:
 * a shorter GIF (down to `minHorizonS`), the departure animation, the seconds of the clock, the stop screen.
 */
export function fitBoard(deps: Dep[], startS: number, horizonS: number, minHorizonS: number, opt: BoardOptions, sod0: number, maxBytes: number): FitResult {
  parseColor(opt.color, 0); // validates
  const plans: [number, BoardOptions, string[]][] = [[horizonS, opt, []]];
  const short = Math.min(horizonS, minHorizonS);
  if (short < horizonS) plans.push([short, opt, ["shorter GIF"]]);
  let o = opt;
  const dropped = short < horizonS ? ["shorter GIF"] : [];
  if (o.anim) plans.push([short, (o = { ...o, anim: false }), [...dropped, "animation"]]);
  if (o.info?.seconds) plans.push([short, (o = { ...o, info: { ...o.info, seconds: false } }), [...plans.at(-1)![2], "clock seconds"]]);
  if (o.info) plans.push([short, (o = { ...o, info: null }), [...plans.at(-1)![2], "stop screen"]]);
  let res: FitResult | null = null;
  for (const [h, p, d] of plans) {
    const board = drawSegments(boardSegments(deps, startS, h, p, sod0));
    const gif = encodeBoard(board);
    res = { gif, frames: board.frames.length, horizonS: h, dropped: d, board };
    if (gif.length <= maxBytes) return res;
  }
  return res!;
}
