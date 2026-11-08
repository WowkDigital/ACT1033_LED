// Public-transit departures job: a cron trigger renders the next departures for a stop into a 64x16 picture and stores it
// as the panel's image, so the panel runs on its own (no browser open). Data comes from the transit API in docs/API_GUIDE.md.
//
// Two modes:
//  - "seconds" (default): a GIF that counts down in 10 s steps ("13   3m 10s", two rows = the next two departures), computed from
//    the TIMETABLE (exact HH:MM). Live GPS data is not used here: it only has rounded minutes, no heading (vehicles that just passed
//    or go the other way look "1 min away") and would turn a countdown to the second into a guess.
//    The panel plays the GIF by itself, so the countdown runs smoothly without a new upload every minute (every upload makes the
//    panel flash). One GIF has 50 frames (500 s) and is replaced every 5 minutes.
//  - "minutes": live vehicles + timetable ("hybrid"), a static picture ("13   12 min") rewritten whenever the minutes change.

import { bearer } from "./auth.ts";
import { forbidden, getPanel, roleFor, storeImage, unauthorized, type Env, type PanelRow } from "./panels.ts";
import { parseColor, render } from "./render.ts";
import { RenderError, type Element, type FrameSpec } from "./types.ts";

export const DEFAULT_TRANSIT_URL = "https://wroclaw-transit.wowk-digital.workers.dev";

export type Mode = "seconds" | "minutes";

export interface MpkConfig {
  stop: string;
  lines: string;
  dir: string;
  color: string;
  mode: Mode;
}

export interface Row {
  left: string;
  right: string;
}

/** One upcoming departure: `t` = epoch seconds, `exact` = known to the minute from the timetable (live vehicles only have rounded minutes). */
export interface Dep {
  l: string;
  t: number;
  x: boolean;
}

interface State {
  key: string; // JSON of the config the GIF was made for
  genAt: number; // epoch seconds
  deps: Dep[];
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
  const mode = str(o.mode) || "seconds";
  if (mode !== "seconds" && mode !== "minutes") throw new RenderError('"mode" must be "seconds" or "minutes"');
  return { stop, lines, dir, color, mode };
}

// ---------------------------------------------------------------- settings
const num = (v: string | undefined, d: number) => (v !== undefined && Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);

export function settings(env: Env) {
  return {
    frames: Math.min(num(env.MPK_FRAMES, 50), 200), // frames per GIF
    step: num(env.MPK_STEP_S, 10), // seconds per frame (the countdown resolution)
    refresh: num(env.MPK_REFRESH_S, 300), // a GIF is replaced at the latest after this many seconds
    lead: num(env.MPK_LEAD_S, 8), // expected seconds between generation and the picture appearing on the panel
  };
}

// ---------------------------------------------------------------- transit API
interface RawDep {
  line?: string | number;
  min?: string | number;
  time?: string;
}

async function fetchRaw(env: Env, cfg: MpkConfig, limit: number, source: "schedule" | "hybrid"): Promise<{ stop: string; list: RawDep[] }> {
  const url = new URL("/departures", env.TRANSIT_URL || DEFAULT_TRANSIT_URL);
  url.searchParams.set("stop", cfg.stop);
  url.searchParams.set("mode", source);
  url.searchParams.set("limit", String(limit));
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
  const data = (await res.json()) as { stop?: string; departures?: RawDep[] };
  return { stop: String(data.stop ?? ""), list: data.departures ?? [] };
}

function warsawSecondsOfDay(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(ms);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 3600 + get("minute") * 60 + get("second");
}

