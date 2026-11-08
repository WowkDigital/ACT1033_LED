// writes sample outputs for the Python cross-check: node test/dump.ts <outDir>
import { writeFileSync } from "node:fs";
import { render } from "../src/render.ts";
const dir = process.argv[2]!;
const text = "Zażółć gęślą jaźń 123";
for (const [name, spec] of Object.entries({
  scroll: { format: "gif", elements: [{ type: "text", text, anim: "scroll", speed: 3 }] },
  blink: { format: "gif", elements: [{ type: "text", text: "Hello", anim: "blink" }] },
  static: { format: "png", elements: [{ type: "text", text: "Wrocław" }] },
  big: { format: "png", elements: [{ type: "text", text: "12:34", scale: 2 }] },
  multi: { format: "png", elements: [{ type: "text", text: "Hi", color: "#ff0000" }, { type: "rect", x: 40, y: 2, w: 10, h: 10, color: "#0000ff" }, { type: "line", x1: 0, y1: 15, x2: 63, y2: 0, color: "#ffff00" }] },
} as const)) {
  const r = render(spec as never);
  writeFileSync(`${dir}/${name}.${r.contentType.split("/")[1]}`, r.body);
}
