// Control page for the ACT1033_LED panel. Renders in the browser with the same code as the Worker
// (cloudflare/src) and uploads the finished GIF/PNG to the user's own Worker.
import { buildAnimation } from "../../cloudflare/src/render.ts";
import { encodeGif } from "../../cloudflare/src/encode.ts";
import { H, W, lifeFrames } from "./life.js";
import { PALETTES } from "./blobs.js";
import { blobFrames } from "./blobs-render.js";
import { api, clearLog, setLogListener } from "./api.js";
import { buildReport, chipFor, renderDebug, renderError, renderFilters, renderLog } from "./debug.js";

const MAX = 64 * 1024;
const KEY = "act1033-led";
const $ = (id) => document.getElementById(id);
const rgb = (hex) => parseInt(hex.slice(1), 16);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

let tab = "text";
let current = null; // { bytes, frames?, delays?, note }
let timer = null;

// ---------------------------------------------------------------- saved connection (opt-in)
function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}
function persist() {
  try {
    if ($("remember").checked) localStorage.setItem(KEY, JSON.stringify({ worker: $("worker").value, panel: $("panel").value, token: $("token").value }));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable - fine */
  }
}
(function init() {
  const saved = loadSaved();
  const hash = new URLSearchParams(location.hash.slice(1)); // #worker=https://...&panel=kitchen (never the token)
  $("worker").value = hash.get("worker") || saved.worker || "";
  $("panel").value = hash.get("panel") || saved.panel || "";
  $("token").value = saved.token || "";
  $("remember").checked = !!saved.token;
  try {
    const b = hash.get("brightness") || localStorage.getItem(KEY + "-brightness"); // not a secret: kept even without "Remember"
    if (b) $("brightness").value = clamp(Number(b), 5, 100);
  } catch {
    /* storage unavailable - fine */
  }
  $("bright-val").textContent = $("brightness").value + "%";
})();

// ---------------------------------------------------------------- status helpers
function say(id, text, kind = "") {
  const el = $(id);
  el.textContent = text;
  el.className = "status" + (kind ? " " + kind : "");
}
function connection() {
  const base = $("worker").value.trim().replace(/\/+$/, "");
  const id = $("panel").value.trim();
  const token = $("token").value.trim();
  if (!/^https:\/\/|^http:\/\/localhost[:/]|^http:\/\/127\.0\.0\.1[:/]/.test(base)) throw new Error("Worker URL must start with https://");
  if (!id) throw new Error("Enter the panel ID");
  if (!token) throw new Error("Enter the token");
  return { base, id, token, url: base + "/panel/" + encodeURIComponent(id), auth: { Authorization: "Bearer " + token } };
}
function updateSendButton() {
  $("send").disabled = !(current && $("worker").value.trim() && $("panel").value.trim() && $("token").value.trim());
}

// ---------------------------------------------------------------- content builders
// Brightness is baked into the picture (colours are scaled), so it works with any panel and needs no firmware support.
function brightness() {
  return clamp(Number($("brightness").value), 5, 100) / 100;
}
function dim(c, k) {
  return (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k);
}
function gifFrom(frames, delays, bg) {
  const k = brightness();
  if (k < 1) {
    frames = frames.map((f) => Uint32Array.from(f, (c) => dim(c, k)));
    bg = dim(bg, k);
  }
  if (frames.length === 1) {
    frames = [frames[0], frames[0]]; // the panel's known-good static GIF is two identical frames
    delays = [1000, 1000];
  }
  return { bytes: encodeGif(frames, delays, W, H, { background: bg, loop: 0, nonce: false }), frames, delays };
}

function buildText() {
  const mode = $("t-mode").value;
  const bg = $("t-bg").value;
  const spec = {
    background: bg,
    elements: [
      {
        type: "text",
        text: $("t-text").value || " ",
        color: $("t-fg").value,
        scale: Number($("t-scale").value),
        align: "center",
        anim: mode === "static" ? "none" : mode,
        speed: Number($("t-speed").value),
      },
    ],
  };
  const anim = buildAnimation(spec, { w: W, h: H, bg: rgb(bg) });
  return gifFrom(anim.frames, anim.delaysMs, rgb(bg));
}

