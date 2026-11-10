// Stop picker for the Departures tab. A stop is one object with up to 4 poles (2 sides of the street x tram / bus):
//   search by name -> pick the stop -> choose the direction (side) -> choose transport and lines -> preview.
// Everything comes from the public transit API (docs/API_GUIDE.md). The result ends up in #m-stop (the pole code used),
// #m-lines and #m-dir, which main.js sends to the Worker. The API merges the poles of one side, so one code covers tram + bus.
import { api } from "./api.js";
import { drawBoard, hideBoard, showBoard } from "./board-preview.js";
import { ICONS, TYPE_NAME } from "./icons.js";
import { showMap } from "./map.js";
import { buildSides, clusterByName, lineType, toward } from "./stops.js";

const $ = (id) => document.getElementById(id);
const base = () => $("m-api").value.trim().replace(/\/+$/, "");
const say = (id, text, kind = "") => {
  $(id).textContent = text;
  $(id).className = "status" + (kind ? " " + kind : "");
};
const enc = encodeURIComponent;
const sortLines = (a, b) => (parseInt(a) || 999) - (parseInt(b) || 999) || a.localeCompare(b);

async function get(path) {
  const res = await api(base() + path);
  if (res.status === 404 || res.status === 400) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || "Unknown stop");
  }
  if (!res.ok) throw new Error("Transit API returned HTTP " + res.status);
  return res.json();
}

// ---------------------------------------------------------------- state
let group = null; // { name, sides: [{ codes, primary, lat, lon, poles: [{code, lat, lon, lines, type}], lines, dirsByLine|null }] }
let sideIdx = 0;
let seq = 0; // ignores answers of an older selection
let found = []; // stops from the last search

const side = () => group.sides[sideIdx];
const selectedLines = () => [...document.querySelectorAll("#m-line-chips input:checked")].map((i) => i.value);
const typesOf = (s) => [...new Set(s.lines.map(lineType))];

function poleType(p) {
  const t = p.lines.map(lineType);
  return t.length && t.filter((x) => x === "tram").length * 2 > t.length ? "tram" : "bus";
}

function chip(inputType, value, iconHtml, text, checked, onChange) {
  const lab = document.createElement("label");
  lab.className = "check chip";
  const cb = document.createElement("input");
  cb.type = inputType;
  cb.value = value;
  cb.checked = checked;
  cb.addEventListener("change", onChange);
  lab.append(cb);
  if (iconHtml) {
    const span = document.createElement("span");
    span.className = "ico-wrap";
    span.innerHTML = iconHtml; // static trusted markup (icons.js)
    lab.append(span);
  }
  lab.append(document.createTextNode(text));
  return lab;
}

// ---------------------------------------------------------------- rendering the chosen side
async function ensureDirs(s) {
  if (s.dirsByLine) return;
  const entries = await Promise.all(
    s.lines.map(async (l) => {
      try {
        const d = await get("/departures?stop=" + enc(s.primary) + "&mode=schedule&limit=20&lines=" + enc(l));
        return [l, [...new Set(d.departures.filter((x) => x.line === l).map((x) => x.dir))]];
      } catch {
        return [l, []];
      }
    }),
  );
  s.dirsByLine = Object.fromEntries(entries);
}

const allDirs = (s) => [...new Set(s.lines.flatMap((l) => s.dirsByLine[l] || []))];

function renderSides() {
  const box = $("m-sides");
  box.replaceChildren();
  group.sides.forEach((s, i) => {
    const lab = document.createElement("label");
    lab.className = "side" + (i === sideIdx ? " on" : "");
    const r = document.createElement("input");
    r.type = "radio";
    r.name = "m-side";
    r.checked = i === sideIdx;
    r.addEventListener("change", () => selectSide(i));
    const body = document.createElement("span");
    const icons = document.createElement("span");
    icons.className = "ico-wrap";
    icons.innerHTML = typesOf(s).map((t) => ICONS[t]).join("");
    const head = document.createElement("strong");
    head.append(icons, document.createTextNode(" Direction " + (i + 1) + " · poles " + s.codes.join(", ")));
    const lines = document.createElement("span");
    lines.className = "dim";
    lines.textContent = "lines " + s.lines.join(", ") + (s.dirsByLine ? " → " + toward(allDirs(s)) : "");
    body.append(head, document.createElement("br"), lines);
    lab.append(r, body);
    box.append(lab);
  });
}

