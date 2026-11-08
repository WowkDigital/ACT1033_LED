// Panel API backed by D1: admin management, image upload (write token) and download (read token).

import { bearer, randomToken, safeEqual, sha256hex } from "./auth.ts";
import { RenderError } from "./types.ts";

export interface Env {
  DB: D1Database;
  /** secret: full control (create / delete panels, write to any panel) */
  ADMIN_TOKEN?: string;
  /** optional var: restrict CORS to the site's origin, e.g. https://you.github.io (default *) */
  ALLOWED_ORIGIN?: string;
  /** optional vars (seconds): how often the ESP should poll when idle / right after a change, and how long "right after" lasts */
  POLL_IDLE_S?: string;
  POLL_BURST_S?: string;
  BURST_WINDOW_S?: string;
}

export const MAX_IMAGE = 64 * 1024;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

interface PanelRow {
  id: string;
  name: string;
  write_hash: string;
  read_hash: string;
  content_type: string | null;
  etag: string | null;
  size: number;
  created_at: number;
  updated_at: number | null;
}

const COLUMNS = "id, name, write_hash, read_hash, content_type, etag, size, created_at, updated_at";

export type Role = "admin" | "write" | "read" | null;

export async function isAdmin(env: Env, token: string | null): Promise<boolean> {
  if (!token || !env.ADMIN_TOKEN) return false;
  return safeEqual(await sha256hex(token), await sha256hex(env.ADMIN_TOKEN));
}

async function roleFor(env: Env, token: string | null, row: PanelRow): Promise<Role> {
  if (!token) return null;
  if (await isAdmin(env, token)) return "admin";
  const h = await sha256hex(token);
  if (safeEqual(h, row.write_hash)) return "write";
  if (safeEqual(h, row.read_hash)) return "read";
  return null;
}

/** Any valid token (admin or of any panel) - used to protect /render. */
export async function tokenIsValid(env: Env, token: string | null): Promise<boolean> {
  if (!token) return false;
  if (await isAdmin(env, token)) return true;
  const h = await sha256hex(token);
  const hit = await env.DB.prepare("SELECT 1 AS ok FROM panels WHERE write_hash = ?1 OR read_hash = ?1 LIMIT 1").bind(h).first();
  return !!hit;
}

const unauthorized = () => new RenderError("missing or invalid token", 401);
const forbidden = () => new RenderError("this token cannot do that", 403);