function buildLife() {
  const bg = rgb($("l-bg").value);
  const wanted = clamp(Number($("l-frames").value), 10, 600);
  const delay = clamp(Number($("l-delay").value), 50, 1000);
  const all = lifeFrames(wanted, {
    density: clamp(Number($("l-density").value), 10, 60) / 100,
    seed: Number($("l-seed").value) | 0,
    wrap: $("l-wrap").checked,
    fg: rgb($("l-fg").value),
    bg,
  });
  let n = wanted;
  let out = gifFrom(all.slice(0, n), Array(n).fill(delay), bg);
  while (out.bytes.length > MAX && n > 10) {
    n = Math.max(10, Math.floor(n * 0.85));
    out = gifFrom(all.slice(0, n), Array(n).fill(delay), bg);
  }
  if (n < wanted) out.note = "trimmed from " + wanted + " to " + n + " frames to fit 64 KB";
  return out;
}

async function buildBlobs() {
  const minR = Number($("b-min").value);
  const mode = $("b-mode").value;
  const delay = clamp(Number($("b-delay").value), 50, 1000);
  const wanted = Number($("b-step").value);
  let step = wanted;
  for (;;) {
    const r = await blobFrames({
      seed: Number($("b-seed").value) | 0,
      palette: $("b-palette").value,
      minR,
      maxR: Math.max(minR, Number($("b-max").value)),
      wobble: Number($("b-wobble").value) / 100,
      mode,
      step,
    });
    const last = r.frames.length - 1;
    const out = gifFrom(r.frames, r.frames.map((_, i) => (mode === "appear" && i === last ? delay * 8 : delay)), r.bg);
    out.note = r.count + " blobs" + (step > wanted ? ", speed raised to " + step + " px/frame to fit 64 KB" : "");
    if (out.bytes.length <= MAX || mode !== "scroll" || step >= 8) return out;
    step *= 2; // too big for the panel: move faster, so there are fewer frames
  }
}

async function buildFile() {
  const file = $("f-file").files[0];
  if (!file) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isGif = bytes.length > 6 && String.fromCharCode(...bytes.slice(0, 4)) === "GIF8";
  const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!isGif && !isPng) throw new Error("That is not a GIF or PNG file");
  if (bytes.length > MAX) throw new Error("File is " + Math.round(bytes.length / 1024) + " KB; the limit is 64 KB");
  return { bytes, file: new Blob([bytes], { type: isGif ? "image/gif" : "image/png" }) };
}

