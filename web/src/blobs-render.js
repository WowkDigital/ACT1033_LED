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

/** opts: { seed, palette, minR, maxR, gap, wobble, animate } (sizes in panel pixels). */
export async function blobFrames({ seed = 1, palette = "Warm Ceramic", minR = 2, maxR = 7, gap = 1, wobble = 0.08, animate = true }) {
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
      edgeGap: 0,
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
    const n = animate ? BLOB_FRAMES : 1;
    for (let f = 0; f < n; f++) {
      // animation: blobs appear one by one over the first 2/3 of the loop, then hold
      const t = animate ? Math.min(1, f / (n * 0.66)) : 1;
      groups.forEach((g, i) => (g.style.display = delays[i] <= t ? "" : "none"));
      const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
      const img = await loadImage(url);
      ctx.fillStyle = toHex(pal.bg);
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      frames.push(quantize(ctx.getImageData(0, 0, canvas.width, canvas.height).data, SCALE, pal));
    }
    return { frames, count: groups.length, bg: pal.bg };
  } finally {
    Math.random = realRandom;
    BlobBackground.destroy(host);
    host.remove();
  }
}
