// Public-transit departures job: a cron trigger renders the next departures for a stop into a 64x16 picture and stores it
// as the panel's image, so the panel runs on its own (no browser open). Data comes from the transit API in docs/API_GUIDE.md.
//
// Two modes:
//  - "seconds" (default): a GIF that counts down in 10 s steps ("13   3m 10s", two rows = the next two departures), computed from
//    the TIMETABLE (exact HH:MM). Live GPS data is not used here: it only has rounded minutes, no heading (vehicles that just passed
//    or go the other way look "1 min away") and would turn a countdown to the second into a guess.
//    The panel plays the GIF by itself, so the countdown runs smoothly without a new upload every minute (every upload makes the
//    panel flash). One GIF covers 500 s and is replaced every 5 minutes. Optional extras (board.ts): a stop screen with a clock
//    (default every 40 s for 10 s: "POLESKA 21:37" / "131, N", HH:MM:SS optional) and a bus / tram driving off when a departure leaves.
//    The GIF is kept under MPK_MAX_BYTES (40 KB) by giving up extras when needed (fitBoard).
//  - "minutes": live vehicles + timetable ("hybrid"), a static picture ("13   12 min") rewritten whenever the minutes change.

import { bearer } from "./auth.ts";
import {
  boardSegments,
  drawSegments,
  encodeBoard,
  fitBoard,
  formatRemaining,
  rowElements,
  sortLines,
  toDeps,
  upcoming,
  warsawSecondsOfDay,
  type BoardOptions,
  type Dep,
  type Row,
} from "./board.ts";
import { forbidden, getPanel, roleFor, storeImage, unauthorized, type Env, type PanelRow } from "./panels.ts";
import { parseColor, render } from "./render.ts";
import { RenderError } from "./types.ts";

export { formatRemaining, toDeps, type Dep, type Row };

export const DEFAULT_TRANSIT_URL = "https://wroclaw-transit.wowk-digital.workers.dev";

export type Mode = "seconds" | "minutes";

export interface MpkConfig {
  stop: string;
  lines: string;
  dir: string;
  color: string;
  mode: Mode;
  /** stop screen: starts every `info_every` s (0 = off) and stays `info_for` s */
  info_every: number;
  info_for: number;
  /** clock on the stop screen with seconds (HH:MM:SS) or without (HH:MM) */
  info_seconds: boolean;
  /** name on the stop screen; empty = the stop name from the transit API */
  label: string;
  /** a bus / tram drives off its row when a departure leaves */
  anim: boolean;
  /** how long the departure animation lasts, seconds (0.5-10) */
  anim_s: number;
}

interface State {
  key: string; // JSON of the config the GIF was made for
  genAt: number; // epoch seconds
  deps: Dep[];
  stop?: string; // stop name from the transit API (for re-timing at delivery)
  lines?: string[]; // lines for the stop screen
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
  const int = (v: unknown, d: number, name: string, lo: number, hi: number) => {
    if (v === undefined || v === null || v === "") return d;
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new RenderError(`"${name}" must be a whole number ${lo}..${hi}`);
    return n;
  };
  const bool = (v: unknown, d: boolean) => (v === undefined || v === null ? d : v === true || v === "true" || v === 1);
  const info_every = int(o.info_every, 40, "info_every", 0, 600);
  const info_for = int(o.info_for, 10, "info_for", 1, 120);
  if (info_every > 0 && (info_every < 10 || info_for >= info_every))
    throw new RenderError('"info_every" must be 0 (off), or 10 s or more and longer than "info_for"');
  const label = str(o.label);
  // eslint-disable-next-line no-control-regex
  if (label.length > 24 || /[\u0000-\u001f]/.test(label)) throw new RenderError('"label" is limited to 24 printable characters');
  let anim_s = 5;
  if (o.anim_s !== undefined && o.anim_s !== null && o.anim_s !== "") {
    anim_s = Number(o.anim_s);
    if (!Number.isFinite(anim_s) || anim_s < 0.5 || anim_s > 10) throw new RenderError('"anim_s" must be 0.5..10 seconds');
    anim_s = Math.round(anim_s * 10) / 10;
  }
  return { stop, lines, dir, color, mode, info_every, info_for, info_seconds: bool(o.info_seconds, false), label, anim: bool(o.anim, true), anim_s };
}

/** A stored configuration (older ones lack the newer fields) with the defaults filled in. */
export function normalize(stored: unknown): MpkConfig {
  return parseConfig({ mode: "seconds", ...(stored as object) });
}

// ---------------------------------------------------------------- settings
const num = (v: string | undefined, d: number) => (v !== undefined && Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);