// ---------------------------------------------------------------- preview
function stopPlayer() {
  clearTimeout(timer);
  timer = null;
}
function play(frames, delays) {
  stopPlayer();
  const ctx = $("preview").getContext("2d");
  const img = ctx.createImageData(W, H);
  let i = 0;
  const tick = () => {
    const f = frames[i];
    for (let p = 0; p < W * H; p++) {
      const c = f[p];
      img.data[p * 4] = (c >> 16) & 255;
      img.data[p * 4 + 1] = (c >> 8) & 255;
      img.data[p * 4 + 2] = c & 255;
      img.data[p * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const d = Math.max(30, delays[i]);
    i = (i + 1) % frames.length;
    timer = setTimeout(tick, d);
  };
  tick();
}

let gen = 0;
async function refresh() {
  const mine = ++gen;
  stopPlayer();
  current = null;
  $("file-preview").hidden = tab !== "file";
  $("preview").hidden = tab === "file";
  try {
    if (tab === "file") {
      current = await buildFile();
      if (current) {
        const old = $("file-preview").src;
        if (old.startsWith("blob:")) URL.revokeObjectURL(old);
        $("file-preview").src = URL.createObjectURL(current.file);
      }
    } else {
      const built = tab === "text" ? buildText() : tab === "blobs" ? await buildBlobs() : buildLife();
      if (mine !== gen) return;
      current = built;
      play(current.frames, current.delays);
    }
    if (current) {
      const kb = (current.bytes.length / 1024).toFixed(1);
      const frames = current.frames ? current.frames.length + " frames · " : "";
      say("info", frames + kb + " KB of 64 KB" + (current.note ? " · " + current.note : ""), "");
    } else say("info", "Choose a file", "");
  } catch (e) {
    say("info", e.message, "err");
  }
  updateSendButton();
}

// ---------------------------------------------------------------- talking to the Worker
async function explain(res) {
  const j = await res.json().catch(() => ({}));
  if (res.status === 401) return "Token not accepted for this Worker or panel";
  if (res.status === 403) return "This token is read-only; use the write token";
  if (res.status === 404) return j.error === "panel not found" ? "No panel with this ID" : j.error || "Not found";
  return j.error || "HTTP " + res.status;
}

async function check() {
  say("conn-status", "Checking…");
  try {
    const c = connection();
    const res = await api(c.url, { headers: c.auth });
    if (!res.ok) return say("conn-status", await explain(res), "err");
    const m = await res.json();
    const when = m.updated_at ? "last update " + new Date(m.updated_at * 1000).toLocaleString() : "no picture yet";
    say("conn-status", 'Connected to panel "' + m.name + '" (' + when + ")", "ok");
    persist();
    pollChip();
  } catch (e) {
    say("conn-status", e instanceof TypeError ? "Cannot reach the Worker (check the URL; CORS or network)" : e.message, "err");
  }
}

async function send() {
  say("send-status", "Sending…");
  $("send").disabled = true;
  try {
    const c = connection();
    const res = await api(c.url, { method: "PUT", headers: c.auth, body: current.bytes });
    if (!res.ok) return say("send-status", await explain(res), "err");
    const j = await res.json();
    say("send-status", j.changed ? "Sent " + j.size + " B. The ESP picks it up within a few seconds." : "Identical to the current picture; nothing to do.", "ok");
    persist();
  } catch (e) {
    say("send-status", e instanceof TypeError ? "Cannot reach the Worker (check the URL; CORS or network)" : e.message, "err");
  } finally {
    updateSendButton();
  }
}

// ---------------------------------------------------------------- departures job (runs in the Worker, see cloudflare/src/mpk.ts)
let searchTimer;
async function searchStops() {
  const q = $("m-q").value.trim();
  const sel = $("m-results");
  if (q.length < 2) return;
  try {
    const res = await fetch($("m-api").value.trim().replace(/\/+$/, "") + "/search?q=" + encodeURIComponent(q));
    const list = await res.json();
    sel.innerHTML = "";
    if (!Array.isArray(list) || !list.length) sel.add(new Option("No stops found", ""));
    else {
      sel.add(new Option("Choose a stop (" + list.length + ")", ""));
      for (const s of list.slice(0, 30)) sel.add(new Option(s.name + " · " + s.stop_code, s.stop_code));
    }
  } catch {
    say("m-status", "Cannot reach the transit API", "err");
  }
}

function mpkSummary(j) {
  const rows = (j.rows || []).map((r) => r.left + " " + r.right).join(" · ") || "no departures right now";
  return (j.stop_name ? j.stop_name + ": " : "") + rows;
}

async function mpkLoad() {
  try {
    const c = connection();
    const res = await api(c.url + "/mpk", { headers: c.auth });
    if (!res.ok) return;
    const j = await res.json();
    if (j.config) {
      $("m-stop").value = j.config.stop || "";
      $("m-lines").value = j.config.lines || "";
      $("m-dir").value = j.config.dir || "";
      $("m-color").value = j.config.color || "#ffb000";
      $("m-mode").value = j.config.mode || "seconds";
    }
    say("m-status", j.enabled ? "Departures are running on the Worker (stop " + j.config.stop + ")" : "Departures are off", j.enabled ? "ok" : "");
  } catch {
    /* connection fields not filled in yet */
  }
}

async function mpkStart() {
  say("m-status", "Starting…");
  try {
    const c = connection();
    const res = await api(c.url + "/mpk", {
      method: "PUT",
      headers: { ...c.auth, "Content-Type": "application/json" },
      body: JSON.stringify({ stop: $("m-stop").value, lines: $("m-lines").value, dir: $("m-dir").value, color: $("m-color").value, mode: $("m-mode").value }),
    });
    if (!res.ok) return say("m-status", await explain(res), "err");
    const j = await res.json();
    say("m-status", "Running. " + mpkSummary(j) + ". The ESP picks it up within about 30 s; " + (j.config.mode === "seconds" ? "the panel counts down by itself and the Worker replaces the animation every 5 minutes." : "the Worker refreshes it every minute."), "ok");
    persist();
  } catch (e) {
    say("m-status", e instanceof TypeError ? "Cannot reach the Worker (check the URL; CORS or network)" : e.message, "err");
  }
}

async function mpkStop() {
  try {
    const c = connection();
    const res = await api(c.url + "/mpk", { method: "DELETE", headers: c.auth });
    if (!res.ok) return say("m-status", await explain(res), "err");
    say("m-status", "Departures stopped. The panel keeps the last picture until you send another.", "ok");
  } catch (e) {
    say("m-status", e.message, "err");
  }
}

$("m-q").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchStops, 300);
});
$("m-results").addEventListener("change", () => {
  if ($("m-results").value) $("m-stop").value = $("m-results").value;
});
$("m-start").addEventListener("click", mpkStart);
$("m-stop-btn").addEventListener("click", mpkStop);

