// One-shot setup of your own Worker: D1 database -> migrations -> deploy -> SETUP_TOKEN secret.
// Usage: npx wrangler login && npm install && npm run setup [-- --origin https://you.github.io]
//   --origin (or env ALLOWED_ORIGIN): comma-separated list of web origins allowed to call the Worker from a browser. Remembered in
//   wrangler.local.jsonc for later runs; "*" or nothing = any page.
// Writes wrangler.local.jsonc (your D1 id, git-ignored) and .setup-token (git-ignored) - never commit either.
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

// allowed web origin: --origin <list> > env ALLOWED_ORIGIN > what the previous run stored
const argIdx = process.argv.indexOf("--origin");
let origin = argIdx > -1 ? process.argv[argIdx + 1] : process.env.ALLOWED_ORIGIN;
if (origin === undefined && existsSync(LOCAL)) {
  try {
    origin = JSON.parse(readFileSync(LOCAL, "utf8").replace(/^﻿/, "")).vars?.ALLOWED_ORIGIN;
  } catch {
    /* ignore a broken local file; it is rewritten below */
  }
}
if (origin) {
  cfg.vars = { ...(cfg.vars ?? {}), ALLOWED_ORIGIN: origin };
  console.log("browser access limited to: " + origin);
} else console.log("browser access: any page (set --origin to restrict it)");
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

step("Checking the SETUP_TOKEN secret");
const secrets = wrangler(["secret", "list", "--format", "json", "-c", LOCAL]);
const has = secrets.ok && secrets.out.includes('"SETUP_TOKEN"');
if (has) console.log("SETUP_TOKEN already set - keeping it.");
else {
  const token = "k_" + randomBytes(24).toString("base64url");
  const put = wrangler(["secret", "put", "SETUP_TOKEN", "-c", LOCAL], token);
  if (!put.ok) fail("could not set SETUP_TOKEN", put.out);
  writeFileSync(".setup-token", token + "\n");
  console.log("SETUP_TOKEN generated and stored as a Worker secret (copy in cloudflare/.setup-token, git-ignored).");
}

console.log("\nDone. Open the admin page (web/admin/ on your GitHub Pages site), enter the Worker URL and the setup token,");
console.log("choose the admin password - then create panels in the browser. The setup token is only needed once.");
