// Bundles src/main.js (which imports the Worker's renderer from ../cloudflare/src) into dist/, next to the static files.
//   npm run build        -> dist/
//   npm run dev          -> dist/ + local server on http://localhost:8080
import { build, context } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

mkdirSync("dist", { recursive: true });
for (const f of ["index.html", "style.css", "manifest.webmanifest"]) copyFileSync(f, "dist/" + f);
writeFileSync("dist/sw.js", readFileSync("sw.js", "utf8").replace("__BUILD__", Date.now().toString(36))); // new cache name on every build

// ---- PWA icons: a dark tile with a 5x3 block of green LED dots (PNG written by hand, no image library needed)
const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => (b.reduce((c, x) => CRC[(c ^ x) & 255] ^ (c >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function icon(size, pad) {
  // pad = fraction of the tile left empty around the dots (larger for the maskable icon, whose edges get cropped)
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const inner = size * (1 - 2 * pad);
  const cell = inner / 8; // 8 columns x 5 rows of cells, dots in a 5x3 pattern of cells
  const x0 = (size - inner) / 2;
  const y0 = (size - cell * 5) / 2;
  const on = [".###.", "#...#", "#####", "#...#", "#...#"]; // letter "A" on a 5-row grid
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let rgb = [22, 22, 21];
      const gx = Math.floor((x - x0 - cell * 1.5) / cell);
      const gy = Math.floor((y - y0) / cell);
      if (gx >= 0 && gx < 5 && gy >= 0 && gy < 5) {
        const cx = x0 + cell * 1.5 + (gx + 0.5) * cell;
        const cy = y0 + (gy + 0.5) * cell;
        const d = Math.hypot(x - cx, y - cy);
        if (d < cell * 0.38) rgb = on[gy][gx] === "#" ? [93, 202, 165] : [38, 52, 47];
      }
      raw.set(rgb, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
writeFileSync("dist/icon-192.png", icon(192, 0.1));
writeFileSync("dist/icon-512.png", icon(512, 0.1));
writeFileSync("dist/icon-maskable-512.png", icon(512, 0.2));
copyFileSync("node_modules/leaflet/dist/leaflet.css", "dist/leaflet.css"); // map styles (the map code itself is a lazily loaded chunk)
mkdirSync("dist/admin", { recursive: true });
copyFileSync("admin/index.html", "dist/admin/index.html"); // served at /ACT1033_LED/admin/

const options = {
  entryPoints: { app: "src/main.js", admin: "src/admin.js" },
  bundle: true,
  format: "esm",
  splitting: true, // the Leaflet map is a dynamic import() and becomes its own chunk
  target: "es2022",
  minify: true,
  sourcemap: false,
  outdir: "dist",
  logLevel: "info",
};

if (process.argv.includes("--serve")) {
  const ctx = await context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: "dist", port: 8080 });
  console.log("http://localhost:" + port + "  (re-run copy for index.html / style.css changes)");
} else {
  await build(options);
}
