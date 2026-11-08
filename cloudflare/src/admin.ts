// Web admin login: password (PBKDF2 hash in D1) -> short-lived HMAC-signed session token. No static admin token exists.
//   GET  /admin/status           {configured}
//   POST /admin/setup            {password, setup_token}   first run only; needs the SETUP_TOKEN Worker secret
//   POST /admin/login            {password}                -> {session, expires_at}
//   POST /admin/password         {old_password, new_password}     (session) also signs every other session out
//   POST /admin/logout-all       (session)                 signs every session out
//   POST /admin/reset            {mode: "tokens"|"all"}    (session) rotate every panel's tokens / delete every panel

import { bearer, randomToken, safeEqual, sha256hex } from "./auth.ts";
import type { Env } from "./panels.ts";
import { RenderError } from "./types.ts";

const ITERATIONS = 100_000; // the maximum the Workers runtime accepts for PBKDF2
const SESSION_TTL_S = 8 * 3600;
const MAX_FAILS = 5;
const LOCK_S = 300;
const MIN_PASSWORD = 10;

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
const now = () => Math.floor(Date.now() / 1000);

async function getSetting(env: Env, key: string): Promise<string | null> {
  const r = await env.DB.prepare("SELECT value FROM admin_settings WHERE key = ?1").bind(key).first<{ value: string }>();
  return r?.value ?? null;
}
async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare("INSERT INTO admin_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return hex(new Uint8Array(bits));
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${hex(salt)}$${await pbkdf2(password, salt, ITERATIONS)}`;
}

async function checkPassword(env: Env, password: string): Promise<boolean> {
  const stored = await getSetting(env, "password_hash");
  if (!stored) return false;
  const [, iter, salt, want] = stored.split("$");
  return safeEqual(await pbkdf2(password, unhex(salt!), Number(iter)), want!);
}

export async function isConfigured(env: Env): Promise<boolean> {
  return (await getSetting(env, "password_hash")) !== null;
}

// ---------------------------------------------------------------- sessions
async function sessionSecret(env: Env, rotate = false): Promise<string> {
  let s = rotate ? null : await getSetting(env, "session_secret");
  if (!s) {
    s = hex(crypto.getRandomValues(new Uint8Array(32)));
    await setSetting(env, "session_secret", s);
  }
  return s;
}

async function sign(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", unhex(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text))));
}

async function newSession(env: Env): Promise<{ session: string; expires_at: number }> {
  const exp = now() + SESSION_TTL_S;
  return { session: `s_${exp}.${await sign(await sessionSecret(env), "s_" + exp)}`, expires_at: exp };
}

/** True for a valid, unexpired session token. Panel tokens (w_ / r_) are rejected without touching the database. */
export async function isAdminSession(env: Env, token: string | null): Promise<boolean> {
  const m = token && /^s_(\d+)\.([0-9a-f]{64})$/.exec(token);
  if (!m || Number(m[1]) < now()) return false;
  const secret = await getSetting(env, "session_secret");
  return !!secret && safeEqual(await sign(secret, "s_" + m[1]), m[2]!);
}

// ---------------------------------------------------------------- brute-force lock
const clientIp = (request: Request) => request.headers.get("CF-Connecting-IP") ?? "local";

async function assertNotLocked(env: Env, ip: string): Promise<void> {
  const r = await env.DB.prepare("SELECT locked_until FROM login_attempts WHERE ip = ?1").bind(ip).first<{ locked_until: number }>();
  if (r && r.locked_until > now()) throw new RenderError(`too many attempts, try again in ${r.locked_until - now()} s`, 429);
}
async function recordFail(env: Env, ip: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO login_attempts (ip, fails, locked_until) VALUES (?1, 1, 0)
     ON CONFLICT(ip) DO UPDATE SET fails = CASE WHEN locked_until > 0 AND locked_until <= ?2 THEN 1 ELSE fails + 1 END,
       locked_until = CASE WHEN (CASE WHEN locked_until > 0 AND locked_until <= ?2 THEN 1 ELSE fails + 1 END) >= ?3 THEN ?2 + ?4 ELSE 0 END`,
  )
    .bind(ip, now(), MAX_FAILS, LOCK_S)
    .run();
}
const clearFails = (env: Env, ip: string) => env.DB.prepare("DELETE FROM login_attempts WHERE ip = ?1").bind(ip).run();

