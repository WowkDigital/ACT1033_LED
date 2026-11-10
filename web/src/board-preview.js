// Live preview of the departure board in the Departures tab. Uses the Worker's own board code (cloudflare/src/board.ts), so the
// canvas shows the same frames the Worker will put into the GIF: countdown, stop screen with the clock, departure animation.
// It plays in step with the real clock, like the panel does.
import { fitBoard, rowElements, sortLines, toDeps, warsawSecondsOfDay } from "../../cloudflare/src/board.ts";
import { buildAnimation } from "../../cloudflare/src/render.ts";

// the Worker's defaults (cloudflare/src/mpk.ts settings())
const STEP = 10;
const HORIZON = 500;
const MIN_HORIZON = 360;
const MAX_BYTES = 40 * 1024;

const $ = (id) => document.getElementById(id);
let timer = null;
let last = null; // { list, stopName } of the last transit answer

/** The extras as the Worker will get them (same field names as PUT /panel/:id/mpk). */
export function extrasFromForm() {
  const n = (id, d) => {
    const v = Math.round(Number($(id).value));
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return {
    info_every: $("m-info-on").checked ? n("m-info-every", 40) : 0,
    info_for: n("m-info-for", 10),
    info_seconds: $("m-info-clock").value === "hms",
    label: $("m-label").value.trim(),
    anim: $("m-anim").checked,
    anim_s: Math.min(10, Math.max(0.5, Number($("m-anim-s").value) || 5)),
  };
}

/** Puts a saved configuration back into the form. */
export function extrasToForm(cfg) {
  $("m-info-on").checked = cfg.info_every !== 0;
  $("m-info-every").value = cfg.info_every || 40;
  $("m-info-for").value = cfg.info_for || 10;
  $("m-info-clock").value = cfg.info_seconds ? "hms" : "hm";
  $("m-label").value = cfg.label || "";
  $("m-anim").checked = cfg.anim !== false;
  $("m-anim-s").value = cfg.anim_s || 5;
  syncExtras();
}

/** Problems the Worker would reject (shown before sending). */
export function extrasError() {
  const e = extrasFromForm();
  if (e.info_every && (e.info_every < 10 || e.info_every > 600)) return "Stop screen: 'Every' must be 10-600 s";
  if (e.info_every && (e.info_for < 1 || e.info_for >= e.info_every)) return "Stop screen: 'For' must be shorter than 'Every'";
  return "";
}

export function syncExtras() {
  const seconds = $("m-mode").value === "seconds";
  $("m-extras").disabled = !seconds;
  $("m-info-opts").hidden = !$("m-info-on").checked;
  $("m-anim-opts").hidden = !$("m-anim").checked;
}

function paint(ctx, img, frame) {
  for (let p = 0; p < frame.length; p++) {
    const c = frame[p];
    img.data[p * 4] = (c >> 16) & 255;
    img.data[p * 4 + 1] = (c >> 8) & 255;
    img.data[p * 4 + 2] = c & 255;
    img.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

export function stopBoard() {
  clearTimeout(timer);
  timer = null;
}

export function hideBoard() {
  stopBoard();
  last = null;
  $("m-board-box").hidden = true;
}

/** New transit answer (`/departures?mode=schedule`): remembers it and redraws. */
export function showBoard(list, stopName) {
  last = { list, stopName };
  drawBoard();
}

const kb = (n) => (n / 1024).toFixed(1) + " KB";

/** Redraws from the last answer with the current form values (colour, mode, extras). */
export function drawBoard() {
  stopBoard();
  syncExtras();
  if (!last) return;
  const box = $("m-board-box");
  const canvas = $("m-board");
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(64, 16);
  const color = $("m-color").value;
  box.hidden = false;

  if ($("m-mode").value !== "seconds") {
    const rows = last.list.slice(0, 2).map((d) => ({ left: String(d.line), right: d.min + " min" }));
    paint(ctx, img, buildAnimation({ frames: [{ elements: rowElements(rows, color) }] }, { w: 64, h: 16, bg: 0 }).frames[0]);
    $("m-board-note").textContent = "· a still picture, rewritten every minute";
    return;
  }

  const ex = extrasFromForm();
  if (extrasError()) {
    $("m-board-note").textContent = "· " + extrasError();
    return;
  }
  const nowMs = Date.now();
  const startS = Math.floor(nowMs / 1000 / STEP) * STEP;
  const deps = toDeps(last.list, nowMs, true);
  const chosen = $("m-lines").value ? $("m-lines").value.split(",") : last.list.map((d) => String(d.line));
  const lines = [...new Set(chosen.filter(Boolean))].sort(sortLines);
  const opt = {
    color,
    step: STEP,
    anim: ex.anim,
    animMs: ex.anim_s * 1000,
    info: ex.info_every ? { every: ex.info_every, dur: ex.info_for, seconds: ex.info_seconds, label: ex.label || last.stopName, lines } : null,
  };
  const fit = fitBoard(deps, startS, HORIZON, MIN_HORIZON, opt, warsawSecondsOfDay(startS * 1000), MAX_BYTES);
  $("m-board-note").textContent =
    "· GIF " + kb(fit.gif.length) + ", " + fit.frames + " frames, " + fit.horizonS + " s" + (fit.dropped.length ? " · left out to fit " + kb(MAX_BYTES) + ": " + fit.dropped.join(", ") : "");

  const { frames, delaysMs } = fit.board;
  const ends = [];
  delaysMs.reduce((t, d, i) => (ends[i] = t + d), 0);
  const t0 = startS * 1000;
  const tick = () => {
    const el = Date.now() - t0;
    if (el >= ends[ends.length - 1] - 1000) return drawBoard(); // past the GIF: build the next one, like the Worker does
    let i = 0;
    while (ends[i] <= el) i++;
    paint(ctx, img, frames[i]);
    timer = setTimeout(tick, Math.max(10, ends[i] - el));
  };
  tick();
}
