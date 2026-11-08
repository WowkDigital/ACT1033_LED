import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { parseConfig, renderRows } from "../src/mpk.ts";
import { makeDb } from "./d1shim.ts";

const ADMIN = "admin-secret";
const env = { DB: makeDb(), ADMIN_TOKEN: ADMIN, TRANSIT_URL: "https://transit.test" };
const call = (path: string, init: RequestInit & { token?: string } = {}) => {
  const { token, ...rest } = init;
  const headers = { ...(rest.headers as Record<string, string>), ...(token ? { Authorization: "Bearer " + token } : {}) };
  return worker.fetch(new Request("https://x" + path, { ...rest, headers }), env);
};

// --- fake transit API
let departures: { line: string; min?: string; time?: string }[] = [{ line: "249", min: "3" }, { line: "13", min: "7" }];
const requested: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const u = new URL(String(input instanceof Request ? input.url : input));
  if (u.origin !== "https://transit.test") return realFetch(input);
  requested.push(u.pathname + u.search);
  if (u.searchParams.get("stop") === "99999") return new Response('{"error":"unknown"}', { status: 404 });
  return Response.json({ stop: "Budziszyńska", departures });
}) as typeof fetch;

let tok: { write_token: string; read_token: string };
const getImage = async () => {
  const r = await call("/panel/bus/image", { token: tok.read_token });
  return { status: r.status, etag: r.headers.get("etag"), poll: r.headers.get("x-poll-after"), type: r.headers.get("content-type") };
};
const scheduled = async () => {
  const jobs: Promise<unknown>[] = [];
  await worker.scheduled!({} as ScheduledController, env, { waitUntil: (p: Promise<unknown>) => jobs.push(p) } as unknown as ExecutionContext);
  await Promise.all(jobs);
};

test("config validation", () => {
  assert.deepEqual(parseConfig({ stop: "12020", lines: "13, 23", dir: "Kowale" }), { stop: "12020", lines: "13,23", dir: "Kowale", color: "#ffb000" });
  assert.throws(() => parseConfig({}), /stop/);
  assert.throws(() => parseConfig({ stop: "12 020" }), /stop/);
  assert.throws(() => parseConfig({ stop: "1", lines: "13;rm" }), /lines/);
  assert.throws(() => parseConfig({ stop: "1", color: "nope" }), /colour/);
});

test("rows are drawn on two text lines (GIF, colours limited to text + background)", () => {
  const gif = renderRows([{ left: "249", right: "3 min" }, { left: "13", right: "7 min" }], "#ffb000");
  assert.equal(String.fromCharCode(...gif.subarray(0, 6)), "GIF89a");
  assert.equal(gif[6], 64);
  assert.equal(gif[8], 16);
  assert.ok(renderRows([], "#ffb000").length > 20); // "NO DATA"
});

test("enabling the job renders and stores a picture immediately", async () => {
  const r = await call("/admin/panels", { method: "POST", token: ADMIN, body: JSON.stringify({ id: "bus" }) });
  tok = await r.json();
  assert.equal((await call("/panel/bus/mpk")).status, 401);
  assert.equal((await call("/panel/bus/mpk", { method: "PUT", token: tok.read_token, body: JSON.stringify({ stop: "12020" }) })).status, 403);
  assert.equal((await call("/panel/bus/mpk", { method: "PUT", token: tok.write_token, body: JSON.stringify({ stop: "99999" }) })).status, 400);
  assert.equal(((await (await call("/panel/bus/mpk", { token: tok.write_token })).json()) as { enabled: boolean }).enabled, false); // nothing saved
  const ok = await call("/panel/bus/mpk", { method: "PUT", token: tok.write_token, body: JSON.stringify({ stop: "12020", lines: "249,13", dir: "Leśnica" }) });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { enabled: boolean; stop_name: string; rows: { left: string; right: string }[] };
  assert.equal(body.enabled, true);
  assert.equal(body.stop_name, "Budziszyńska");
  assert.deepEqual(body.rows, [{ left: "249", right: "3 min" }, { left: "13", right: "7 min" }]);
  assert.ok(requested.at(-1)!.includes("stop=12020") && requested.at(-1)!.includes("lines=249%2C13") && requested.at(-1)!.includes("limit=2"));
  const img = await getImage();
  assert.equal(img.status, 200);
  assert.equal(img.type, "image/gif");
  assert.equal(img.poll, "30", "an automatic update must not trigger the fast burst polling");
});

test("cron: unchanged departures are not rewritten, changed ones are", async () => {
  const before = (await getImage()).etag;
  await scheduled();
  assert.equal((await getImage()).etag, before);
  departures = [{ line: "249", min: "2" }, { line: "13", time: "17:05" }];
  await scheduled();
  const after = await getImage();
  assert.notEqual(after.etag, before);
  assert.equal(after.poll, "30");
});

test("a transit error keeps the last picture", async () => {
  const before = (await getImage()).etag;
  const saved = globalThis.fetch;
  globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
  await scheduled();
  globalThis.fetch = saved;
  assert.equal((await getImage()).etag, before);
});

test("a manual upload switches the job off and starts burst polling; DELETE also disables", async () => {
  const { render } = await import("../src/render.ts");
  const mine = render({ format: "gif", elements: [{ type: "text", text: "Mine" }] }).body;
  assert.equal((await call("/panel/bus", { method: "PUT", token: tok.write_token, body: mine })).status, 200);
  assert.equal(((await (await call("/panel/bus/mpk", { token: tok.write_token })).json()) as { enabled: boolean }).enabled, false);
  const etag = (await getImage()).etag;
  departures = [{ line: "1", min: "1" }];
  await scheduled();
  assert.equal((await getImage()).etag, etag, "cron must not overwrite a manual picture");
  assert.equal((await getImage()).poll, "3");
  // re-enable, then DELETE
  assert.equal((await call("/panel/bus/mpk", { method: "PUT", token: tok.write_token, body: JSON.stringify({ stop: "12020" }) })).status, 200);
  assert.notEqual((await getImage()).etag, etag);
  assert.equal((await call("/panel/bus/mpk", { method: "DELETE", token: tok.write_token })).status, 200);
  const cfg = (await (await call("/panel/bus/mpk", { token: tok.write_token })).json()) as { enabled: boolean; config: { stop: string } };
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.config.stop, "12020"); // configuration is kept
});
