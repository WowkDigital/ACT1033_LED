import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANIM_FRAMES,
  animOffset,
  animStartCs,
  bigWidth,
  boardSegments,
  drawSegments,
  fitBoard,
  infoElements,
  infoOffset,
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
  assert.ok(!hasBitmap(shown), "5x7 capitals only");
  assert.deepEqual(texts(shown), ["POLESKA", "21:37:26"], "POLESKA + HH:MM:SS do not fit one row: the clock moves to the second (no room left for the lines)");
  const clock = (s: number) => JSON.stringify(at(segs, s).elements);
  assert.notEqual(clock(6), clock(7), "the clock changes every second");
  assert.deepEqual(texts(at(segs, 20).elements), ["131", "1m 40s", "N", "3m 40s"], "countdown between the stop screens");
});

test("HH:MM clock: a stop screen is a single frame unless the minute changes", () => {
  const segs = boardSegments(deps, START, 500, opt({ info: { ...info, seconds: false } }), SOD);
  assert.equal(at(segs, 5).cs, 1000, "one 10 s frame");
});

test("departure animation: the vehicle appears next to the number and pulls it off to the right in 5 s", () => {
  const segs = boardSegments(deps, START, 500, opt(), SOD);
  const first = at(segs, 120);
  assert.ok(hasBitmap(first.elements), "sprite");
  assert.deepEqual(texts(first.elements), ["131", "N", "2m 10s"], "the second row stays as it was before the departure");
  assert.deepEqual(texts(at(segs, 119).elements), ["131", "10s", "N", "2m 10s"]);
  assert.deepEqual(texts(at(segs, 124.5).elements).slice(1), ["N", "2m 10s"], "frozen until the animation ends");
  const num = first.elements.find((e) => e.type === "text" && e.text === "131") as { x: number };
  const car = first.elements.find((e) => e.type === "bitmap") as { x: number };
  assert.equal(num.x, 0, "the number stays where it was");
  assert.equal(car.x, bigWidth("131") + 2, "the vehicle appears right of it");
  assert.equal(animStartCs(ANIM_FRAMES), 500, "5 s by default");
  assert.equal(animOffset(0), 0);
  assert.ok(animOffset(ANIM_FRAMES - 1) > 55, "almost gone at the end");
  for (let k = 1; k < ANIM_FRAMES; k++) assert.ok(animOffset(k) >= animOffset(k - 1), "it only moves right, speeding up");
  const late = at(segs, 124).elements.find((e) => e.type === "text" && e.text === "131") as { x: number };
  assert.ok(late.x > 0, "after 4 s the number is being pulled away");
  assert.deepEqual(texts(at(segs, 125).elements)[0], "POLESKA", "the 5 s animation ends exactly where the stop screen starts (:05)");
  const plain = boardSegments(deps, START, 500, opt({ info: null }), SOD);
  assert.deepEqual(texts(at(plain, 125).elements), ["N", "2m 00s", "7", "5m 00s"], "after the animation the next departure moves up");
  const quick = boardSegments(deps, START, 500, opt({ animMs: 1000 }), SOD);
  assert.ok(!hasBitmap(at(quick, 121.1).elements), "a 1 s animation is over after a second");
  const none = boardSegments(deps, START, 500, opt({ anim: false }), SOD);
  assert.ok(!hasBitmap(at(none, 120).elements));
});

test("stop screen: 5x7 capitals; the clock moves to the second row when it does not fit next to the name", () => {
  const right = (els: Element[], t: string) => {
    const e = els.find((x) => x.type === "text" && x.text === t) as { x: number; y: number } | undefined;
    return e ? { end: e.x + bigWidth(t), row: e.y === -2 ? 0 : 1 } : null;
  };
  const short = infoElements("Rynek", "21:37", ["131", "N"], "#fff");
  assert.deepEqual(texts(short), ["RYNEK", "21:37", "131, N"]);
  assert.deepEqual(right(short, "21:37"), { end: 64, row: 0 }, "short name: clock on the first row, right");
  const long = infoElements("Poleska", "21:37", ["131", "N"], "#fff");
  assert.deepEqual(texts(long), ["POLESKA", "21:37", "131, N"]);
  assert.deepEqual(right(long, "21:37"), { end: 64, row: 1 }, "POLESKA + 21:37 = 70 px: clock to the second row");
  const cut = infoElements("Plac Grunwaldzki Politechnika", "21:37:30", ["1", "2", "4", "10", "16", "19", "112", "113", "131", "N"], "#fff");
  const [name, clock, list] = texts(cut);
  assert.ok(bigWidth(name!) <= 64 && "PLAC GRUNWALDZKI".startsWith(name!), name);
  assert.equal(clock, "21:37:30");
  assert.ok(list!.endsWith("+") && bigWidth(list!) + 4 + bigWidth("21:37:30") <= 64, list);
  assert.ok(!cut.some((e) => e.type === "bitmap"));
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
