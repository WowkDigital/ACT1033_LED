// Leaflet map for the departures stop picker. Loaded on demand (dynamic import), so the other tabs do not pay for it.
// Tiles come from the public OpenStreetMap tile server - the only third-party request this page makes, and only when this map is shown.
import { ICONS } from "./icons.js";

let leaflet = null;
let map = null;
let layer = null;

async function lib() {
  if (!leaflet) {
    const m = await import("leaflet");
    leaflet = m.default || m;
  }
  return leaflet;
}

/**
 * sides: [{ lat, lon, poles: [{ code, type }] }] - one entry per side of the street. Poles of a side share one spot, so they
 * are drawn as a row of badges (icon + code) next to each other; the two sides are drawn above / below their dots so they
 * never overlap. selected: index of the chosen side. onPick(sideIndex, type): a badge was clicked.
 */
export async function showMap(container, { sides, selected, onPick }) {
  const L = await lib();
  container.hidden = false;
  if (!map) {
    map = L.map(container, { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
  }
  layer.clearLayers();
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#0f6e56";

  // the northern side gets its badges above its dot, the others below, so close sides do not cover each other
  const order = sides.map((s, i) => i).sort((a, b) => sides[b].lat - sides[a].lat);
  sides.forEach((s, i) => {
    const on = i === selected;
    L.circleMarker([s.lat, s.lon], { radius: 5, color: on ? accent : "#555", weight: 2, fillColor: on ? accent : "#bbb", fillOpacity: 1, interactive: false }).addTo(layer);

    const wrap = document.createElement("div");
    wrap.className = "mb " + (order.indexOf(i) % 2 === 0 ? "above" : "below") + (on ? " on" : "");
    for (const p of s.poles) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mb-badge " + p.type;
      b.innerHTML = ICONS[p.type]; // static trusted markup
      b.append(document.createTextNode(" " + p.code));
      b.title = (p.type === "tram" ? "Tram pole " : "Bus pole ") + p.code;
      L.DomEvent.disableClickPropagation(b);
      b.addEventListener("click", () => onPick?.(i, p.type));
      wrap.append(b);
    }
    L.marker([s.lat, s.lon], { icon: L.divIcon({ html: wrap, className: "mb-icon", iconSize: [0, 0] }), keyboard: false, zIndexOffset: on ? 1000 : 0 }).addTo(layer);
  });

  map.invalidateSize();
  if (sides.length > 1) map.fitBounds(sides.map((s) => [s.lat, s.lon]), { padding: [70, 70], maxZoom: 18 });
  else map.setView([sides[0].lat, sides[0].lon], 17);
}

export function hideMap(container) {
  container.hidden = true;
}
