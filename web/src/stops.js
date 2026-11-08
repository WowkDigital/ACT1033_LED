// Pure helpers for the stop picker (no DOM), unit-tested in test/stops.test.js.
//
// Model: one "stop" = a base name at one place. It has up to 4 poles: two sides of the street (directions) x tram / bus.
// The transit API already merges poles of the same side into one answer (its `platforms` list), so a "side" is exactly
// a set of poles the API returns together; one code of a side is enough to query all of its lines.

/** Wrocław tram lines are 0L, 0P and 1-33; everything else (100+, letters) is a bus. */
export function lineType(line) {
  const l = String(line).trim();
  if (/^0[LP]$/i.test(l)) return "tram";
  return /^\d+$/.test(l) && Number(l) >= 1 && Number(l) <= 33 ? "tram" : "bus";
}

export function distanceM(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Search results (poles) -> stops: poles with the same name that are within `maxM` of each other (chained) form one stop.
 * Two different places that share a name (e.g. "Rondo") stay separate.
 */
export function clusterByName(results, maxM = 300) {
  const byName = new Map();
  for (const r of results) {
    const p = { code: String(r.stop_code), lat: r.lat, lon: r.lon };
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push(p);
  }
  const out = [];
  for (const [name, poles] of byName) {
    const groups = [];
    for (const p of poles) {
      const near = groups.filter((g) => g.some((q) => distanceM(p, q) <= maxM));
      const merged = [p, ...near.flat()];
      for (const g of near) groups.splice(groups.indexOf(g), 1);
      groups.push(merged);
    }
    for (const g of groups) out.push({ name, poles: g.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })) });
  }
  return out;
}

/**
 * Poles -> sides. `platformsOf[code]` = codes the API returns together with that pole. Poles that are listed together
 * (directly or through a chain) are one side. Result sorted by the lowest code, each side's codes sorted too.
 */
export function buildSides(codes, platformsOf) {
  const parent = new Map(codes.map((c) => [c, c]));
  const find = (c) => (parent.get(c) === c ? c : (parent.set(c, find(parent.get(c))), parent.get(c)));
  for (const c of codes) {
    for (const o of platformsOf[c] || []) if (parent.has(o)) parent.set(find(o), find(c));
  }
  const groups = new Map();
  for (const c of codes) {
    const r = find(c);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(c);
  }
  const num = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  return [...groups.values()].map((g) => g.sort(num)).sort((a, b) => num(a[0], b[0]));
}

/** "Kowale, Stadion Olimpijski +2" */
export function toward(dirs, max = 3) {
  const list = [...dirs];
  return list.slice(0, max).join(", ") + (list.length > max ? " +" + (list.length - max) : "");
}