// ---------------------------------------------------------------- routes
async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new RenderError("body must be valid JSON");
  }
}

function checkNewPassword(p: unknown): string {
  if (typeof p !== "string" || p.length < MIN_PASSWORD) throw new RenderError(`password must have at least ${MIN_PASSWORD} characters`);
  if (p.length > 200) throw new RenderError("password too long");
  return p;
}

async function requireSession(request: Request, env: Env): Promise<void> {
  if (!(await isConfigured(env))) throw new RenderError("admin password is not set up yet", 503);
  if (!(await isAdminSession(env, bearer(request)))) throw new RenderError("missing or invalid token", 401);
}
export { requireSession };

/** Handles the auth-related /admin/* routes; returns null for anything else. */
export async function adminAuthRoute(request: Request, env: Env, path: string): Promise<Response | null> {
  const method = request.method;
  const post = () => {
    if (method !== "POST") throw new RenderError("use POST", 405);
  };

  if (path === "/admin/status") return Response.json({ configured: await isConfigured(env), setup_available: !!env.SETUP_TOKEN });

  if (path === "/admin/setup") {
    post();
    if (await isConfigured(env)) throw new RenderError("the admin password is already set", 409);
    if (!env.SETUP_TOKEN) throw new RenderError("SETUP_TOKEN is not configured on this Worker", 503);
    const ip = clientIp(request);
    await assertNotLocked(env, ip);
    const b = await body<{ password?: string; setup_token?: string }>(request);
    const given = await sha256hex(String(b.setup_token ?? ""));
    if (!safeEqual(given, await sha256hex(env.SETUP_TOKEN))) {
      await recordFail(env, ip);
      throw new RenderError("wrong setup token", 401);
    }
    await setSetting(env, "password_hash", await hashPassword(checkNewPassword(b.password)));
    await sessionSecret(env, true);
    await clearFails(env, ip);
    return Response.json(await newSession(env), { status: 201 });
  }

  if (path === "/admin/login") {
    post();
    if (!(await isConfigured(env))) throw new RenderError("admin password is not set up yet", 503);
    const ip = clientIp(request);
    await assertNotLocked(env, ip);
    const b = await body<{ password?: string }>(request);
    if (typeof b.password !== "string" || !(await checkPassword(env, b.password))) {
      await recordFail(env, ip);
      throw new RenderError("wrong password", 401);
    }
    await clearFails(env, ip);
    return Response.json(await newSession(env));
  }

  if (path === "/admin/password") {
    post();
    await requireSession(request, env);
    const b = await body<{ old_password?: string; new_password?: string }>(request);
    const ip = clientIp(request);
    await assertNotLocked(env, ip);
    if (typeof b.old_password !== "string" || !(await checkPassword(env, b.old_password))) {
      await recordFail(env, ip);
      throw new RenderError("wrong current password", 401);
    }
    await setSetting(env, "password_hash", await hashPassword(checkNewPassword(b.new_password)));
    await sessionSecret(env, true);
    await clearFails(env, ip);
    return Response.json(await newSession(env));
  }

  if (path === "/admin/logout-all") {
    post();
    await requireSession(request, env);
    await sessionSecret(env, true);
    return Response.json({ ok: true });
  }

  if (path === "/admin/reset") {
    post();
    await requireSession(request, env);
    const b = await body<{ mode?: string; count?: number }>(request);
    if (b.mode === "all") {
      await env.DB.prepare("DELETE FROM panels").run();
      return Response.json({ ok: true, panels: [] });
    }
    if (b.mode === "tokens") {
      const { results } = await env.DB.prepare("SELECT id FROM panels ORDER BY created_at").all<{ id: string }>();
      const out = [];
      for (const { id } of results) {
        const write_token = randomToken("w_");
        const read_token = randomToken("r_");
        await env.DB.prepare("UPDATE panels SET write_hash = ?1, read_hash = ?2 WHERE id = ?3")
          .bind(await sha256hex(write_token), await sha256hex(read_token), id)
          .run();
        out.push({ id, write_token, read_token });
      }
      return Response.json({ ok: true, panels: out, note: "tokens are shown only once" });
    }
    throw new RenderError('"mode" must be "tokens" or "all"');
  }

  return null;
}
