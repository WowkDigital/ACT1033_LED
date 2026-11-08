// Colour presets and pixel quantiser for the Blobs tab. The blobs themselves are drawn by the original
// BlobBackground library (blob-background.js, see blobs-render.js) at high resolution; this module turns that
// picture into 64x16 panel frames that use only palette colours (the GIF allows at most 16).

import { H, W } from "./life.js";

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

export const toHex = (c) => "#" + c.toString(16).padStart(6, "0");

/**
 * Downsamples RGBA pixels (width = W*scale, height = H*scale) to a 64x16 frame: every panel pixel takes the
 * palette colour (bg first, then rings) that wins the vote among the pixels of its scale x scale block.
 */
export function quantize(rgba, scale, pal) {
  const cols = [pal.bg, ...pal.rings].map((c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255]);
  const nearest = (r, g, b) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < cols.length; i++) {
      const d = (cols[i][0] - r) ** 2 + (cols[i][1] - g) ** 2 + (cols[i][2] - b) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  const full = W * scale;
  const out = new Uint32Array(W * H);
  const all = [pal.bg, ...pal.rings];
  const votes = new Uint16Array(cols.length);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      votes.fill(0);
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const o = ((y * scale + dy) * full + x * scale + dx) * 4;
          votes[nearest(rgba[o], rgba[o + 1], rgba[o + 2])]++;
        }
      let best = 0;
      for (let i = 1; i < votes.length; i++) if (votes[i] > votes[best]) best = i;
      out[y * W + x] = all[best];
    }
  return out;
}