async function getPanel(env: Env, id: string): Promise<PanelRow> {
  if (!ID_RE.test(id)) throw new RenderError("invalid panel id", 400);
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM panels WHERE id = ?1`).bind(id).first<PanelRow>();
  if (!row) throw new RenderError("panel not found", 404);
  return row;
}

function meta(row: PanelRow) {
  return {
    id: row.id,
    name: row.name,
    has_image: !!row.etag,
    etag: row.etag,
    content_type: row.content_type,
    size: row.size,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------------------------------------------------------------- admin
async function requireAdmin(request: Request, env: Env): Promise<void> {
  if (!env.ADMIN_TOKEN) throw new RenderError("ADMIN_TOKEN is not configured on this Worker", 503);
  if (!(await isAdmin(env, bearer(request)))) throw unauthorized();
}

export async function adminCreate(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  let body: { id?: string; name?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* an empty body is fine */
  }
  const id = body.id ?? "p" + [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!ID_RE.test(id)) throw new RenderError("id must match [a-z0-9-], 1-32 chars, start with a letter or digit");
  const name = String(body.name ?? id).slice(0, 60);
  const writeToken = randomToken("w_");
  const readToken = randomToken("r_");
  try {
    await env.DB.prepare("INSERT INTO panels (id, name, write_hash, read_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(id, name, await sha256hex(writeToken), await sha256hex(readToken), Math.floor(Date.now() / 1000))
      .run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) throw new RenderError("a panel with this id already exists", 409);
    throw e;
  }
  return Response.json({ id, name, write_token: writeToken, read_token: readToken, note: "tokens are shown only once" }, { status: 201 });
}

export async function adminList(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const { results } = await env.DB.prepare(`SELECT ${COLUMNS} FROM panels ORDER BY created_at`).all<PanelRow>();
  return Response.json({ panels: results.map(meta) });
}

export async function adminDelete(request: Request, env: Env, id: string): Promise<Response> {
  await requireAdmin(request, env);
  await getPanel(env, id);
  await env.DB.prepare("DELETE FROM panels WHERE id = ?1").bind(id).run();
  return Response.json({ ok: true });
}

export async function adminRotate(request: Request, env: Env, id: string): Promise<Response> {
  await requireAdmin(request, env);
  await getPanel(env, id);
  let which = "both";
  try {
    which = ((await request.json()) as { which?: string }).which ?? "both";
  } catch {
    /* default */
  }
  if (!["write", "read", "both"].includes(which)) throw new RenderError('"which" must be write, read or both');
  const out: Record<string, string> = { id };
  if (which !== "read") {
    out.write_token = randomToken("w_");
    await env.DB.prepare("UPDATE panels SET write_hash = ?1 WHERE id = ?2").bind(await sha256hex(out.write_token), id).run();
  }
  if (which !== "write") {
    out.read_token = randomToken("r_");
    await env.DB.prepare("UPDATE panels SET read_hash = ?1 WHERE id = ?2").bind(await sha256hex(out.read_token), id).run();
  }
  return Response.json(out);
}

// ---------------------------------------------------------------- panel
function sniff(b: Uint8Array): string | null {
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  return null;
}

export async function panelMeta(request: Request, env: Env, id: string): Promise<Response> {
  const row = await getPanel(env, id);
  if (!(await roleFor(env, bearer(request), row))) throw unauthorized();
  return Response.json(meta(row));
}

export async function panelPut(request: Request, env: Env, id: string): Promise<Response> {
  const row = await getPanel(env, id);
  const role = await roleFor(env, bearer(request), row);
  if (!role) throw unauthorized();
  if (role === "read") throw forbidden();

  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_IMAGE) throw new RenderError(`image larger than ${MAX_IMAGE / 1024} KB`, 413);
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > MAX_IMAGE) throw new RenderError(`image larger than ${MAX_IMAGE / 1024} KB`, 413);
  const type = sniff(body);
  if (!type) throw new RenderError("body must be a GIF or PNG file", 415);

  const etag = `"${(await sha256hex(body)).slice(0, 16)}"`;
  if (etag === row.etag) return Response.json({ ok: true, changed: false, etag, size: body.length });
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("UPDATE panels SET image = ?1, content_type = ?2, etag = ?3, size = ?4, updated_at = ?5 WHERE id = ?6")
    .bind(body, type, etag, body.length, now, id)
    .run();
  return Response.json({ ok: true, changed: true, etag, size: body.length });
}

/** Seconds the ESP should wait before its next check: short right after a change (more edits are likely), long when idle. */
export function pollAfter(env: Env, updatedAt: number | null, now = Math.floor(Date.now() / 1000)): number {
  const num = (v: string | undefined, d: number) => (v !== undefined && Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
  const idle = num(env.POLL_IDLE_S, 30);
  const burst = num(env.POLL_BURST_S, 3);
  const window = num(env.BURST_WINDOW_S, 180);
  return updatedAt !== null && now - updatedAt < window ? burst : idle;
}

export async function panelImage(request: Request, env: Env, id: string): Promise<Response> {
  const row = await getPanel(env, id);
  if (!(await roleFor(env, bearer(request), row))) throw unauthorized();
  if (!row.etag) throw new RenderError("no image uploaded yet", 404);
  const headers = {
    ETag: row.etag,
    "Cache-Control": "no-cache",
    "X-Poll-After": String(pollAfter(env, row.updated_at)),
    "Access-Control-Expose-Headers": "ETag, X-Poll-After",
  };
  if (request.headers.get("If-None-Match") === row.etag) return new Response(null, { status: 304, headers });

  const r = await env.DB.prepare("SELECT image FROM panels WHERE id = ?1").bind(id).first<{ image: ArrayBuffer | number[] | null }>();
  if (!r?.image) throw new RenderError("no image uploaded yet", 404);
  const bytes = r.image instanceof ArrayBuffer ? new Uint8Array(r.image) : Uint8Array.from(r.image);
  return new Response(bytes, { headers: { ...headers, "Content-Type": row.content_type ?? "application/octet-stream" } });
}
