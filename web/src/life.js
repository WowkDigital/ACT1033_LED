// Conway's Game of Life on a 32x8 grid of 2x2 px cells -> 64x16 frames (same algorithm and PRNG as
// python/act1033led/render.py, so the same seed gives the same animation).

export const W = 64;
export const H = 16;
const GW = 32;
const GH = 8;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function step(g, wrap) {
  const out = new Uint8Array(GW * GH);
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          let yy = y + dy;
          let xx = x + dx;
          if (wrap) {
            yy = (yy + GH) % GH;
            xx = (xx + GW) % GW;
          } else if (yy < 0 || yy >= GH || xx < 0 || xx >= GW) continue;
          s += g[yy * GW + xx];
        }
      const alive = g[y * GW + x];
      out[y * GW + x] = (alive && (s === 2 || s === 3)) || (!alive && s === 3) ? 1 : 0;
    }
  return out;
}

function digest(a) {
  let h = 2166136261;
  for (const v of a) h = Math.imul(h ^ v, 16777619) >>> 0;
  return h;
}

/** Returns n frames of 64*16 pixels: `fg` where a cell is alive, `bg` elsewhere (packed 0xRRGGBB). */
export function lifeFrames(n, { density = 0.3, seed = 1, wrap = true, reseed = true, fg = 0x00ff00, bg = 0 } = {}) {
  const rnd = mulberry32(seed);
  let g = new Uint8Array(GW * GH);
  let hist = [];
  const sow = () => {
    for (let i = 0; i < g.length; i++) g[i] = rnd() < density ? 1 : 0;
    hist = [];
  };
  sow();
  const frames = [];
  for (let i = 0; i < n; i++) {
    const f = new Uint32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = g[(y >> 1) * GW + (x >> 1)] ? fg : bg;
    frames.push(f);
    g = step(g, wrap);
    const h = digest(g);
    if (reseed && (hist.includes(h) || !g.some((v) => v))) sow();
    else {
      hist.push(h);
      if (hist.length > 4) hist.shift();
    }
  }
  return frames;
}
