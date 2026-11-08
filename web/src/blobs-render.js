// Runs the original BlobBackground library in an off-screen element and rasterises the result to 64x16 frames.
import { BlobBackground } from "./blob-background.js";
import { H, W, mulberry32 } from "./life.js";
import { PALETTES, quantize, toHex } from "./blobs.js";

const SCALE = 8; // library pixels per panel pixel
export const BLOB_FRAMES = 24;

const loadImage = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not draw the blobs"));
    img.src = url;
  });

/** opts: { seed, palette, minR, maxR, gap, wobble, mode: "still" | "appear" | "scroll", step } (sizes in panel pixels; step = panel pixels moved per frame when scrolling). */
export async function blobFrames({ seed = 1, palette = "Warm Ceramic", minR = 2, maxR = 7, gap = 1, wobble = 0.08, mode = "appear", step = 1 }) {
  const pal = PALETTES[palette] || PALETTES["Warm Ceramic"];
  const host = document.createElement("div");
  host.style.cssText = `position:absolute;left:-99999px;top:0;width:${W * SCALE}px;height:${H * SCALE}px`;
  document.body.append(host);
  const realRandom = Math.random;
  try {
    Math.random = mulberry32(seed); // the library uses Math.random: a seed makes the picture repeatable
    BlobBackground.init(host, {
      palette: { name: "panel", bg: toHex(pal.bg), rings: pal.rings.map(toHex) },
      minRadius: minR * SCALE,
      maxRadius: Math.max(minR, maxR) * SCALE,
      gap: gap * SCALE,
      edgeGap: mode === "scroll" ? (gap * SCALE) / 2 : 0, // scrolling wraps around: keep the seam as open as any other gap
      wobble,
      colorVariation: 0,
      fadeIn: false,
      autoResize: false,
      avoidContent: false,
    });
    Math.random = realRandom;
    const svg = host.querySelector(".blob-bg-svg");
    const groups = [...svg.querySelectorAll(":scope > g")];
    const delays = groups.map(() => Math.random());
    const canvas = document.createElement("canvas");
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const frames = [];
    const draw = async () => {
      groups.forEach((g, i) => (g.style.display = shown(i) ? "" : "none"));
      const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
      const img = await loadImage(url);
      ctx.fillStyle = toHex(pal.bg);
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    const read = () => quantize(ctx.getImageData(0, 0, canvas.width, canvas.height).data, SCALE, pal);
    let shown = () => true;
    if (mode === "appear") {
      // blobs appear one by one over the first 2/3 of the loop, then hold
      for (let f = 0; f < BLOB_FRAMES; f++) {
        const t = Math.min(1, f / (BLOB_FRAMES * 0.66));
        shown = (i) => delays[i] <= t;
        await draw();
        frames.push(read());
      }
    } else if (mode === "scroll") {
      await draw();
      const still = document.createElement("canvas");
      still.width = canvas.width;
      still.height = canvas.height;
      still.getContext("2d").drawImage(canvas, 0, 0);
      const n = Math.max(1, Math.floor(W / Math.max(1, step)));
      for (let f = 0; f < n; f++) {
        const dx = Math.round(f * step * SCALE); // moves right; the picture wraps around, so the loop is seamless
        ctx.drawImage(still, dx, 0);
        ctx.drawImage(still, dx - canvas.width, 0);
        frames.push(read());
      }
    } else {
      await draw();
      frames.push(read());
    }
    return { frames, count: groups.length, bg: pal.bg };
  } finally {
    Math.random = realRandom;
    BlobBackground.destroy(host);
    host.remove();
  }
}
