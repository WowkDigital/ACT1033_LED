// Bundles src/main.js (which imports the Worker's renderer from ../cloudflare/src) into dist/, next to the static files.
//   npm run build        -> dist/
//   npm run dev          -> dist/ + local server on http://localhost:8080
import { build, context } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
for (const f of ["index.html", "style.css"]) copyFileSync(f, "dist/" + f);

const options = {
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  sourcemap: false,
  outfile: "dist/app.js",
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
