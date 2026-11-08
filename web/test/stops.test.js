import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSides, clusterByName, lineType, toward } from "../src/stops.js";

test("line types: tram 0L/0P/1-33, bus otherwise", () => {
  for (const l of ["0L", "0P", "1", "13", "23", "33"]) assert.equal(lineType(l), "tram", l);
  for (const l of ["34", "124", "134", "249", "A", "C", "D", "K", "N"]) assert.equal(lineType(l), "bus", l);
});

test("the four Budziszyńska poles form one stop; same-named places far apart stay separate", () => {
  const results = [
    { stop_code: "112020", name: "Budziszyńska", lat: 51.112496, lon: 16.949841 },
    { stop_code: "12020", name: "Budziszyńska", lat: 51.112496, lon: 16.949841 },
    { stop_code: "112019", name: "Budziszyńska", lat: 51.112957, lon: 16.94968 },
    { stop_code: "12019", name: "Budziszyńska", lat: 51.112957, lon: 16.94968 },
    { stop_code: "11301", name: "Rondo", lat: 51.1, lon: 17.0 },
    { stop_code: "50395001", name: "Rondo", lat: 51.3, lon: 17.3 },
  ];
  const c = clusterByName(results);
  assert.equal(c.length, 3);
  assert.deepEqual(c[0].poles.map((p) => p.code), ["12019", "12020", "112019", "112020"]);
  assert.deepEqual(c.filter((x) => x.name === "Rondo").map((x) => x.poles.length), [1, 1]);
});

test("sides are the sets of poles the API returns together", () => {
  const codes = ["12020", "112020", "12019", "112019"];
  const sides = buildSides(codes, { 12020: ["112020", "12020"], 112020: ["112020", "12020"], 12019: ["112019", "12019"], 112019: ["12019", "112019"] });
  assert.deepEqual(sides, [["12019", "112019"], ["12020", "112020"]]);
  assert.deepEqual(buildSides(["1", "2"], {}), [["1"], ["2"]], "no grouping info: every pole is its own side");
});

test("toward shortens long lists", () => {
  assert.equal(toward(["A", "B"]), "A, B");
  assert.equal(toward(["A", "B", "C", "D", "E"]), "A, B, C +2");
});
