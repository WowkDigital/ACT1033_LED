// Control page for the ACT1033_LED panel. Renders in the browser with the same code as the Worker
// (cloudflare/src) and uploads the finished GIF/PNG to the user's own Worker.
import { buildAnimation } from "../../cloudflare/src/render.ts";
import { encodeGif } from "../../cloudflare/src/encode.ts";
import { H, W, lifeFrames } from "./life.js";

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
function gifFrom(frames, delays, bg) {
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

async function refresh() {
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
      current = tab === "text" ? buildText() : buildLife();
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
    const res = await fetch(c.url, { headers: c.auth });
    if (!res.ok) return say("conn-status", await explain(res), "err");
    const m = await res.json();
    const when = m.updated_at ? "last update " + new Date(m.updated_at * 1000).toLocaleString() : "no picture yet";
    say("conn-status", 'Connected to panel "' + m.name + '" (' + when + ")", "ok");
    persist();
  } catch (e) {
    say("conn-status", e instanceof TypeError ? "Cannot reach the Worker (check the URL; CORS or network)" : e.message, "err");
  }
}

async function send() {
  say("send-status", "Sending…");
  $("send").disabled = true;
  try {
    const c = connection();
    const res = await fetch(c.url, { method: "PUT", headers: c.auth, body: current.bytes });
    if (!res.ok) return say("send-status", await explain(res), "err");
    const j = await res.json();
    say("send-status", j.changed ? "Sent " + j.size + " B. The ESP will show it at its next check." : "Identical to the current picture; nothing to do.", "ok");
    persist();
  } catch (e) {
    say("send-status", e instanceof TypeError ? "Cannot reach the Worker (check the URL; CORS or network)" : e.message, "err");
  } finally {
    updateSendButton();
  }
}

// ---------------------------------------------------------------- wiring
for (const b of document.querySelectorAll(".tabs button")) {
  b.addEventListener("click", () => {
    tab = b.dataset.tab;
    for (const o of document.querySelectorAll(".tabs button")) o.setAttribute("aria-selected", String(o === b));
    for (const t of ["text", "life", "file"]) $("tab-" + t).hidden = t !== tab;
    refresh();
  });
}
let debounce;
for (const el of document.querySelectorAll(".pane input, .pane select")) {
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
refresh();