function syncLinesField() {
  $("m-lines").value = selectedLines().join(",");
}

function syncTypeChips() {
  const s = side();
  const ticked = new Set(selectedLines());
  for (const cb of document.querySelectorAll("#m-type-chips input")) {
    const mine = s.lines.filter((l) => lineType(l) === cb.value);
    cb.checked = mine.length > 0 && mine.every((l) => ticked.has(l));
  }
}

function fillDirections(keep) {
  const sel = $("m-dir");
  const lines = selectedLines();
  const dirs = [...new Set((lines.length ? lines : side().lines).flatMap((l) => side().dirsByLine[l] || []))].sort((a, b) => a.localeCompare(b));
  if (keep && !dirs.includes(keep)) dirs.push(keep); // a saved value stays visible even if the timetable has none right now
  sel.replaceChildren(new Option("Any terminus", ""));
  for (const d of dirs) sel.add(new Option(d, d));
  sel.value = keep && dirs.includes(keep) ? keep : "";
}

function renderChoices(preset) {
  const s = side();
  const have = new Set(s.lines);
  const presetLines = String(preset.lines || "").split(",").map((x) => x.trim()).filter(Boolean);
  const lines = [...new Set([...s.lines, ...presetLines])].sort(sortLines);

  const types = $("m-type-chips");
  types.replaceChildren();
  for (const t of typesOf(s)) {
    types.append(
      chip("checkbox", t, ICONS[t], TYPE_NAME[t], false, (e) => {
        for (const cb of document.querySelectorAll("#m-line-chips input")) if (lineType(cb.value) === t && have.has(cb.value)) cb.checked = e.target.checked;
        syncLinesField();
        syncTypeChips();
        fillDirections($("m-dir").value);
        preview();
      }),
    );
  }
  const box = $("m-line-chips");
  box.replaceChildren();
  for (const l of lines) {
    box.append(
      chip("checkbox", l, ICONS[lineType(l)], l, presetLines.includes(l), () => {
        syncLinesField();
        syncTypeChips();
        fillDirections($("m-dir").value);
        preview();
      }),
    );
  }
  syncLinesField();
  syncTypeChips();
  fillDirections(preset.dir || "");
}

// ---------------------------------------------------------------- preview of what the panel will show
let previewTimer;
function preview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(runPreview, 250);
}
async function runPreview() {
  const box = $("m-preview");
  if (!group) {
    hideBoard();
    return (box.hidden = true);
  }
  const mine = seq;
  const q = new URLSearchParams({ stop: side().primary, mode: "schedule", limit: "20" }); // 20: enough for the 500 s board preview
  if ($("m-lines").value) q.set("lines", $("m-lines").value);
  if ($("m-dir").value) q.set("dir", $("m-dir").value);
  box.hidden = false;
  try {
    const d = await get("/departures?" + q);
    if (mine !== seq) return;
    showBoard(d.departures, d.stop || group.name);
    box.replaceChildren();
    if (!d.departures.length) {
      box.className = "preview warn";
      box.textContent = "No timetable departures match these choices right now - the panel would show NO DATA. Tick other lines or pick another terminus.";
      return;
    }
    box.className = "preview";
    const h = document.createElement("div");
    h.className = "dim";
    h.textContent = "Next departures with these settings (timetable):";
    box.append(h);
    for (const x of d.departures.slice(0, 4)) {
      const row = document.createElement("div");
      row.className = "mono";
      row.textContent = x.line.padEnd(5) + " " + (x.time || "") + "  in " + x.min + " min  → " + x.dir;
      box.append(row);
    }
  } catch (e) {
    if (mine === seq) {
      hideBoard();
      box.className = "preview warn";
      box.textContent = e.message;
    }
  }
}

