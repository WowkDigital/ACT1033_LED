import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { formatRemaining, needsRegen, parseConfig, renderCountdown, renderRows, runAll, toDeps, type Dep } from "../src/mpk.ts";
import { makeDb } from "./d1shim.ts";
import { adminSession, SETUP_TOKEN } from "./session.ts";

const env = { DB: makeDb(), SETUP_TOKEN, TRANSIT_URL: "https://transit.test" };
const ADMIN = await adminSession(env);
const call = (path: string, init: RequestInit & { token?: string } = {}) => {
  const { token, ...rest } = init;
  const headers = { ...(rest.headers as Record<string, string>), ...(token ? { Authorization: "Bearer " + token } : {}) };
  return worker.fetch(new Request("https://x" + path, { ...rest, headers }), env);
};

// --- fake transit API
type Raw = { line: string; min?: string; time?: string };
let departures: Raw[] = [];
const requested: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const u = new URL(String(input instanceof Request ? input.url : input));
  if (u.origin !== "https://transit.test") return realFetch(input);
  requested.push(u.pathname + u.search);
  if (u.searchParams.get("stop") === "99999") return new Response('{"error":"unknown"}', { status: 404 });
  // like the real API: "schedule" returns timetable rows only, "hybrid" puts live vehicles (no `time`, rounded `min`) first
  const rows = u.searchParams.get("mode") === "schedule" ? departures.filter((d) => d.time) : departures;
  return Response.json({ stop: "Budziszyńska", departures: rows });
}) as typeof fetch;

const warsawHHMM = (ms: number) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(ms);
  return p.find((x) => x.type === "hour")!.value + ":" + p.find((x) => x.type === "minute")!.value;
};
/** timetable departure in `min` minutes from now */
const sched = (line: string, min: number): Raw => ({ line, time: warsawHHMM(Date.now() + min * 60000), min: String(min) });
const gifFrames = (b: Uint8Array) => {
  let n = 0;
  for (let i = 0; i < b.length - 1; i++) if (b[i] === 0x21 && b[i + 1] === 0xf9) n++;
  return n;
};
/** sum of all frame delays (1/100 s) */
const gifTotalCs = (b: Uint8Array) => {
  let n = 0;
  for (let i = 0; i < b.length - 5; i++) if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 4) n += b[i + 4]! | (b[i + 5]! << 8);
  return n;
};
const gifDelayCs = (b: Uint8Array) => {
  for (let i = 0; i < b.length - 5; i++) if (b[i] === 0x21 && b[i + 1] === 0xf9) return b[i + 4]! | (b[i + 5]! << 8);
  return -1;
};

let tok: { write_token: string; read_token: string };
/** the stored image as the control page sees it (the ESP's read token would re-time a countdown GIF, see the delivery test) */
const image = async () => {
  const r = await call("/panel/bus/image", { token: tok.write_token });
  const body = r.status === 200 ? new Uint8Array(await r.arrayBuffer()) : new Uint8Array();
  return { status: r.status, etag: r.headers.get("etag"), poll: r.headers.get("x-poll-after"), body };
};
const putMpk = (cfg: object) => call("/panel/bus/mpk", { method: "PUT", token: tok.write_token, body: JSON.stringify(cfg) });
const tick = (nowMs = Date.now()) => runAll(env, nowMs);

// ---------------------------------------------------------------- pure functions
test("config validation; seconds is the default mode", () => {
  assert.deepEqual(parseConfig({ stop: "12020", lines: "13, 23", dir: "Kowale" }), {
    stop: "12020",
    lines: "13,23",
    dir: "Kowale",
    color: "#ffb000",
    mode: "seconds",
    info_every: 40,
    info_for: 10,
    info_seconds: false,
    label: "",
    anim: true,
    anim_s: 3,
  });
  const off = parseConfig({ stop: "1", info_every: 0, anim: false, info_seconds: false, label: " Poleska " });
  assert.deepEqual([off.info_every, off.anim, off.info_seconds, off.label], [0, false, false, "Poleska"]);
  assert.equal(parseConfig({ stop: "1", info_every: 60, info_for: 15 }).info_for, 15);
  assert.throws(() => parseConfig({ stop: "1", info_every: 10, info_for: 10 }), /info_every/);
  assert.throws(() => parseConfig({ stop: "1", info_every: 5 }), /info_every/);
  assert.throws(() => parseConfig({ stop: "1", info_for: 2.5 }), /info_for/);
  assert.throws(() => parseConfig({ stop: "1", label: "x".repeat(25) }), /label/);
  assert.equal(parseConfig({ stop: "1", anim_s: 1.5 }).anim_s, 1.5);
  assert.throws(() => parseConfig({ stop: "1", anim_s: 20 }), /anim_s/);
  assert.equal(parseConfig({ stop: "1", mode: "minutes" }).mode, "minutes");
  assert.throws(() => parseConfig({}), /stop/);
  assert.throws(() => parseConfig({ stop: "12 020" }), /stop/);
  assert.throws(() => parseConfig({ stop: "1", lines: "13;rm" }), /lines/);
  assert.throws(() => parseConfig({ stop: "1", color: "nope" }), /colour/);
  assert.throws(() => parseConfig({ stop: "1", mode: "hours" }), /mode/);
});