// ---------------------------------------------------------------- wiring
for (const b of document.querySelectorAll(".tabs button")) {
  b.addEventListener("click", () => {
    tab = b.dataset.tab;
    for (const o of document.querySelectorAll(".tabs button")) o.setAttribute("aria-selected", String(o === b));
    for (const t of ["text", "life", "blobs", "file"]) $("tab-" + t).hidden = t !== tab;
    refresh();
  });
}

// ---------------------------------------------------------------- sections (Send / Departures / Debug / Settings)
const VIEWS = ["send", "mpk", "debug", "settings"];
let view = "send";
function show(next, remember = true) {
  view = VIEWS.includes(next) ? next : "send";
  for (const v of VIEWS) $("view-" + v).hidden = v !== view;
  for (const b of document.querySelectorAll(".nav button")) b.setAttribute("aria-selected", String(b.dataset.view === view));
  if (remember) {
    const h = new URLSearchParams(location.hash.slice(1)); // keeps worker= / panel= from the shared link
    h.set("view", view);
    history.replaceState(null, "", "#" + h.toString());
  }
  if (view === "send") refresh();
  else stopPlayer();
  if (view === "mpk") mpkLoad();
  if (view === "debug") pollDebug();
  schedulePolling();
}
for (const b of document.querySelectorAll(".nav button")) b.addEventListener("click", () => show(b.dataset.view));

// ---------------------------------------------------------------- status chip + Debug tab
let lastDebug = null; // last /debug answer
let skew = 0; // server clock minus this computer's clock, seconds
let latency = 0;
let pollTimer = null;