function drawMap() {
  const sides = group.sides.map((s) => ({ lat: s.lat, lon: s.lon, poles: s.poles.map((p) => ({ code: p.code, type: poleType(p) })) }));
  showMap($("m-map"), {
    sides,
    selected: sideIdx,
    onPick: (i, type) => selectSide(i, {}, type),
  }).catch(() => {
    $("m-map").hidden = true;
  });
}

/** Chooses a side (direction). `onlyType`: a map badge was clicked, so tick just that transport. */
async function selectSide(i, preset = {}, onlyType = null) {
  const mine = seq;
  sideIdx = i;
  const s = side();
  $("m-stop").value = s.primary;
  await ensureDirs(s);
  if (mine !== seq) return;
  renderSides();
  renderChoices(preset);
  if (onlyType) {
    for (const cb of document.querySelectorAll("#m-line-chips input")) cb.checked = lineType(cb.value) === onlyType;
    syncLinesField();
    syncTypeChips();
    fillDirections("");
  }
  say("m-stop-info", group.name + " · " + group.sides.length + (group.sides.length === 1 ? " direction" : " directions") + " · pole " + s.primary, "ok");
  runPreview();
  drawMap();
}

// ---------------------------------------------------------------- loading a stop
/** cluster: { name, poles: [{code, lat, lon}] } from the search. code: the pole to select (default: the first). */
async function loadGroup(cluster, code, preset = {}) {
  const mine = ++seq;
  say("m-stop-info", "Loading " + cluster.name + "…");
  try {
    const codes = cluster.poles.map((p) => p.code);
    const hubs = await Promise.all(codes.map((c) => get("/departures?stop=" + enc(c) + "&mode=schedule&limit=1").catch(() => null)));
    const platformsOf = {};
    const all = new Set(codes);
    hubs.forEach((h, i) => {
      const pl = h && h.platforms && h.platforms.length ? h.platforms.map(String) : [codes[i]];
      platformsOf[codes[i]] = pl;
      pl.forEach((c) => all.add(c));
    });
    const stops = await Promise.all([...all].map((c) => get("/stop?stop=" + enc(c)).catch(() => null)));
    if (mine !== seq) return;
    const poles = new Map();
    for (const s of stops) if (s) poles.set(String(s.stop_code), { code: String(s.stop_code), lat: s.lat, lon: s.lon, lines: [...(s.lines || [])].sort(sortLines) });
    const sides = buildSides([...poles.keys()], platformsOf).map((cs) => {
      const ps = cs.map((c) => poles.get(c));
      return {
        codes: cs,
        primary: cs[0],
        lat: ps.reduce((a, p) => a + p.lat, 0) / ps.length,
        lon: ps.reduce((a, p) => a + p.lon, 0) / ps.length,
        poles: ps,
        lines: [...new Set(ps.flatMap((p) => p.lines))].sort(sortLines),
        dirsByLine: null,
      };
    });
    if (!sides.length) throw new Error("No data for this stop");
    if (sides.every((s) => !s.lines.length)) {
      // the stop exists, but the transit API has no timetable for any of its poles (its database covers only part of the stops)
      group = null;
      $("m-pick").hidden = true;
      say("m-stop-info", cluster.name + ": the transit API has no timetable for this stop yet, so it cannot be shown on the panel. The map below only shows where its poles are.", "err");
      showMap($("m-map"), { sides: sides.map((s) => ({ lat: s.lat, lon: s.lon, poles: s.poles.map((p) => ({ code: p.code, type: "bus" })) })), selected: -1 }).catch(() => ($("m-map").hidden = true));
      return;
    }
    sides.splice(0, sides.length, ...sides.filter((s) => s.lines.length)); // directions without any line are of no use
    group = { name: cluster.name, sides };
    await Promise.all(sides.map(ensureDirs)); // so every direction card can say where it goes
    if (mine !== seq) return;
    $("m-pick").hidden = false;
    const want = code ? sides.findIndex((s) => s.codes.includes(String(code))) : 0;
    await selectSide(want < 0 ? 0 : want, preset);
  } catch (e) {
    if (mine !== seq) return;
    group = null;
    $("m-pick").hidden = true;
    $("m-map").hidden = true;
    say("m-stop-info", e instanceof TypeError ? "Cannot reach the transit API" : e.message, "err");
  }
}