test("countdown text: 10 s resolution, '3m 10s' style", () => {
  assert.equal(formatRemaining(190), "3m 10s");
  assert.equal(formatRemaining(180), "3m 00s");
  assert.equal(formatRemaining(189), "3m 00s");
  assert.equal(formatRemaining(60), "1m 00s");
  assert.equal(formatRemaining(59), "50s");
  assert.equal(formatRemaining(9), "0s");
  assert.equal(formatRemaining(-5), "0s");
  assert.equal(formatRemaining(125 * 60 + 40), "125m 40s");
});

test("timetable rows are exact (Warsaw time, midnight wrap); live rows are approximate", () => {
  const now = Date.UTC(2026, 10, 8, 22, 58, 0); // 23:58:00 in Warsaw (CET)
  const nowS = now / 1000;
  const d = toDeps([{ line: "13", time: "00:05", min: "7" }, { line: "23", time: "23:59", min: "1" }, { line: "249", min: "3" }, { line: "7", min: "<1" }], now);
  assert.deepEqual(d.map((x) => [x.l, x.t - nowS, x.x]), [["7", 30, false], ["23", 60, true], ["249", 180, false], ["13", 420, true]]);
});

test("timetable-only mode ignores rows without an exact time", () => {
  const now = Date.UTC(2026, 10, 8, 10, 0, 0);
  const raw = [{ line: "23", min: "1" }, { line: "13", time: "11:10", min: "70" }];
  assert.deepEqual(toDeps(raw, now, true).map((d) => d.l), ["13"]);
  assert.deepEqual(toDeps(raw, now).map((d) => d.l), ["23", "13"]); // the minutes mode still uses live rows
});

test("countdown GIF: 50 frames, 10 s per frame, small", () => {
  const nowS = Math.floor(Date.now() / 1000);
  const deps: Dep[] = [{ l: "13", t: nowS + 190, x: true }, { l: "23", t: nowS + 400, x: true }, { l: "134", t: nowS + 900, x: true }];
  const gif = renderCountdown(deps, "#ffb000", nowS, 50, 10);
  assert.equal(String.fromCharCode(...gif.subarray(0, 6)), "GIF89a");
  assert.equal(gifFrames(gif), 50);
  assert.equal(gifDelayCs(gif), 1000); // 10 s
  assert.ok(gif.length < 40 * 1024, "size " + gif.length);
  assert.ok(renderRows([], "#ffb000").length > 20);
});

test("regeneration rules", () => {
  const now = 1_000_000;
  const exact: Dep[] = [{ l: "13", t: now + 300, x: true }, { l: "23", t: now + 600, x: true }];
  const state = { key: "k", genAt: now - 100, deps: exact };
  assert.equal(needsRegen(null, "k", exact, now, 300), true, "no state");
  assert.equal(needsRegen(state, "other", exact, now, 300), true, "config changed");
  assert.equal(needsRegen(state, "k", exact, now, 300), false, "nothing changed");
  assert.equal(needsRegen({ ...state, genAt: now - 301 }, "k", exact, now, 300), true, "older than the refresh interval");
  assert.equal(needsRegen(state, "k", [{ l: "13", t: now + 310, x: true }, exact[1]!], now, 300), false, "timetable row within 20 s");
  assert.equal(needsRegen(state, "k", [{ l: "13", t: now + 340, x: true }, exact[1]!], now, 300), true, "timetable row moved by 40 s");
  const live = { ...state, deps: [{ l: "249", t: now + 120, x: false }] };
  assert.equal(needsRegen(live, "k", [{ l: "249", t: now + 170, x: false }], now, 300), false, "live estimate jitter (50 s) is tolerated");
  assert.equal(needsRegen(live, "k", [{ l: "249", t: now + 260, x: false }], now, 300), true, "live vehicle is 140 s later");
  assert.equal(needsRegen(live, "k", [{ l: "13", t: now + 120, x: true }], now, 300), true, "different line first");
  assert.equal(needsRegen(live, "k", [], now, 300), true, "tram vanished");
});

