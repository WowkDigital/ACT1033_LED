// Public-transit departures job: a cron trigger renders the next departures for a stop into a 64x16 picture and stores it
// as the panel's image, so the panel runs on its own (no browser open). Data comes from the transit API in docs/API_GUIDE.md.

import { bearer } from "./auth.ts";
import { forbidden, getPanel, roleFor, storeImage, unauthorized, type Env, type PanelRow } from "./panels.ts";
import { parseColor, render } from "./render.ts";
import { RenderError, type Element } from "./types.ts";

export const DEFAULT_TRANSIT_URL = "https://wroclaw-transit.wowk-digital.workers.dev";

export interface MpkConfig {
  stop: string;
  lines: string;
  dir: string;
  color: string;
}

export interface Row {
  left: string;
  right: string;
}

export function parseConfig(input: unknown): MpkConfig {
  if (typeof input !== "object" || input === null) throw new RenderError("body must be a JSON object");
  const o = input as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const stop = str(o.stop);
  if (!/^[A-Za-z0-9]{1,12}$/.test(stop)) throw new RenderError('"stop" is required: stop code, letters and digits only');
  const lines = str(o.lines).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9,]{0,40}$/.test(lines)) throw new RenderError('"lines" must be comma-separated, e.g. 13,23');
  const dir = str(o.dir);
  // eslint-disable-next-line no-control-regex
  if (dir.length > 40 || /[\u0000-\u001f]/.test(dir)) throw new RenderError('"dir" is limited to 40 printable characters');
  const color = str(o.color) || "#ffb000";
  parseColor(color, 0); // validates
  return { stop, lines, dir, color };
}

/** Next departures for the stop, at most two rows. */
export async function fetchRows(env: Env, cfg: MpkConfig): Promise<{ stop: string; rows: Row[] }> {
  const url = new URL("/departures", env.TRANSIT_URL || DEFAULT_TRANSIT_URL);
  url.searchParams.set("stop", cfg.stop);
  url.searchParams.set("mode", "hybrid");
  url.searchParams.set("limit", "2");
  if (cfg.lines) url.searchParams.set("lines", cfg.lines);
  if (cfg.dir) url.searchParams.set("dir", cfg.dir);
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "act1033-led-worker" }, signal: AbortSignal.timeout(8000) });
  } catch {
    throw new RenderError("transit API is unreachable", 502);
  }
  if (res.status === 404 || res.status === 400) throw new RenderError("transit API does not know this stop", 400);
  if (!res.ok) throw new RenderError("transit API returned HTTP " + res.status, 502);
  const data = (await res.json()) as { stop?: string; departures?: { line?: string | number; min?: string | number; time?: string }[] };
  const rows = (data.departures ?? []).slice(0, 2).map((d) => ({
    left: String(d.line ?? "").slice(0, 5),
    right: d.min !== undefined && d.min !== "" ? String(d.min) + " min" : String(d.time ?? ""),
  }));
  return { stop: String(data.stop ?? ""), rows };
}

/** Two lines of 5x7 text (line number left, minutes right) as a static GIF. */
export function renderRows(rows: Row[], color: string): Uint8Array {
  const elements: Element[] = [];
  // text box y is the top of the accent rows; glyph row 0 sits 2 px lower, so y = -2 puts glyphs on pixel rows 0-6 and y = 7 on 9-15
  const tops = [-2, 7];
  if (rows.length === 0) elements.push({ type: "text", text: "NO DATA", color, y: tops[0], align: "left" });
  rows.forEach((r, i) => {
    elements.push({ type: "text", text: r.left || " ", color, y: tops[i], align: "left" });
    elements.push({ type: "text", text: r.right || " ", color, y: tops[i], align: "right" });
  });
  return render({ format: "gif", background: "#000000", elements }).body;
}

/** Fetches, renders and stores (only if the picture changed). */
export async function refreshPanel(env: Env, row: Pick<PanelRow, "id" | "etag">, cfg: MpkConfig) {
  const { stop, rows } = await fetchRows(env, cfg);
  const r = await storeImage(env, row, renderRows(rows, cfg.color), "image/gif", false);
  return { ...r, stop, rows };
}

/** Cron entry point: refresh every panel that has the departures job enabled. */
export async function runAll(env: Env): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id, etag, mpk FROM panels WHERE mpk_enabled = 1").all<{ id: string; etag: string | null; mpk: string | null }>();
  for (const p of results) {
    try {
      if (!p.mpk) continue;
      await refreshPanel(env, p, JSON.parse(p.mpk) as MpkConfig);
    } catch (e) {
      console.error("departures job failed for", p.id, e instanceof Error ? e.message : e);
    }
  }
}

// ---------------------------------------------------------------- HTTP: /panel/:id/mpk
export async function mpkRoute(request: Request, env: Env, id: string): Promise<Response> {
  const row = await getPanel(env, id);
  const role = await roleFor(env, bearer(request), row);
  if (!role) throw unauthorized();

  if (request.method === "GET") {
    return Response.json({ enabled: row.mpk_enabled === 1, config: row.mpk ? JSON.parse(row.mpk) : null });
  }
  if (role === "read") throw forbidden();

  if (request.method === "DELETE") {
    await env.DB.prepare("UPDATE panels SET mpk_enabled = 0 WHERE id = ?1").bind(id).run();
    return Response.json({ ok: true, enabled: false });
  }
  if (request.method === "PUT") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new RenderError("body must be valid JSON");
    }
    const cfg = parseConfig(body);
    const r = await refreshPanel(env, row, cfg); // fails fast on an unknown stop; nothing is saved then
    await env.DB.prepare("UPDATE panels SET mpk = ?1, mpk_enabled = 1 WHERE id = ?2").bind(JSON.stringify(cfg), id).run();
    return Response.json({ ok: true, enabled: true, config: cfg, stop_name: r.stop, rows: r.rows, changed: r.changed });
  }
  throw new RenderError("use GET, PUT or DELETE", 405);
}