/** Absolute departure times. Timetable rows have HH:MM (Warsaw time) -> exact; live vehicles only a rounded `min` -> approximate. */
export function toDeps(list: RawDep[], nowMs: number, timetableOnly = false): Dep[] {
  const nowS = Math.floor(nowMs / 1000);
  const sod = warsawSecondsOfDay(nowMs);
  const out: Dep[] = [];
  for (const d of list) {
    const line = String(d.line ?? "").slice(0, 5);
    const m = d.time ? /^(\d{1,2}):(\d{2})$/.exec(d.time) : null;
    if (m) {
      let delta = Number(m[1]) * 3600 + Number(m[2]) * 60 - sod;
      if (delta < -43200) delta += 86400; // after midnight
      out.push({ l: line, t: nowS + delta, x: true });
    } else if (!timetableOnly && d.min !== undefined && d.min !== "") {
      const min = String(d.min).startsWith("<") ? 0.5 : Number(d.min);
      if (Number.isFinite(min)) out.push({ l: line, t: nowS + Math.round(min * 60), x: false });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Stable identity of a configuration (field order must not matter). */
export const cfgKey = (c: MpkConfig) => JSON.stringify([c.stop, c.lines, c.dir, c.color, c.mode]);

const upcoming = (deps: Dep[], atS: number) => deps.filter((d) => d.t - atS > 0).slice(0, 2);

/** "3m 10s" (resolution 10 s, floored), "45s" below a minute. */
export function formatRemaining(seconds: number, step = 10): string {
  const r = Math.max(0, Math.floor(seconds / step) * step);
  const m = Math.floor(r / 60);
  return m > 0 ? `${m}m ${String(r % 60).padStart(2, "0")}s` : `${r}s`;
}

// ---------------------------------------------------------------- rendering
const TOPS = [-2, 7]; // text box tops: glyph rows land on pixel rows 0-6 and 9-15

function rowElements(rows: Row[], color: string): Element[] {
  const els: Element[] = [];
  if (rows.length === 0) els.push({ type: "text", text: "NO DATA", color, y: TOPS[0], align: "left" });
  rows.forEach((r, i) => {
    els.push({ type: "text", text: r.left || " ", color, y: TOPS[i], align: "left" });
    els.push({ type: "text", text: r.right || " ", color, y: TOPS[i], align: "right" });
  });
  return els;
}

/** Two lines of 5x7 text as a static GIF (the "minutes" mode). */
export function renderRows(rows: Row[], color: string): Uint8Array {
  return render({ format: "gif", background: "#000000", elements: rowElements(rows, color) }).body;
}

/** Countdown GIF: frame k shows the next two departures as they will be at startS + k*step. */
export function renderCountdown(deps: Dep[], color: string, startS: number, frames: number, step: number): Uint8Array {
  const specs: FrameSpec[] = [];
  for (let k = 0; k < frames; k++) {
    const at = startS + k * step;
    const rows = upcoming(deps, at).map((d) => ({ left: d.l, right: formatRemaining(d.t - at, step) }));
    specs.push({ duration: step * 1000, elements: rowElements(rows, color) });
  }
  return render({ format: "gif", background: "#000000", frames: specs }).body;
}

// ---------------------------------------------------------------- when must the GIF be replaced?
export function needsRegen(state: State | null, key: string, fresh: Dep[], nowS: number, refresh: number): boolean {
  if (!state || state.key !== key) return true;
  if (nowS - state.genAt >= refresh) return true;
  const a = upcoming(state.deps, nowS);
  const b = upcoming(fresh, nowS);
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.l !== b[i]!.l) return true;
    const tol = a[i]!.x && b[i]!.x ? 20 : 90; // timetable rows never move; live estimates are rounded to a minute
    if (Math.abs(a[i]!.t - b[i]!.t) > tol) return true;
  }
  return false;
}

export interface RefreshResult {
  changed: boolean;
  regenerated: boolean;
  stop: string;
  rows: Row[];
}

/** Fetches, renders and stores. `force` = regenerate even if the stored GIF is still good (after a configuration change). */
export async function refreshPanel(
  env: Env,
  row: Pick<PanelRow, "id" | "etag"> & { mpk_state?: string | null },
  cfg: MpkConfig,
  force = false,
  nowMs = Date.now(),
): Promise<RefreshResult> {
  const nowS = Math.floor(nowMs / 1000);
  if (cfg.mode === "minutes") {
    const { stop, list } = await fetchRaw(env, cfg, 2, "hybrid");
    const rows = list.slice(0, 2).map((d) => ({
      left: String(d.line ?? "").slice(0, 5),
      right: d.min !== undefined && d.min !== "" ? String(d.min) + " min" : String(d.time ?? ""),
    }));
    const r = await storeImage(env, row, renderRows(rows, cfg.color), "image/gif", false, true);
    await env.DB.prepare("UPDATE panels SET mpk_state = NULL WHERE id = ?1").bind(row.id).run();
    return { changed: r.changed, regenerated: r.changed, stop, rows };
  }

  const s = settings(env);
  const { stop, list } = await fetchRaw(env, cfg, 8, "schedule");
  const deps = toDeps(list, nowMs, true); // timetable rows only: a countdown to the second must not be built on rounded minutes
  const rowsNow = upcoming(deps, nowS).map((d) => ({ left: d.l, right: formatRemaining(d.t - nowS, s.step) }));
  const key = cfgKey(cfg);
  let state: State | null = null;
  try {
    state = row.mpk_state ? (JSON.parse(row.mpk_state) as State) : null;
  } catch {
    state = null;
  }
  if (!force && !needsRegen(state, key, deps, nowS, s.refresh)) return { changed: false, regenerated: false, stop, rows: rowsNow };

  // frame 0 = the moment the picture is expected to appear on the panel, aligned to the step so a timetable row counts 3m 10s, 3m 00s, ...
  const startS = Math.floor((nowS + s.lead) / s.step) * s.step;
  const gif = deps.length ? renderCountdown(deps, cfg.color, startS, s.frames, s.step) : renderRows([], cfg.color);
  const r = await storeImage(env, row, gif, "image/gif", false, true);
  await env.DB.prepare("UPDATE panels SET mpk_state = ?1 WHERE id = ?2").bind(JSON.stringify({ key, genAt: nowS, deps }), row.id).run();
  return { changed: r.changed, regenerated: true, stop, rows: rowsNow };
}

/** Cron entry point: refresh every panel that has the departures job enabled. */
export async function runAll(env: Env, nowMs = Date.now()): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id, etag, mpk, mpk_state FROM panels WHERE mpk_enabled = 1").all<{
    id: string;
    etag: string | null;
    mpk: string | null;
    mpk_state: string | null;
  }>();
  for (const p of results) {
    try {
      if (!p.mpk) continue;
      const cfg = { mode: "seconds", ...(JSON.parse(p.mpk) as object) } as MpkConfig;
      await refreshPanel(env, p, cfg, false, nowMs);
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
    return Response.json({ enabled: row.mpk_enabled === 1, config: row.mpk ? { mode: "seconds", ...JSON.parse(row.mpk) } : null });
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
    const r = await refreshPanel(env, row, cfg, true); // fails fast on an unknown stop; nothing is saved then
    await env.DB.prepare("UPDATE panels SET mpk = ?1, mpk_enabled = 1 WHERE id = ?2").bind(JSON.stringify(cfg), id).run();
    return Response.json({ ok: true, enabled: true, config: cfg, stop_name: r.stop, rows: r.rows, changed: r.changed });
  }
  throw new RenderError("use GET, PUT or DELETE", 405);
}
