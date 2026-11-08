// Blob generator for the 64x16 panel: non-overlapping circles packed with a seeded PRNG, drawn as
// concentric flat-colour rings with a gently wobbling outline. Inspired by BlobBackground.js, but rasterised
// per pixel, because the panel's GIF allows only 16 colours (background + at most 15 ring colours, no colour jitter).

import { H, W, mulberry32 } from "./life.js";

const hsl = (h, s, l) => {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return (f(0) << 16) | (f(8) << 8) | f(4);
};
const hex = (s) => parseInt(s.slice(1), 16);

/** Palettes: bg + ring colours (packed 0xRRGGBB). Same names and colours as BlobBackground.js. */
export const PALETTES = {
  "Warm Ceramic": { bg: hex("#f5f0e8"), rings: [hsl(4, 78, 48), hsl(20, 82, 50), hsl(48, 88, 54), hsl(170, 52, 48), hsl(215, 65, 48), hsl(230, 60, 32)] },
  "Ocean Deep": { bg: hex("#e8f0f5"), rings: [hsl(200, 60, 40), hsl(185, 70, 48), hsl(170, 65, 55), hsl(50, 80, 60), hsl(30, 85, 52)] },
  "Forest Moss": { bg: hex("#f0ede4"), rings: [hsl(30, 55, 38), hsl(80, 50, 42), hsl(120, 45, 50), hsl(160, 55, 45), hsl(45, 75, 55), hsl(90, 60, 30)] },
  "Sunset Violet": { bg: hex("#f5ece8"), rings: [hsl(340, 72, 48), hsl(15, 80, 52), hsl(40, 85, 58), hsl(280, 55, 45)] },
  "Crimson Mono": { bg: hex("#f2ece6"), rings: [hsl(0, 72, 42), hsl(15, 65, 52), hsl(30, 70, 60)] },
  "Deep Blue": { bg: hex("#262948"), rings: [hsl(218, 40, 32), hsl(212, 13, 40), hsl(187, 30, 68), hsl(52, 48, 85)] },
  "Neon Night": { bg: hex("#000000"), rings: [hex("#ff2d95"), hex("#00e5ff"), hex("#b6ff00"), hex("#ffb000"), hex("#8a2be2")] },
  "Amber Terminal": { bg: hex("#000000"), rings: [hex("#ffb000"), hex("#cc7a00"), hex("#804d00")] },
  "Green Matrix": { bg: hex("#000000"), rings: [hex("#00ff41"), hex("#00b82e"), hex("#007a1f")] },
  "Candy Dark": { bg: hex("#10101c"), rings: [hex("#ff6b9d"), hex("#ffc46b"), hex("#6bffb8"), hex("#6bb8ff"), hex("#c46bff")] },
  "Pain Eye": { bg: hex("#ffffff"), rings: [hsl(0, 100, 50), hsl(135, 100, 50), hsl(225, 100, 50), hsl(318, 100, 50), hsl(180, 100, 50), hsl(30, 100, 50)] },
};

export const BLOB_FRAMES = 24; // one full wobble cycle

/** Packs circles biggest-first; `pad` reserves room for the wobble so animated outlines never touch. */
export function packBlobs(rnd, { minR, maxR, gap, pad }) {
  const blobs = [];
  const fits = (x, y, r) => {
    const rr = r * (1 + pad);
    if (x - rr < 0 || x + rr > W || y - rr < 0 || y + rr > H) return false;
    return blobs.every((b) => Math.hypot(x - b.x, y - b.y) >= rr + b.r * (1 + pad) + gap);
  };
  const radii = [];
  for (let i = 0; i < 120; i++) radii.push(minR + rnd() * (maxR - minR));
  radii.sort((a, b) => b - a);
  for (const r of radii) {
    for (let t = 0; t < 60; t++) {
      const x = rnd() * W;
      const y = rnd() * H;
      if (fits(x, y, r)) {
        blobs.push({ x, y, r });
        break;
      }
    }
  }
  return blobs;
}

/** Returns n frames of 64*16 pixels (packed 0xRRGGBB). n = 1 gives a still picture. */
export function blobFrames({ seed = 1, palette = "Warm Ceramic", minR = 2, maxR = 7, gap = 1, wobble = 0.15, frames = BLOB_FRAMES } = {}) {
  const pal = PALETTES[palette] || PALETTES["Warm Ceramic"];
  const rnd = mulberry32(seed);
  minR = Math.max(1, Math.min(minR, maxR));
  const blobs = packBlobs(rnd, { minR, maxR, gap, pad: wobble });
  for (const b of blobs) {
    b.rings = b.r >= 5 ? 3 : b.r >= 3 ? 2 : 1;
    b.base = Math.floor(rnd() * pal.rings.length);
    b.p1 = rnd() * Math.PI * 2;
    b.p2 = rnd() * Math.PI * 2;
    b.m1 = rnd() < 0.5 ? 1 : -1; // direction of the wobble, integer cycles per loop => seamless
  }
  const out = [];
  for (let f = 0; f < frames; f++) {
    const t = frames > 1 ? (f / frames) * Math.PI * 2 : 0;
    const img = new Uint32Array(W * H).fill(pal.bg);
    for (const b of blobs) {
      const reach = Math.ceil(b.r * (1 + wobble)) + 1;
      for (let y = Math.max(0, Math.floor(b.y) - reach); y <= Math.min(H - 1, Math.floor(b.y) + reach); y++) {
        for (let x = Math.max(0, Math.floor(b.x) - reach); x <= Math.min(W - 1, Math.floor(b.x) + reach); x++) {
          const dx = x + 0.5 - b.x;
          const dy = y + 0.5 - b.y;
          const a = Math.atan2(dy, dx);
          const rEff = b.r * (1 + wobble * (0.6 * Math.sin(2 * a + b.p1 + b.m1 * t) + 0.4 * Math.sin(3 * a + b.p2 - b.m1 * t)));
          const d = Math.hypot(dx, dy) / rEff;
          if (d > 1) continue;
          const ring = Math.min(b.rings - 1, Math.floor((1 - d) * b.rings));
          img[y * W + x] = pal.rings[(b.base + ring) % pal.rings.length];
        }
      }
    }
    out.push(img);
  }
  return { frames: out, count: blobs.length, bg: pal.bg };
}