// ---------------------------------------------------------------- through the Worker
test("enabling the job (default mode) renders a 500 s countdown with the extras immediately", async () => {
  tok = await (await call("/admin/panels", { method: "POST", token: ADMIN, body: JSON.stringify({ id: "bus" }) })).json();
  departures = [sched("13", 3), sched("23", 7), sched("134", 12)];
  assert.equal((await call("/panel/bus/mpk")).status, 401);
  assert.equal((await call("/panel/bus/mpk", { method: "PUT", token: tok.read_token, body: JSON.stringify({ stop: "12020" }) })).status, 403);
  assert.equal((await putMpk({ stop: "99999" })).status, 400);
  assert.equal(((await (await call("/panel/bus/mpk", { token: tok.write_token })).json()) as { enabled: boolean }).enabled, false);

  const ok = await putMpk({ stop: "12020", lines: "13,23", dir: "Leśnica" });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as {
    enabled: boolean;
    config: { mode: string };
    stop_name: string;
    rows: { left: string; right: string }[];
    gif: { size: number; frames: number; seconds: number; dropped: string[] };
  };
  assert.equal(body.config.mode, "seconds");
  assert.equal(body.stop_name, "Budziszyńska");
  assert.deepEqual(body.rows.map((r) => r.left), ["13", "23"]);
  assert.match(body.rows[0]!.right, /^[0-3]m \d0s$/); // e.g. "2m 50s": second tram goes to the second row
  assert.ok(requested.at(-1)!.includes("limit=8") && requested.at(-1)!.includes("mode=schedule"), "the countdown is built from the timetable only");
  const img = await image();
  assert.equal(img.status, 200);
  const total = gifTotalCs(img.body);
  assert.ok(total > 49000 && total <= 50000, "the GIF covers the 500 s from its step boundary, minus the part before it is shown: " + total);
  assert.ok(gifFrames(img.body) > 50, "stop screens with a ticking clock add frames");
  assert.deepEqual(body.gif.dropped, []);
  assert.equal(body.gif.size, img.body.length);
  assert.ok(img.body.length <= 40 * 1024, "within the size budget: " + img.body.length);
  assert.equal(img.poll, "3", "a fresh regeneration is picked up quickly");
});

test("cron within the same GIF's lifetime does not replace it (no flashing every minute)", async () => {
  const before = (await image()).etag;
  for (const min of [1, 2, 3, 4]) await tick(Date.now() + min * 60000 - 60000 + 5000); // 5 s .. ~3 min later
  assert.equal((await image()).etag, before);
});

test("cron replaces the GIF when it is older than the refresh interval", async () => {
  const before = (await image()).etag;
  await tick(Date.now() + 301_000);
  const after = await image();
  assert.notEqual(after.etag, before);
  assert.ok(gifTotalCs(after.body) > 49000);
});

test("poll hint: fast right after a regeneration, idle afterwards", async () => {
  assert.equal((await image()).poll, "3");
  await env.DB.prepare("UPDATE panels SET fresh_at = ?1 WHERE id = 'bus'").bind(Math.floor(Date.now() / 1000) - 60).run();
  assert.equal((await image()).poll, "30");
});

test("extras off: the plain countdown of 50 frames x 10 s", async () => {
  departures = [sched("13", 3), sched("23", 7), sched("134", 12)];
  const r = await putMpk({ stop: "12020", lines: "13,23", info_every: 0, anim: false });
  assert.equal(r.status, 200);
  const img = await image();
  assert.ok([50, 51].includes(gifFrames(img.body)), "50 steps of 10 s, the first one cut at the moment the GIF is shown");
  assert.ok(gifDelayCs(img.body) <= 1000);
});

test("the ESP's download re-times the countdown: frame 0 = download + MPK_DELIVERY_LEAD_S", async () => {
  departures = [sched("13", 3), sched("23", 7), sched("134", 12)];
  await putMpk({ stop: "12020", lines: "13,23", info_every: 0, anim: false }); // plain 10 s frames: the first one is easy to check
  const stored = await image();
  const r = await call("/panel/bus/image", { token: tok.read_token, headers: { "If-None-Match": '"old"' } });
  assert.equal(r.status, 200);
  const etag = r.headers.get("etag");
  assert.notEqual(etag, stored.etag, "rebuilt for this moment");
  assert.equal((await image()).etag, etag, "and stored, so the next check is a 304");
  const again = await call("/panel/bus/image", { token: tok.read_token, headers: { "If-None-Match": etag! } });
  assert.equal(again.status, 304);
  // the first frame is cut so that it ends on a step boundary counted from download + lead
  const lead = 7;
  const first = gifDelayCs(new Uint8Array(await (await call("/panel/bus/image", { token: tok.write_token })).arrayBuffer()));
  const showMs = Date.now() + lead * 1000;
  const expect = Math.round((10_000 - (showMs % 10_000)) / 10);
  assert.ok(Math.abs(first - expect) <= 30 || Math.abs(first - expect) >= 970, `first frame ${first} cs, expected about ${expect}`);
});