export function settings(env: Env) {
  return {
    frames: Math.min(num(env.MPK_FRAMES, 50), 200), // countdown steps per GIF (50 x 10 s = 500 s)
    step: num(env.MPK_STEP_S, 10), // seconds per countdown step (the countdown resolution)
    refresh: num(env.MPK_REFRESH_S, 300), // a GIF is replaced at the latest after this many seconds
    lead: num(env.MPK_LEAD_S, 8), // expected seconds between generation and the picture appearing on the panel (used until the ESP downloads it)
    deliveryLead: Number.isFinite(Number(env.MPK_DELIVERY_LEAD_S)) && env.MPK_DELIVERY_LEAD_S ? Number(env.MPK_DELIVERY_LEAD_S) : 9, // s from the ESP's download to the picture on the panel; may be fractional; 9 measured with a camera
    maxBytes: Math.min(num(env.MPK_MAX_BYTES, 40 * 1024), 60 * 1024), // GIF size budget (the Worker and the ESP accept up to 64 KB)
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

/** Stable identity of a configuration (field order must not matter). */
export const cfgKey = (c: MpkConfig) =>
  JSON.stringify([c.stop, c.lines, c.dir, c.color, c.mode, c.info_every, c.info_for, c.info_seconds, c.label, c.anim, c.anim_s]);

// ---------------------------------------------------------------- rendering
/** Two lines of 5x7 text as a static GIF (the "minutes" mode). */
export function renderRows(rows: Row[], color: string): Uint8Array {
  return render({ format: "gif", background: "#000000", elements: rowElements(rows, color) }).body;
}

/** Board options of a configuration. `stopName` and `lines` feed the stop screen. */
export function boardOptions(cfg: MpkConfig, step: number, stopName: string, lines: string[]): BoardOptions {
  return {
    color: cfg.color,
    step,
    anim: cfg.anim,
    animMs: cfg.anim_s * 1000,
    info: cfg.info_every > 0 ? { every: cfg.info_every, dur: cfg.info_for, seconds: cfg.info_seconds, label: cfg.label || stopName, lines } : null,
  };
}

/** Plain countdown GIF (no extras): the next two departures as they will be at startS + k*step. */
export function renderCountdown(deps: Dep[], color: string, startS: number, frames: number, step: number): Uint8Array {
  const opt: BoardOptions = { color, step, info: null, anim: false };
  return encodeBoard(drawSegments(boardSegments(deps, startS, frames * step, opt, warsawSecondsOfDay(startS * 1000))));
}

/** Lines for the stop screen: the chosen ones, or every line found in the next departures. */
export function infoLines(cfg: MpkConfig, list: RawDep[]): string[] {
  const chosen = cfg.lines ? cfg.lines.split(",") : list.map((d) => String(d.line ?? ""));
  return [...new Set(chosen.filter(Boolean))].sort(sortLines);
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
  /** set when a countdown GIF was generated: its size, frames, length (s) and the extras given up to fit the size budget */
  gif?: { size: number; frames: number; seconds: number; dropped: string[] };
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
  // the stop screen lists every line when none is chosen, so it needs a longer look-ahead
  const { stop, list } = await fetchRaw(env, cfg, cfg.info_every > 0 && !cfg.lines ? 20 : 8, "schedule");
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

  // frame 0 = the moment the picture is expected to appear on the panel (rebuilt when the ESP downloads it, see retimeForDelivery)
  const lines = infoLines(cfg, list);
  const fit = buildGif(cfg, s, deps, stop, lines, nowMs + s.lead * 1000);
  const r = await storeImage(env, row, fit.gif, "image/gif", false, true);
  const st: State = { key, genAt: nowS, deps, stop, lines };
  await env.DB.prepare("UPDATE panels SET mpk_state = ?1 WHERE id = ?2").bind(JSON.stringify(st), row.id).run();
  const gif = { size: fit.gif.length, frames: fit.frames, seconds: fit.horizonS, dropped: fit.dropped };
  return { changed: r.changed, regenerated: true, stop, rows: rowsNow, gif };
}

/**
 * The GIF whose first frame is shown at `showMs` (epoch ms). The timeline is built from the step boundary before it (so the
 * countdown changes on round seconds: 3m 10s, 3m 00s, ...) and the part before `showMs` is cut off, to 1/100 s.
 */
function buildGif(cfg: MpkConfig, s: ReturnType<typeof settings>, deps: Dep[], stop: string, lines: string[], showMs: number) {
  const horizon = s.frames * s.step;
  const startS = Math.floor(showMs / 1000 / s.step) * s.step;
  const skipCs = Math.round((showMs - startS * 1000) / 10);
  const opt = boardOptions(cfg, s.step, stop, lines);
  return fitBoard(deps, startS, horizon, Math.min(horizon, s.refresh + 60), opt, warsawSecondsOfDay(startS * 1000), s.maxBytes, skipCs);
}

/**
 * Called when the ESP downloads a changed image. The ESP checks only every 30 s when idle, so a GIF made by the cron job
 * reaches the panel 0-30 s later than planned and the countdown / clock would be that much late. Instead the GIF is rebuilt
 * from the stored timetable right now, with frame 0 = now + MPK_DELIVERY_LEAD_S (the BLE upload and the panel's switch).
 * Returns the updated row, or null when the image is not a countdown GIF of the departures job.
 */
export async function retimeForDelivery(env: Env, row: PanelRow, nowMs = Date.now()): Promise<PanelRow | null> {
  if (row.mpk_enabled !== 1 || !row.mpk || !row.mpk_state) return null;
  const cfg = normalize(JSON.parse(row.mpk));
  const state = JSON.parse(row.mpk_state) as State;
  if (cfg.mode !== "seconds" || state.key !== cfgKey(cfg) || state.stop === undefined || !state.lines) return null;
  const s = settings(env);
  const fit = buildGif(cfg, s, state.deps, state.stop, state.lines, nowMs + s.deliveryLead * 1000);
  const r = await storeImage(env, row, fit.gif, "image/gif", false, false);
  return { ...row, etag: r.etag, size: r.size };
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
      await refreshPanel(env, p, normalize(JSON.parse(p.mpk)), false, nowMs);
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
    return Response.json({ enabled: row.mpk_enabled === 1, config: row.mpk ? normalize(JSON.parse(row.mpk)) : null });
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
    const warning = r.rows.length ? undefined : "no timetable departures match this stop, lines and direction right now, so the panel shows NO DATA. Check the lines and direction.";
    return Response.json({ ok: true, enabled: true, config: cfg, stop_name: r.stop, rows: r.rows, changed: r.changed, gif: r.gif, warning });
  }
  throw new RenderError("use GET, PUT or DELETE", 405);
}
