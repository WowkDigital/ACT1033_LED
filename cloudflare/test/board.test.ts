import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANIM_CS,
  ANIM_FRAMES,
  boardSegments,
  drawSegments,
  fitBoard,
  infoLinesRow,
  infoOffset,
  infoTopRow,
  smallWidth,
  type BoardOptions,
  type Dep,
  type Segment,
} from "../src/board.ts";
import type { Element } from "../src/types.ts";

const START = 1_800_000_000; // a multiple of 10 and of 60 (epoch seconds are minute-aligned)
const SOD = 21 * 3600 + 37 * 60 + 20; // the clock at START: 21:37:20
const info = { every: 40, dur: 10, label: "Poleska", lines: ["131", "N"], seconds: true };
const opt = (o: Partial<BoardOptions> = {}): BoardOptions => ({ color: "#ffb000", step: 10, info, anim: true, ...o });
const deps: Dep[] = [
  { l: "131", t: START + 120, x: true },
  { l: "N", t: START + 240, x: true },
  { l: "7", t: START + 420, x: true },
];

/** text of every text element / which elements are bitmaps, to look at a scene without drawing it */
const texts = (els: Element[]) => els.filter((e) => e.type === "text").map((e) => (e as { text: string }).text);
const hasBitmap = (els: Element[]) => els.some((e) => e.type === "bitmap");
/** the segment showing time `s` seconds after START */
function at(segs: Segment[], s: number): Segment {
  let t = 0;
  for (const g of segs) {
    if (s * 100 < t + g.cs) return g;
    t += g.cs;
  }
  throw new Error("past the end");
}

test("the stop screen sits between the minute marks, so it never hides a departure", () => {
  assert.equal(infoOffset(40, 10), 5); // minutes land on 0 and 20 (mod 40) -> 5..15 and 25..35
  assert.equal(infoOffset(60, 10), 25);
  assert.equal(infoOffset(30, 10), 10);
  for (const [every, dur] of [[40, 10], [60, 10], [45, 10], [120, 30], [30, 10]] as const) {
    const off = infoOffset(every, dur);
    for (let m = 0; m < every * 60; m += 60) assert.ok((((m - off) % every) + every) % every >= dur, `${every}/${dur}: minute ${m} inside the window`);
  }
});

test("timeline: covers the horizon exactly, frames last at most 10 s, clock ticks every second", () => {
  const segs = boardSegments(deps, START, 500, opt(), SOD);
  assert.equal(segs.reduce((a, s) => a + s.cs, 0), 50000);
  assert.ok(segs.every((s) => s.cs >= 1 && s.cs <= 1000));
  // START = :20 in the 40 s cycle with offset 5 -> the stop screen shows 25..35 s after START... and 5..15 s after START
  const shown = at(segs, 6).elements;
  assert.ok(hasBitmap(shown), "small-font clock (POLESKA does not fit next to a 5x7 clock)");
  const clock = (s: number) => JSON.stringify(at(segs, s).elements);
  assert.notEqual(clock(6), clock(7), "the clock changes every second");
  assert.deepEqual(texts(at(segs, 20).elements), ["131", "1m 40s", "N", "3m 40s"], "countdown between the stop screens");
  assert.ok(texts(shown).includes("131, N"), "lines on the second row");
});

test("HH:MM clock: a stop screen is a single frame unless the minute changes", () => {
  const segs = boardSegments(deps, START, 500, opt({ info: { ...info, seconds: false } }), SOD);
  assert.equal(at(segs, 5).cs, 1000, "one 10 s frame");
});

test("departure animation: the vehicle drives off its row, the second row keeps counting", () => {
  const segs = boardSegments(deps, START, 500, opt(), SOD);
  const first = at(segs, 120);
  assert.equal(first.cs, ANIM_CS);
  assert.ok(hasBitmap(first.elements), "sprite");
  assert.deepEqual(texts(first.elements), ["131", "N", "2m 00s"], "the leaving line rides on the sprite; N still counts");
  let t = 120 * 100;
  for (let k = 0; k < ANIM_FRAMES; k++, t += ANIM_CS) assert.ok(hasBitmap(at(segs, t / 100).elements));
  assert.deepEqual(texts(at(segs, 122).elements), ["N", "2m 00s", "7", "5m 00s"], "after the animation the next departure moves up");
  const none = boardSegments(deps, START, 500, opt({ anim: false }), SOD);
  assert.ok(!hasBitmap(at(none, 120).elements));
});

test("stop screen layout fits 64 px: shrinks the fonts, then cuts the name", () => {
  const width = (els: Element[]) =>
    Math.max(...els.map((e) => (e.type === "bitmap" ? (e.x ?? 0) + e.rows[0]!.length : 0)));
  assert.ok(texts(infoTopRow("Rynek", "21:37", "#fff")).includes("RYNEK"), "short name + HH:MM in the 5x7 font");
  const long = infoTopRow("Plac Grunwaldzki Politechnika", "21:37:30", "#fff");
  assert.ok(long.every((e) => e.type === "bitmap"));
  assert.ok(width(long) <= 64);
  assert.deepEqual(texts(infoLinesRow(["131", "N"], "#fff")), ["131, N"]);
  const many = infoLinesRow(["1", "2", "4", "10", "16", "19", "112", "113", "131", "144", "145", "146", "N", "D"], "#fff");
  assert.ok(width(many) <= 64);
  assert.ok((many[0] as { rows: string[] }).rows.length === 5, "small font for many lines");
  assert.ok(smallWidth("21:37:30") < 30);
});

test("identical scenes are drawn once; the size budget is honoured by giving extras up", () => {
  const segs = boardSegments(deps, START, 500, opt(), SOD);
  const b = drawSegments(segs);
  assert.equal(b.frames.length, segs.length);
  const full = fitBoard(deps, START, 500, 360, opt(), SOD, 60 * 1024);
  assert.deepEqual(full.dropped, []);
  assert.ok(full.gif.length < 40 * 1024, "default extras stay well below the budget: " + full.gif.length);
  const small = fitBoard(deps, START, 500, 360, opt(), SOD, 8000);
  assert.ok(small.dropped.length > 0);
  assert.equal(small.horizonS, 360);
  assert.ok(small.gif.length <= 8000 || small.dropped.includes("stop screen"));
  assert.ok(fitBoard([], START, 500, 360, opt(), SOD, 40960).gif.length > 0, "no departures -> NO DATA + stop screens");
});
