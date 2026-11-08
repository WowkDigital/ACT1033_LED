// Rendering for the Debug tab and the status chip. Pure DOM building with textContent (server-provided strings are never
// inserted as HTML).
import { requestLog } from "./api.js";

const $ = (id) => document.getElementById(id);

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function ago(s) {
  if (s === null || s === undefined) return "never";
  s = Math.max(0, Math.round(s));
  if (s < 5) return "just now";
  if (s < 90) return s + " s ago";
  if (s < 5400) return Math.round(s / 60) + " min ago";
  if (s < 172800) return Math.round(s / 3600) + " h ago";
  return Math.round(s / 86400) + " d ago";
}
const clock = (sec) => new Date(sec * 1000).toLocaleTimeString([], { hour12: false });
const dateTime = (sec) => new Date(sec * 1000).toLocaleString();

export const KINDS = {
  delivered: ["ESP downloaded the image", "ok"],
  online: ["ESP came online", "ok"],
  poll: ["ESP poll result changed", ""],
  upload: ["Upload from this page", "info"],
  auto_update: ["Automatic update (departures)", "info"],
  auth_fail: ["Token rejected", "err"],
};

/** Server time minus browser time, so "x s ago" stays right even if this computer's clock is off. */
export const serverNow = (skew) => Date.now() / 1000 + skew;

export function espState(data, skew) {
  const last = data.esp.last_seen_at;
  const age = last === null ? null : serverNow(skew) - last;
  return { age, online: age !== null && age <= data.esp.offline_after_s };
}

/** Text for the header chip. */
export function chipFor(data, skew) {
  if (!data) return { text: "Not connected", cls: "off" };
  const { age, online } = espState(data, skew);
  if (age === null) return { text: "ESP never seen", cls: "warn" };
  return online ? { text: "ESP online · " + ago(age), cls: "ok" } : { text: "ESP offline · seen " + ago(age), cls: "err" };
}

function kv(dl, rows) {
  dl.replaceChildren();
  for (const [k, v, cls] of rows) {
    dl.append(el("dt", "", k), el("dd", cls || "", v));
  }
}

function detailText(d) {
  return Object.entries(d)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => k + "=" + v)
    .join("  ");
}

const hidden = new Set(); // event kinds the user switched off
let lastEvents = [];

export function renderFilters(onChange) {
  const box = $("d-filters");
  box.replaceChildren();
  for (const [kind, [label]] of Object.entries(KINDS)) {
    const lab = el("label", "check chip");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !hidden.has(kind);
    cb.addEventListener("change", () => {
      if (cb.checked) hidden.delete(kind);
      else hidden.add(kind);
      renderEvents(lastEvents);
      onChange?.();
    });
    lab.append(cb, document.createTextNode(label));
    box.append(lab);
  }
}

function renderEvents(events) {
  lastEvents = events;
  const body = $("d-events").tBodies[0];
  body.replaceChildren();
  const shown = events.filter((e) => !hidden.has(e.kind));
  if (!shown.length) {
    const tr = el("tr");
    const td = el("td", "empty", events.length ? "All events are filtered out" : "No events yet");
    td.colSpan = 3;
    tr.append(td);
    body.append(tr);
    return;
  }
  for (const e of shown) {
    const [label, cls] = KINDS[e.kind] || [e.kind, ""];
    const tr = el("tr");
    const t = el("td", "mono", clock(e.at));
    t.title = dateTime(e.at);
    const k = el("td");
    k.append(el("span", "badge " + cls, label));
    tr.append(t, k, el("td", "mono dim", detailText(e.detail)));
    body.append(tr);
  }
}

export function renderLog() {
  const body = $("d-log").tBodies[0];
  body.replaceChildren();
  if (!requestLog.length) {
    const tr = el("tr");
    const td = el("td", "empty", "Nothing sent from this page yet");
    td.colSpan = 4;
    tr.append(td);
    body.append(tr);
    return;
  }
  for (const r of requestLog) {
    const tr = el("tr");
    const ok = typeof r.status === "number" && r.status < 400;
    tr.append(
      el("td", "mono", new Date(r.at).toLocaleTimeString([], { hour12: false })),
      el("td", "mono", r.method + " " + r.path),
      el("td", "mono " + (ok ? "okc" : "errc"), String(r.status)),
      el("td", "mono dim", r.ms + " ms"),
    );
    body.append(tr);
  }
}

/** Fills the three status cards and the event table. ctx: { skew, latency } */
export function renderDebug(data, ctx) {
  const { age, online } = espState(data, ctx.skew);
  const e = data.esp;
  kv($("d-esp"), [
    ["Status", online ? "Online" : age === null ? "Never seen" : "Offline", online ? "okc" : age === null ? "warnc" : "errc"],
    ["Last check-in", age === null ? "never" : ago(age) + " (" + clock(e.last_seen_at) + ")"],
    ["Last result", e.last_status === 200 ? "200 – downloaded a new image" : e.last_status === 304 ? "304 – nothing new" : e.last_status ? String(e.last_status) : "–"],
    ["Asked to poll every", data.poll_after + " s"],
    ["Counted offline after", e.offline_after_s + " s"],
    ["Client", e.user_agent || "–"],
  ]);
  const p = data.panel;
  kv($("d-img"), [
    ["Panel", p.name + " (" + p.id + ")"],
    ["Image", p.has_image ? p.content_type + ", " + p.size + " B" : "none yet"],
    ["ETag", p.etag || "–", "mono"],
    ["Last change", p.updated_at ? ago(serverNow(ctx.skew) - p.updated_at) : "never"],
    ["Last manual upload", p.manual_at ? ago(serverNow(ctx.skew) - p.manual_at) : "never"],
    ["Departures job", p.mpk_enabled ? "running" : "off"],
  ]);
  kv($("d-net"), [
    ["Worker round trip", ctx.latency + " ms"],
    ["Clock difference", Math.abs(Math.round(ctx.skew)) + " s " + (ctx.skew >= 0 ? "(this computer is behind)" : "(this computer is ahead)")],
    ["Updated", new Date().toLocaleTimeString([], { hour12: false })],
  ]);
  renderEvents(data.events);
}

export function renderError(message) {
  for (const id of ["d-esp", "d-img", "d-net"]) kv($(id), [["Error", message, "errc"]]);
}

/** A report that is safe to paste into an issue: no tokens, no Worker URL. */
export function buildReport(data, ctx) {
  return JSON.stringify(
    {
      generated: new Date().toISOString(),
      clock_skew_s: Math.round(ctx.skew),
      worker_round_trip_ms: ctx.latency,
      server: data,
      page_requests: requestLog,
      browser: navigator.userAgent,
    },
    null,
    2,
  );
}