function hasConnection() {
  return !!($("worker").value.trim() && $("panel").value.trim() && $("token").value.trim());
}
function paintChip() {
  const c = lastDebug ? chipFor(lastDebug, skew) : hasConnection() ? { text: "Connecting…", cls: "off" } : { text: "Not connected", cls: "off" };
  $("chip").className = "chip " + c.cls;
  $("chip-text").textContent = c.text;
}
async function fetchDebug(quiet) {
  const c = connection();
  const t0 = performance.now();
  const res = await api(c.url + "/debug", { headers: c.auth, cache: "no-store" }, { quiet });
  latency = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(await explain(res));
  const data = await res.json();
  skew = data.now - Date.now() / 1000;
  lastDebug = data;
  return data;
}
async function pollChip() {
  if (!hasConnection()) return paintChip();
  try {
    await fetchDebug(true);
  } catch {
    lastDebug = null;
  }
  paintChip();
}
async function pollDebug() {
  if (view !== "debug") return;
  try {
    const data = await fetchDebug(false);
    renderDebug(data, { skew, latency });
    say("d-status", "", "");
  } catch (e) {
    lastDebug = null;
    renderError(e instanceof TypeError ? "Cannot reach the Worker (check the URL; CORS or network)" : e.message);
    say("d-status", "", "");
  }
  renderLog();
  paintChip();
}
function schedulePolling() {
  clearInterval(pollTimer);
  const debugging = view === "debug" && $("d-auto").checked;
  const every = debugging ? 3000 : 15000;
  pollTimer = setInterval(() => {
    if (document.hidden) return;
    if (view === "debug") {
      if ($("d-auto").checked) pollDebug();
    } else pollChip();
  }, every);
}
setInterval(() => {
  // keep the "x s ago" texts moving between polls
  if (lastDebug) {
    paintChip();
    if (view === "debug") renderDebug(lastDebug, { skew, latency });
  }
}, 1000);
setLogListener(() => view === "debug" && renderLog());
renderFilters();
$("d-auto").addEventListener("change", schedulePolling);
$("d-refresh").addEventListener("click", pollDebug);
$("d-clear").addEventListener("click", clearLog);
$("d-copy").addEventListener("click", async () => {
  if (!lastDebug) return say("d-status", "Nothing to copy yet", "err");
  try {
    await navigator.clipboard.writeText(buildReport(lastDebug, { skew, latency }));
    say("d-status", "Report copied (contains no tokens or Worker URL)", "ok");
  } catch {
    say("d-status", "The browser blocked clipboard access", "err");
  }
});
for (const id of ["worker", "panel", "token"]) $(id).addEventListener("change", pollChip);
let debounce;
$("brightness").addEventListener("input", () => {
  $("bright-val").textContent = $("brightness").value + "%";
  try {
    localStorage.setItem(KEY + "-brightness", $("brightness").value);
  } catch {
    /* storage unavailable - fine */
  }
});
for (const el of document.querySelectorAll(".pane input, .pane select, #brightness")) {
  el.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(refresh, 200);
  });
}
for (const id of ["worker", "panel", "token"]) $(id).addEventListener("input", updateSendButton);
$("remember").addEventListener("change", persist);
$("connect").addEventListener("click", check);
$("send").addEventListener("click", send);
$("l-random").addEventListener("click", () => {
  $("l-seed").value = Math.floor(Math.random() * 1e6);
  refresh();
});
$("b-random").addEventListener("click", () => {
  $("b-seed").value = Math.floor(Math.random() * 1e6);
  refresh();
});
for (const name of Object.keys(PALETTES)) $("b-palette").add(new Option(name, name));
function showSwatches() {
  const p = PALETTES[$("b-palette").value];
  const css = (c) => "#" + c.toString(16).padStart(6, "0");
  $("b-swatches").innerHTML = "";
  for (const c of [p.bg, ...p.rings]) {
    const i = document.createElement("i");
    i.style.background = css(c);
    $("b-swatches").append(i);
  }
}
$("b-palette").addEventListener("change", showSwatches);
$("b-palette").selectedIndex = Math.floor(Math.random() * Object.keys(PALETTES).length);
showSwatches();
// First run (nothing saved, no link): open Settings. Otherwise the section from the link, else Send.
{
  const wanted = new URLSearchParams(location.hash.slice(1)).get("view");
  show(!hasConnection() ? "settings" : wanted || "send", false);
  pollChip();
}