/** From a pole code (saved configuration or typed by hand): finds the stop it belongs to. */
export async function loadStop(code, preset = {}) {
  code = String(code || "").trim();
  if (!/^[A-Za-z0-9]{1,12}$/.test(code)) return clear();
  const mine = ++seq;
  say("m-stop-info", "Loading stop " + code + "…");
  try {
    const stop = await get("/stop?stop=" + enc(code));
    if (mine !== seq) return;
    let cluster = { name: stop.name, poles: [{ code, lat: stop.lat, lon: stop.lon }] };
    try {
      const list = await get("/search?q=" + enc(stop.name));
      cluster = clusterByName(list).find((c) => c.poles.some((p) => p.code === code)) || cluster;
    } catch {
      /* the search is only used to find the sibling poles */
    }
    loadGroup(cluster, code, preset);
  } catch (e) {
    if (mine !== seq) return;
    group = null;
    $("m-pick").hidden = true;
    $("m-map").hidden = true;
    say("m-stop-info", e instanceof TypeError ? "Cannot reach the transit API" : e.message, "err");
  }
}

function clear() {
  seq++;
  group = null;
  hideBoard();
  $("m-pick").hidden = true;
  $("m-map").hidden = true;
  say("m-stop-info", "");
  $("m-lines").value = "";
  $("m-dir").replaceChildren(new Option("Any terminus", ""));
}

// ---------------------------------------------------------------- search box: the results are buttons, so every match is visible
let searchTimer;
let searchSeq = 0;
let picked = null; // index in `found` of the stop being shown

function resultsHint(text) {
  const span = document.createElement("span");
  span.className = "hint";
  span.textContent = text;
  $("m-results").replaceChildren(span);
  $("m-results-count").textContent = "";
}

function renderResults() {
  const box = $("m-results");
  box.replaceChildren();
  const total = {};
  for (const c of found) total[c.name] = (total[c.name] || 0) + 1;
  const seen = {};
  found.forEach((c, i) => {
    seen[c.name] = (seen[c.name] || 0) + 1;
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "option");
    b.setAttribute("aria-selected", String(i === picked));
    const name = document.createElement("span");
    name.textContent = c.name + (total[c.name] > 1 ? " (" + seen[c.name] + ")" : "");
    const info = document.createElement("small");
    info.textContent = c.poles.length + (c.poles.length === 1 ? " pole" : " poles") + (total[c.name] > 1 ? " · another place with this name" : "");
    b.append(name, info);
    b.addEventListener("click", () => {
      picked = i;
      for (const x of box.children) x.setAttribute("aria-selected", String(x === b));
      loadGroup(c, null);
    });
    box.append(b);
  });
  $("m-results-count").textContent = "(" + found.length + (found.length === 1 ? " stop)" : " stops)");
}

async function search() {
  const q = $("m-q").value.trim();
  const mine = ++searchSeq;
  if (q.length < 2) {
    found = [];
    return resultsHint("Type at least 2 letters.");
  }
  resultsHint("Searching…");
  try {
    const list = clusterByName(await get("/search?q=" + enc(q)));
    if (mine !== searchSeq) return;
    found = list;
    picked = null;
    if (!found.length) return resultsHint("No stops match “" + q + "”.");
    renderResults();
    if (found.length === 1) $("m-results").firstElementChild.click(); // the only match: open it right away
  } catch {
    if (mine === searchSeq) resultsHint("Cannot reach the transit API.");
  }
}

export function initDepartures() {
  $("m-q").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(search, 300);
  });
  $("m-q").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    clearTimeout(searchTimer);
    search();
  });
  $("m-stop").addEventListener("change", () => loadStop($("m-stop").value));
  $("m-dir").addEventListener("change", preview);
  // the board preview follows the colour, the mode and the extras without asking the transit API again
  for (const id of ["m-color", "m-mode", "m-info-on", "m-info-every", "m-info-for", "m-info-sec", "m-label", "m-anim"]) $(id).addEventListener("input", drawBoard);
  $("m-mode").addEventListener("change", drawBoard);
}
