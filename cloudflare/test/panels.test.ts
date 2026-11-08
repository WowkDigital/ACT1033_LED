import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { render } from "../src/render.ts";
import { makeDb } from "./d1shim.ts";

const ADMIN = "admin-secret";
const env = { DB: makeDb(), ADMIN_TOKEN: ADMIN };
const call = (path: string, init: RequestInit & { token?: string } = {}) => {
  const { token, ...rest } = init;
  const headers = { ...(rest.headers as Record<string, string>), ...(token ? { Authorization: "Bearer " + token } : {}) };
  return worker.fetch(new Request("https://x" + path, { ...rest, headers }), env);
};

const gif = render({ format: "gif", elements: [{ type: "text", text: "Hi" }] }).body;
const gif2 = render({ format: "gif", elements: [{ type: "text", text: "Yo" }] }).body;
let kitchen: { write_token: string; read_token: string };
let garage: { write_token: string; read_token: string };

test("admin endpoints need the admin token", async () => {
  assert.equal((await call("/admin/panels")).status, 401);
  assert.equal((await call("/admin/panels", { token: "w_wrong" })).status, 401);
  assert.equal((await call("/admin/panels", { token: ADMIN })).status, 200);
  const noAdmin = await worker.fetch(new Request("https://x/admin/panels"), { DB: makeDb() });
  assert.equal(noAdmin.status, 503);
});

test("create panels; tokens are returned once and differ", async () => {
  const r = await call("/admin/panels", { method: "POST", token: ADMIN, body: JSON.stringify({ id: "kitchen", name: "Kitchen" }) });
  assert.equal(r.status, 201);
  kitchen = await r.json();
  assert.match(kitchen.write_token, /^w_[\w-]{43}$/);
  assert.match(kitchen.read_token, /^r_[\w-]{43}$/);
  garage = await (await call("/admin/panels", { method: "POST", token: ADMIN, body: JSON.stringify({ id: "garage" }) })).json();
  assert.equal((await call("/admin/panels", { method: "POST", token: ADMIN, body: JSON.stringify({ id: "kitchen" }) })).status, 409);
  assert.equal((await call("/admin/panels", { method: "POST", token: ADMIN, body: JSON.stringify({ id: "Bad Id!" }) })).status, 400);
  const list = (await (await call("/admin/panels", { token: ADMIN })).json()) as { panels: { id: string }[] };
  assert.deepEqual(list.panels.map((p) => p.id), ["kitchen", "garage"]);
  assert.ok(!JSON.stringify(list).includes("hash"), "hashes must not leak");
});

test("upload needs the write token of that panel", async () => {
  const put = (token?: string, id = "kitchen", body: Uint8Array = gif) => call("/panel/" + id, { method: "PUT", token, body });
  assert.equal((await put()).status, 401);
  assert.equal((await put(kitchen.read_token)).status, 403);
  assert.equal((await put(garage.write_token)).status, 401);
  assert.equal((await put(kitchen.write_token, "kitchen", new TextEncoder().encode("not an image"))).status, 415);
  assert.equal((await put(kitchen.write_token, "kitchen", new Uint8Array(70 * 1024))).status, 413);
  const ok = await put(kitchen.write_token);
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { changed: boolean }).changed, true);
  const same = (await (await put(kitchen.write_token)).json()) as { changed: boolean };
  assert.equal(same.changed, false);
  assert.equal((await put(ADMIN)).status, 200);
  assert.equal((await put(kitchen.write_token, "nope")).status, 404);
});

test("download with read token, ETag and 304", async () => {
  assert.equal((await call("/panel/kitchen/image")).status, 401);
  assert.equal((await call("/panel/kitchen/image", { token: garage.read_token })).status, 401);
  const r = await call("/panel/kitchen/image", { token: kitchen.read_token });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/gif");
  const etag = r.headers.get("etag")!;
  assert.ok(etag);
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), gif);
  const cached = await call("/panel/kitchen/image", { token: kitchen.read_token, headers: { "If-None-Match": etag } });
  assert.equal(cached.status, 304);
  await call("/panel/kitchen", { method: "PUT", token: kitchen.write_token, body: gif2 });
  const changed = await call("/panel/kitchen/image", { token: kitchen.read_token, headers: { "If-None-Match": etag } });
  assert.equal(changed.status, 200);
  assert.deepEqual(new Uint8Array(await changed.arrayBuffer()), gif2);
  assert.equal((await call("/panel/garage/image", { token: garage.read_token })).status, 404);
});

test("any panel token unlocks /render; rotate invalidates the old token", async () => {
  assert.equal((await call("/render?text=A", { token: kitchen.read_token })).status, 200);
  const rot = (await (await call("/admin/panels/kitchen/rotate", { method: "POST", token: ADMIN, body: JSON.stringify({ which: "read" }) })).json()) as {
    read_token: string;
    write_token?: string;
  };
  assert.equal(rot.write_token, undefined);
  assert.equal((await call("/panel/kitchen/image", { token: kitchen.read_token })).status, 401);
  assert.equal((await call("/render?text=A", { token: kitchen.read_token })).status, 401);
  assert.equal((await call("/panel/kitchen/image", { token: rot.read_token })).status, 200);
  assert.equal((await call("/panel/kitchen", { method: "PUT", token: kitchen.write_token, body: gif })).status, 200);
});

test("delete panel; CORS headers present", async () => {
  assert.equal((await call("/admin/panels/garage", { method: "DELETE", token: ADMIN })).status, 200);
  assert.equal((await call("/panel/garage", { token: garage.read_token })).status, 404);
  const pre = await call("/panel/kitchen", { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("access-control-allow-headers")!, /Authorization/);
  const restricted = await worker.fetch(new Request("https://x/health"), { DB: makeDb(), ALLOWED_ORIGIN: "https://me.github.io" });
  assert.equal(restricted.headers.get("access-control-allow-origin"), "https://me.github.io");
});
