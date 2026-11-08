// One-shot setup of your own Worker: D1 database -> migrations -> deploy -> ADMIN_TOKEN secret.
// Usage: npx wrangler login && npm install && npm run setup
// Writes wrangler.local.jsonc (your D1 id, git-ignored) and .admin-token (git-ignored) - never commit either.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const DB_NAME = "act1033-led";
const LOCAL = "wrangler.local.jsonc";

function wrangler(args, input) {
  const r = spawnSync("npx", ["wrangler", ...args], { encoding: "utf8", shell: true, input });
  return { ok: r.status === 0, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function step(msg) {
  console.log("\n==> " + msg);
}

function fail(msg, out) {
  console.error("\nFAILED: " + msg + (out ? "\n" + out : ""));
  process.exit(1);
}

step("Looking for the D1 database '" + DB_NAME + "'");
let id;
const list = wrangler(["d1", "list", "--json"]);
if (!list.ok) fail("could not list your D1 databases (network problem, or not logged in? run: npx wrangler login)", list.out);
{
  try {
    const rows = JSON.parse(list.out.slice(list.out.indexOf("[")));
    id = rows.find((d) => d.name === DB_NAME)?.uuid;
  } catch {
    /* fall through to create */
  }
}
if (id) console.log("found " + id);
else {
  step("Creating the D1 database");
  const created = wrangler(["d1", "create", DB_NAME]);
  id = /"database_id":\s*"([0-9a-f-]{36})"/.exec(created.out)?.[1];
  if (!created.ok || !id) fail("could not create the D1 database (are you logged in? run: npx wrangler login)", created.out);
  console.log("created " + id);
}

const cfg = JSON.parse(readFileSync("wrangler.jsonc", "utf8").replace(/^﻿/, ""));
cfg.d1_databases[0].database_id = id;
writeFileSync(LOCAL, JSON.stringify(cfg, null, 2) + "\n");
console.log("wrote " + LOCAL);

step("Applying database migrations");
const mig = wrangler(["d1", "migrations", "apply", DB_NAME, "--remote", "-c", LOCAL]);
if (!mig.ok) fail("migrations failed", mig.out);
console.log(mig.out.trim().split("\n").slice(-4).join("\n"));

step("Deploying the Worker");
const dep = wrangler(["deploy", "-c", LOCAL]);
if (!dep.ok) fail("deploy failed", dep.out);
console.log(dep.out.trim().split("\n").slice(-4).join("\n"));

step("Checking the ADMIN_TOKEN secret");
const secrets = wrangler(["secret", "list", "--format", "json", "-c", LOCAL]);
const has = secrets.ok && secrets.out.includes('"ADMIN_TOKEN"');
if (has) console.log("ADMIN_TOKEN already set - keeping it.");
else {
  const token = "a_" + randomBytes(32).toString("base64url");
  const put = wrangler(["secret", "put", "ADMIN_TOKEN", "-c", LOCAL], token);
  if (!put.ok) fail("could not set ADMIN_TOKEN", put.out);
  writeFileSync(".admin-token", token + "\n");
  console.log("ADMIN_TOKEN generated and stored as a Worker secret.");
  console.log("A copy is in cloudflare/.admin-token (git-ignored). Keep it private; it controls every panel.");
}

console.log("\nDone. Create your first panel (replace <worker-url> and the token):");
console.log('  curl -X POST <worker-url>/admin/panels -H "Authorization: Bearer <ADMIN_TOKEN>" -d \'{"id":"kitchen","name":"Kitchen"}\'');