test("a tight size budget gives the extras up instead of failing", async () => {
  departures = [sched("13", 3), sched("23", 4), sched("13", 5), sched("23", 6), sched("13", 8)];
  const tight = { ...env, MPK_MAX_BYTES: "9000" };
  const r = await worker.fetch(
    new Request("https://x/panel/bus/mpk", { method: "PUT", headers: { Authorization: "Bearer " + tok.write_token }, body: JSON.stringify({ stop: "12020" }) }),
    tight,
  );
  const body = (await r.json()) as { gif: { size: number; dropped: string[]; seconds: number } };
  assert.ok(body.gif.dropped.length > 0, "something was dropped");
  assert.ok(body.gif.seconds >= 360, "still longer than the refresh interval");
  assert.ok(body.gif.size <= 9000 || body.gif.dropped.includes("stop screen"), JSON.stringify(body.gif));
});

test("live vehicles never shorten the countdown (the reported bug: '1 min' for trams that just left)", async () => {
  // what the API returns around a platform shared by both directions: live vehicles 100-500 m away, then the timetable
  departures = [{ line: "23", min: "<1" }, { line: "13", min: "1" }, sched("23", 6), sched("13", 15)];
  const r = await putMpk({ stop: "12020", lines: "13,23" });
  const body = (await r.json()) as { rows: { left: string; right: string }[] };
  assert.deepEqual(body.rows.map((x) => x.left), ["23", "13"]);
  const minutes = body.rows.map((x) => Number(/^(\d+)m/.exec(x.right)?.[1] ?? 0));
  assert.deepEqual(minutes, [5, 14]); // 6 and 15 minutes minus the seconds already elapsed, not "30s" / "1m 00s"
  assert.ok(requested.at(-1)!.includes("mode=schedule"));
});

test("a transit error keeps the last picture", async () => {
  const before = (await image()).etag;
  const saved = globalThis.fetch;
  globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
  await tick(Date.now() + 400_000);
  globalThis.fetch = saved;
  assert.equal((await image()).etag, before);
});

test("minutes mode keeps the old static picture", async () => {
  departures = [{ line: "249", min: "3" }, { line: "13", min: "7" }];
  const r = await putMpk({ stop: "12020", mode: "minutes" });
  const body = (await r.json()) as { rows: { left: string; right: string }[] };
  assert.deepEqual(body.rows, [{ left: "249", right: "3 min" }, { left: "13", right: "7 min" }]);
  assert.ok(requested.at(-1)!.includes("mode=hybrid"), "minutes mode keeps live vehicles");
  const img = await image();
  assert.equal(gifFrames(img.body), 2);
  departures = [{ line: "249", min: "2" }, { line: "13", min: "6" }];
  await tick();
  assert.notEqual((await image()).etag, img.etag, "minutes mode rewrites when the minutes change");
});

test("a manual upload switches the job off; DELETE also disables and keeps the configuration", async () => {
  const { render } = await import("../src/render.ts");
  const mine = render({ format: "gif", elements: [{ type: "text", text: "Mine" }] }).body;
  assert.equal((await call("/panel/bus", { method: "PUT", token: tok.write_token, body: mine })).status, 200);
  assert.equal(((await (await call("/panel/bus/mpk", { token: tok.write_token })).json()) as { enabled: boolean }).enabled, false);
  const etag = (await image()).etag;
  await tick(Date.now() + 400_000);
  assert.equal((await image()).etag, etag, "cron must not overwrite a manual picture");
  assert.equal((await image()).poll, "3");
  assert.equal((await putMpk({ stop: "12020" })).status, 200);
  assert.notEqual((await image()).etag, etag);
  assert.equal((await call("/panel/bus/mpk", { method: "DELETE", token: tok.write_token })).status, 200);
  const cfg = (await (await call("/panel/bus/mpk", { token: tok.write_token })).json()) as { enabled: boolean; config: { stop: string } };
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.config.stop, "12020");
});
