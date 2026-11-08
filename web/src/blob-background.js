/**
 * BlobBackground.js — Organic blob pattern generator
 * Generates dense, non-overlapping concentric-ring blobs inside any element.
 *
 * Usage:
 *   <script src="blob-background.js"></script>
 *   <script>
 *     BlobBackground.init('#my-element');
 *     // or with options:
 *     BlobBackground.init(document.querySelector('.card'), {
 *       palette: 'Ocean Deep',        // palette name or index
 *       minRadius: 6,
 *       maxRadius: 24,
 *       gap: 2,
 *       wobble: 0.08,
 *       autoResize: true,
 *       paths: [{                     // blobs along SVG paths
 *         d: 'M 50,200 C 150,50 350,50 450,200',
 *         radius: 10,
 *         spacing: 3,
 *       }, {
 *         svg: '#my-svg',             // …or along an SVG drawn on the page
 *       }],
 *     });
 *   </script>
 *
 * API:
 *   BlobBackground.init(target, options?)  — apply to one element
 *   BlobBackground.initAll(selector, options?)  — apply to all matching
 *   BlobBackground.regenerate(target?)  — regenerate one or all
 *   BlobBackground.destroy(target)  — remove blobs and restore the element
 *   BlobBackground.setSessionPalette(palette)  — set the page palette (HEX or HSL)
 *   BlobBackground.palettes  — array of available palettes (read/push)
 */

var BlobBackground = (function () {
    'use strict';

    // ─── Default Palettes ───────────────────────────────
    const DEFAULT_PALETTES = [
        {
            name: 'Warm Ceramic',
            bg: '#f5f0e8',
            rings: [
                { h: 4, s: 78, l: 48 },
                { h: 20, s: 82, l: 50 },
                { h: 48, s: 88, l: 54 },
                { h: 170, s: 52, l: 48 },
                { h: 215, s: 65, l: 48 },
                { h: 230, s: 60, l: 32 },
            ],
            accents: [
                { h: 350, s: 45, l: 30 },
                { h: 38, s: 70, l: 90 },
                { h: 190, s: 35, l: 60 },
            ]
        },
        {
            name: 'Ocean Deep',
            bg: '#e8f0f5',
            rings: [
                { h: 200, s: 60, l: 40 },
                { h: 185, s: 70, l: 48 },
                { h: 170, s: 65, l: 55 },
                { h: 50, s: 80, l: 60 },
                { h: 30, s: 85, l: 52 },
            ],
            accents: [
                { h: 210, s: 50, l: 25 },
                { h: 45, s: 90, l: 75 },
                { h: 160, s: 40, l: 85 },
            ]
        },
        {
            name: 'Forest Moss',
            bg: '#f0ede4',
            rings: [
                { h: 30, s: 55, l: 38 },
                { h: 80, s: 50, l: 42 },
                { h: 120, s: 45, l: 50 },
                { h: 160, s: 55, l: 45 },
                { h: 45, s: 75, l: 55 },
                { h: 90, s: 60, l: 30 },
            ],
            accents: [
                { h: 25, s: 40, l: 22 },
                { h: 95, s: 35, l: 75 },
                { h: 55, s: 60, l: 88 },
            ]
        },
        {
            name: 'Sunset Violet',
            bg: '#f5ece8',
            rings: [
                { h: 340, s: 72, l: 48 },
                { h: 15, s: 80, l: 52 },
                { h: 40, s: 85, l: 58 },
                { h: 280, s: 55, l: 45 },
            ],
            accents: [
                { h: 310, s: 40, l: 28 },
                { h: 25, s: 75, l: 85 },
                { h: 260, s: 30, l: 70 },
            ]
        },
        {
            name: 'Crimson Mono',
            bg: '#f2ece6',
            rings: [
                { h: 0, s: 72, l: 42 },
                { h: 15, s: 65, l: 52 },
                { h: 30, s: 70, l: 60 },
            ],
            accents: [
                { h: 355, s: 50, l: 25 },
                { h: 20, s: 55, l: 82 },
                { h: 40, s: 40, l: 70 },
            ]
        },
        {
            name: 'Deep Blue',
            bg: '#262948',
            rings: [
                { h: 218, s: 40, l: 32 },
                { h: 212, s: 13, l: 40 },
                { h: 187, s: 30, l: 68 },
                { h: 52, s: 48, l: 85 },
            ],
            accents: [
                { h: 225, s: 55, l: 18 },
                { h: 45, s: 60, l: 70 },
                { h: 195, s: 25, l: 50 },
            ]
        },
        {
            name: 'Pain Eye',
            bg: '#FFFFFF',
            rings: [
                { h: 0, s: 100, l: 50 },
                { h: 135, s: 100, l: 50 },
                { h: 225, s: 100, l: 50 },
                { h: 318, s: 100, l: 50 },
                { h: 180, s: 100, l: 50 },
                { h: 30, s: 100, l: 50 },
            ],
            accents: [
                { h: 60, s: 100, l: 50 },
                { h: 270, s: 80, l: 30 },
                { h: 90, s: 60, l: 80 },
            ]
        },
    ];

    // ─── Defaults ───────────────────────────────────────
    const DEFAULTS = {
        minRadius: 4,
        maxRadius: 28,
        gap: 2,
        edgeGap: 3,          // px gap between blobs and container edge
        points: 14,
        wobble: 0.08,

        autoResize: true,
        palette: null,       // null = random, or name/index
        avoidContent: true,  // auto-detect child elements and pack blobs around them
        avoidPadding: 6,     // px padding around avoided elements
        fadeIn: true,        // enable staggered fade-in entrance animation
        fadeDuration: 1,     // fade animation duration in seconds
        fadeMaxDelay: 6,     // max random delay before a blob starts fading in (seconds)
        colorVariation: 10,  // max random HSL shift per blob (0 = exact palette colours)
        paintBackground: true, // set the container background-color to the palette bg
        clip: true,          // clip blobs to the container (false = may spill past its edges)
        fillBackground: true,// whether to fill the container with background blobs
        paths: [],           // array of path configs for path-based blob placement
        debugPaths: false,   // if true, renders the raw SVG path as a red line
    };

    const PATH_DEFAULTS = {
        mode: 'path',        // 'path' (uses path config) or 'global' (uses global min/maxRadius)
        d: '',               // SVG path 'd' attribute string
        radius: 10,          // base blob radius along the path
        radiusVariation: 3,  // ± random radius variation
        spacing: 3,          // gap between blobs along the path (px)
        offset: 0,           // max perpendicular offset from path (px)
        wobble: 0.08,        // wobble amount for path blobs
        points: 14,          // control points for path blobs
        colorIndices: null,  // null = sequential rings, [0,2] = only those ring indices
        palette: null,       // null = inherit container palette, or name/index/object
        avoidFill: false,    // if true, background packing skips the closed interior
        svg: null,           // instead of d: an SVG element / shape / selector drawn on the page
        hideSvg: true,       // with svg: hide the drawn SVG (true = opacity 0, number = that opacity, false = keep)
    };

    // ─── Instances ──────────────────────────────────────
    const instances = new Map();
    let uid = 0;

    // Singleton hidden SVG for path measurements (avoids repeated DOM create/remove)
    let _tmpSvg = null;
    function getTmpSvg() {
        if (!_tmpSvg) {
            _tmpSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            _tmpSvg.setAttribute('width', '0');
            _tmpSvg.setAttribute('height', '0');
            _tmpSvg.style.cssText = 'position:absolute;left:-9999px;top:-9999px;pointer-events:none;';
        }
        if (!_tmpSvg.parentNode) document.body.appendChild(_tmpSvg);
        return _tmpSvg;
    }

    // Session palette: one random palette shared by all elements per page load.
    // Picked on first init() or regenerate(). Overridden per-element if
    // the element's options specify a concrete palette.
    let sessionPalette = null;

    // ─── Fade-in Keyframes (injected once) ──────────────
    let fadeKeyframesInjected = false;
    function injectFadeKeyframes() {
        if (fadeKeyframesInjected) return;
        const s = document.createElement('style');
        s.id = 'bl-fadein-keyframes';
        s.textContent = '@keyframes bl-fadein{from{opacity:0}to{opacity:1}}';
        document.head.appendChild(s);
        fadeKeyframesInjected = true;
    }

    // ─── Utilities ──────────────────────────────────────

    function rand(a, b) { return Math.random() * (b - a) + a; }
    /** Inclusive range; returns `a` when the interval is empty or inverted. */
    function randRange(a, b) { return b > a ? rand(a, b) : a; }
    function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
    function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

    const MIN_BLOB_R = 0.5;

    /** Radius/spacing used by a path brush (shared by packing and debug overlay). */
    function pathBrushGeom(cfg, opts) {
        if (cfg.mode === 'global') {
            const minR = Math.max(1, opts.minRadius);
            const maxR = Math.max(minR, opts.maxRadius);
            return { minR, maxR, spacing: opts.gap };
        }
        const minR = Math.max(1, cfg.radius - cfg.radiusVariation);
        const maxR = cfg.radius + cfg.radiusVariation;
        return { minR, maxR, spacing: cfg.spacing };
    }

    // ─── Colours: HEX or HSL palette entries ────────────
    //
    // Palette rings/accents may be { h, s, l } objects or HEX strings
    // ('#c84030' / '#c43'). Everything is normalised to { h, s, l, hex? }.
    // `hex` is kept so that colorVariation: 0 renders the exact input colour
    // (an HSL round-trip with integer rounding can shift RGB by 1–2 units).

    const GREY = { h: 0, s: 0, l: 50 };

    function hexToHsl(hex) {
        let m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
        if (!m) return null;
        let v = m[1];
        if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
        const r = parseInt(v.slice(0, 2), 16) / 255;
        const g = parseInt(v.slice(2, 4), 16) / 255;
        const b = parseInt(v.slice(4, 6), 16) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;
        let h = 0, s = 0;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h /= 6;
        }
        return { h: h * 360, s: s * 100, l: l * 100, hex: '#' + v.toLowerCase() };
    }

    function normalizeColor(c) {
        if (typeof c === 'string') return hexToHsl(c) || GREY;
        if (c && isFinite(c.h) && isFinite(c.s) && isFinite(c.l)) return c;
        return GREY;
    }

    function colorToCss(c) {
        if (c.hex) return c.hex;
        return `hsl(${Math.round(c.h)},${Math.round(c.s)}%,${Math.round(c.l)}%)`;
    }

    // Cache so a palette object is normalised once, not per blob
    const normalizedCache = new WeakMap();

    function normalizePalette(p) {
        if (normalizedCache.has(p)) return normalizedCache.get(p);
        const bg = typeof p.bg === 'string' ? p.bg : colorToCss(normalizeColor(p.bg));
        const out = {
            name: p.name || 'Custom',
            bg: bg,
            rings: (p.rings || []).map(normalizeColor),
            accents: (p.accents || []).map(normalizeColor),
        };
        if (!out.rings.length) out.rings.push(GREY);
        normalizedCache.set(p, out);
        normalizedCache.set(out, out);
        return out;
    }

    function varyColor(base, v) {
        if (!(v > 0)) return colorToCss(base);
        const h = base.h + rand(-v, v);
        const sMin = Math.max(0, Math.min(base.s - v, 25));
        const s = clamp(base.s + rand(-v, v), sMin, 100);
        const lMin = Math.max(0, Math.min(base.l - v, 22));
        const lMax = Math.min(100, Math.max(base.l + v, 72));
        const l = clamp(base.l + rand(-v * 0.7, v * 0.7), lMin, lMax);
        return `hsl(${h | 0},${s | 0}%,${l | 0}%)`;
    }

    // ─── Blob Path ──────────────────────────────────────

    function blobPath(cx, cy, radius, nPts, wobbleAmt) {
        const pts = [];
        const aOff = rand(0, Math.PI * 2);
        for (let i = 0; i < nPts; i++) {
            const a = aOff + (Math.PI * 2 * i) / nPts;
            const w = 1
                + Math.sin(a * 2 + rand(0, 6.28)) * wobbleAmt * 0.5
                + Math.sin(a * 3 + rand(0, 6.28)) * wobbleAmt * 0.3
                + rand(-wobbleAmt * 0.2, wobbleAmt * 0.2);
            pts.push({
                x: cx + Math.cos(a) * radius * w,
                y: cy + Math.sin(a) * radius * w,
            });
        }
        return catmullRomClosed(pts);
    }

    function catmullRomClosed(pts) {
        const n = pts.length;
        if (n < 3) return '';
        const p = i => pts[(i % n + n) % n];
        const d = [`M ${p(0).x.toFixed(1)} ${p(0).y.toFixed(1)}`];
        for (let i = 0; i < n; i++) {
            const a = p(i - 1), b = p(i), c = p(i + 1), e = p(i + 2);
            d.push(
                `C ${(b.x + (c.x - a.x) / 6).toFixed(1)} ${(b.y + (c.y - a.y) / 6).toFixed(1)},` +
                `${(c.x - (e.x - b.x) / 6).toFixed(1)} ${(c.y - (e.y - b.y) / 6).toFixed(1)},` +
                `${c.x.toFixed(1)} ${c.y.toFixed(1)}`
            );
        }
        d.push('Z');
        return d.join(' ');
    }

    // ─── Shape Detection ─────────────────────────────────

    /** Parse a CSS length value (px or %) to pixels */
    function parseCSSLen(val, ref) {
        if (!val || val === '0px' || val === 'none') return 0;
        if (val.endsWith('%')) return parseFloat(val) / 100 * ref;
        return parseFloat(val) || 0;
    }

    /** Parse border-radius into [TL, TR, BR, BL] pixel values */
    function parseBorderRadii(cs, W, H) {
        const parse = (prop) => {
            const val = cs[prop];
            if (!val) return 0;
            // May be "Xpx Ypx" (horiz, vert) — use min for conservative circle check
            const parts = val.trim().split(/\s+/);
            const h = parseCSSLen(parts[0], W);
            const v = parts.length > 1 ? parseCSSLen(parts[1], H) : h;
            return Math.min(h, v, W / 2, H / 2); // cap to half-dimension
        };
        return [
            parse('borderTopLeftRadius'),
            parse('borderTopRightRadius'),
            parse('borderBottomRightRadius'),
            parse('borderBottomLeftRadius'),
        ];
    }

    /** Parse clip-path polygon("50% 0%, 100% 25%, ...") into [{x,y}] pixels */
    function parseClipPolygon(clipStr, W, H) {
        const m = clipStr.match(/polygon\(([^)]+)\)/);
        if (!m) return null;
        const pts = m[1].split(',').map(pair => {
            const [xv, yv] = pair.trim().split(/\s+/);
            return { x: parseCSSLen(xv, W), y: parseCSSLen(yv, H) };
        });
        return pts.length >= 3 ? pts : null;
    }

    /** Point-in-polygon (ray casting) */
    function pointInPoly(px, py, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y;
            const xj = poly[j].x, yj = poly[j].y;
            if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
                inside = !inside;
            }
        }
        return inside;
    }

    /** Check if circle (cx,cy,r) is fully inside a polygon (sample circumference) */
    function circleInPolygon(cx, cy, r, poly) {
        if (!pointInPoly(cx, cy, poly)) return false;
        for (let i = 0; i < 24; i++) {
            const a = (Math.PI * 2 * i) / 24;
            if (!pointInPoly(cx + Math.cos(a) * r, cy + Math.sin(a) * r, poly)) return false;
        }
        return true;
    }

    /** Check if circle is inside a rounded rectangle */
    function circleInRoundedRect(cx, cy, r, W, H, radii) {
        // Basic rect bounds
        if (cx - r < 0 || cx + r > W || cy - r < 0 || cy + r > H) return false;

        const [rTL, rTR, rBR, rBL] = radii;

        // Top-left corner
        if (rTL > 0 && cx < rTL && cy < rTL) {
            const dx = cx - rTL, dy = cy - rTL;
            if (Math.sqrt(dx * dx + dy * dy) + r > rTL) return false;
        }
        // Top-right corner
        if (rTR > 0 && cx > W - rTR && cy < rTR) {
            const dx = cx - (W - rTR), dy = cy - rTR;
            if (Math.sqrt(dx * dx + dy * dy) + r > rTR) return false;
        }
        // Bottom-right corner
        if (rBR > 0 && cx > W - rBR && cy > H - rBR) {
            const dx = cx - (W - rBR), dy = cy - (H - rBR);
            if (Math.sqrt(dx * dx + dy * dy) + r > rBR) return false;
        }
        // Bottom-left corner
        if (rBL > 0 && cx < rBL && cy > H - rBL) {
            const dx = cx - rBL, dy = cy - (H - rBL);
            if (Math.sqrt(dx * dx + dy * dy) + r > rBL) return false;
        }

        return true;
    }

    /**
     * Create a shape-test function for the element.
     * Returns (cx, cy, r) => boolean — true if circle fits in visible shape.
     */
    function createShapeTest(el, W, H) {
        const cs = getComputedStyle(el);

        // 1. Check clip-path polygon (hexagon, star, cross, etc.)
        const clipStr = cs.clipPath || cs.webkitClipPath || '';
        if (clipStr.indexOf('polygon') >= 0) {
            const poly = parseClipPolygon(clipStr, W, H);
            if (poly) {
                return function (cx, cy, r) {
                    return circleInPolygon(cx, cy, r, poly);
                };
            }
        }

        // 2. Check border-radius (circle, pill, arch, etc.)
        const radii = parseBorderRadii(cs, W, H);
        if (radii.some(r => r > 2)) {
            return function (cx, cy, r) {
                return circleInRoundedRect(cx, cy, r, W, H, radii);
            };
        }

        // 3. Simple rectangle
        return function (cx, cy, r) {
            return cx - r >= 0 && cx + r <= W && cy - r >= 0 && cy + r <= H;
        };
    }

    // ─── Content Exclusion Zones ─────────────────────

    /**
     * Scan visible child elements inside the container and return rectangles
     * that blobs should avoid (buttons, text, images, etc.).
     * Only scans direct children and their first-level descendants for performance.
     */
    function getExclusionZones(el, W, H, padding) {
        const zones = [];
        const containerRect = el.getBoundingClientRect();
        const containerArea = W * H;

        // Collect candidates: direct children + their immediate children (max 2 levels)
        const candidates = [];
        for (const child of el.children) {
            if (child.classList.contains('blob-bg-svg')) continue;
            candidates.push(child);
            for (const grandchild of child.children) {
                candidates.push(grandchild);
            }
        }

        for (const child of candidates) {
            if (child.closest('.blob-bg-svg')) continue;
            // Elements drawn by the engine itself (e.g. an SVG used as a blob path)
            if (child.closest('[data-blob-ignore]')) continue;

            const cs = getComputedStyle(child);
            // Skip hidden elements
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            if (parseFloat(cs.opacity) < 0.05) continue;

            const rect = child.getBoundingClientRect();
            const x = rect.left - containerRect.left + el.scrollLeft;
            const y = rect.top - containerRect.top + el.scrollTop;
            const w = rect.width;
            const h = rect.height;

            // Skip elements with no real dimensions
            if (w < 4 || h < 4) continue;

            // Skip full-coverage containers (layout wrappers covering > 60% of area)
            if (w * h > containerArea * 0.6) continue;

            // Add as exclusion zone with padding
            zones.push({
                x: x - padding,
                y: y - padding,
                w: w + padding * 2,
                h: h + padding * 2,
            });
        }

        return zones;
    }

    // ─── Path-based Blob Placement ──────────────────
    //
    // Centers are packed in the Euclidean plane. Stepping by arc length
    // (dist += r1+r2+gap) is only valid on a straight line: on a curve the
    // chord is shorter than the arc, so the next disk already overlaps the
    // previous one, the collision test rejects it, and the stroke looks
    // irregularly gappy. We sample the path to a polyline and advance to the
    // first sample whose chord from the last *path* point equals r1+r2+gap.
    // Perpendicular offset is a jitter around that sample, retried so it
    // cannot punch holes in the chain.

    function samplePathPolyline(pathEl, totalLen) {
        const step = 1;
        const n = Math.max(2, Math.ceil(totalLen / step));
        const pts = new Array(n + 1);
        for (let i = 0; i <= n; i++) {
            const p = pathEl.getPointAtLength((i / n) * totalLen);
            pts[i] = { x: p.x, y: p.y };
        }
        return pts;
    }

    function polylineNormal(pts, i) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        const tx = b.x - a.x, ty = b.y - a.y;
        const len = Math.sqrt(tx * tx + ty * ty) || 1;
        return { nx: -ty / len, ny: tx / len };
    }

    /** First index after iStart whose chord from (ax,ay) is >= minSep. */
    function nextIndexAtSeparation(pts, iStart, ax, ay, minSep) {
        const minSepSq = minSep * minSep;
        for (let i = iStart + 1; i < pts.length; i++) {
            const dx = pts[i].x - ax, dy = pts[i].y - ay;
            if (dx * dx + dy * dy >= minSepSq) return i;
        }
        return -1;
    }

    function polylineArea(pts) {
        let a = 0;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
        }
        return Math.abs(a * 0.5);
    }

    function decimatePolyline(pts, maxN) {
        if (pts.length <= maxN) return pts;
        const out = new Array(maxN);
        const step = (pts.length - 1) / (maxN - 1);
        for (let i = 0; i < maxN; i++) out[i] = pts[Math.round(i * step)];
        return out;
    }

    // ─── avoidFill: interior mask + distance field ──────
    //
    // All avoidFill interiors are rasterised once into a single mask, then an
    // exact Euclidean distance transform gives, for every cell, the distance
    // to the nearest interior cell. A circle (cx,cy,r) overlaps a hole iff
    // dist(cx,cy) < r, so each background fits() check is one array read
    // instead of ~22 isPointInPath calls, and thin/concave holes cannot slip
    // between circumference samples.

    /** Upper bound on mask cells; larger containers use cells > 1px. */
    const HOLE_FIELD_MAX_CELLS = 400000;

    /** Closed-ish path with enough area to be worth excluding. */
    function isFillableHole(pts) {
        return !!pts && pts.length >= 3 && polylineArea(pts) >= 64;
    }

    /** Rasterise holes with Canvas Path2D (matches SVG Béziers). */
    function rasterizeHolesCanvas(shapes, s, cols, rows, inside) {
        if (typeof Path2D === 'undefined') return false;
        try {
            const canvas = document.createElement('canvas');
            canvas.width = cols;
            canvas.height = rows;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return false;
            ctx.setTransform(1 / s, 0, 0, 1 / s, 0, 0);
            ctx.fillStyle = '#000';
            for (let i = 0; i < shapes.length; i++) {
                ctx.fill(new Path2D(shapes[i].d), 'nonzero');
            }
            const data = ctx.getImageData(0, 0, cols, rows).data;
            for (let i = 0, n = cols * rows; i < n; i++) {
                inside[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
            }
            return true;
        } catch (err) {
            return false;
        }
    }

    /** Fallback when Canvas is unavailable: point-in-polygon over each bbox. */
    function rasterizeHolesPoly(shapes, s, cols, rows, inside) {
        for (let k = 0; k < shapes.length; k++) {
            const poly = decimatePolyline(shapes[k].pts, 160);
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i < poly.length; i++) {
                const p = poly[i];
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
            }
            const c0 = clamp(Math.floor(minX / s), 0, cols - 1);
            const c1 = clamp(Math.floor(maxX / s), 0, cols - 1);
            const r0 = clamp(Math.floor(minY / s), 0, rows - 1);
            const r1 = clamp(Math.floor(maxY / s), 0, rows - 1);
            for (let row = r0; row <= r1; row++) {
                const py = (row + 0.5) * s;
                for (let col = c0; col <= c1; col++) {
                    if (pointInPoly((col + 0.5) * s, py, poly)) inside[row * cols + col] = 1;
                }
            }
        }
    }

    /**
     * 1D squared Euclidean distance transform (Felzenszwalb & Huttenlocher).
     * f: input costs (0 inside, large outside), d: output, v/z: scratch.
     */
    function edt1d(f, d, v, z, n) {
        let k = 0;
        v[0] = 0;
        z[0] = -Infinity;
        z[1] = Infinity;
        for (let q = 1; q < n; q++) {
            let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            while (s <= z[k]) {
                k--;
                s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            }
            k++;
            v[k] = q;
            z[k] = s;
            z[k + 1] = Infinity;
        }
        k = 0;
        for (let q = 0; q < n; q++) {
            while (z[k + 1] < q) k++;
            const dq = q - v[k];
            d[q] = dq * dq + f[v[k]];
        }
    }

    /**
     * Build one hit-tester for all avoidFill interiors.
     * shapes: [{ d, pts }]. Returns null when nothing is inside the container.
     */
    function buildHoleField(shapes, W, H) {
        if (!shapes.length) return null;

        const s = Math.max(1, Math.sqrt((W * H) / HOLE_FIELD_MAX_CELLS));
        const cols = Math.max(1, Math.ceil(W / s));
        const rows = Math.max(1, Math.ceil(H / s));
        const n = cols * rows;

        const inside = new Uint8Array(n);
        if (!rasterizeHolesCanvas(shapes, s, cols, rows, inside)) {
            rasterizeHolesPoly(shapes, s, cols, rows, inside);
        }

        const INF = 1e20;
        const sq = new Float64Array(n);
        let any = false;
        for (let i = 0; i < n; i++) {
            if (inside[i]) { sq[i] = 0; any = true; } else sq[i] = INF;
        }
        if (!any) return null;

        // Separable 2D transform: columns, then rows
        const len = Math.max(cols, rows);
        const f = new Float64Array(len);
        const d = new Float64Array(len);
        const v = new Int32Array(len);
        const z = new Float64Array(len + 1);
        for (let x = 0; x < cols; x++) {
            for (let y = 0; y < rows; y++) f[y] = sq[y * cols + x];
            edt1d(f, d, v, z, rows);
            for (let y = 0; y < rows; y++) sq[y * cols + x] = d[y];
        }
        for (let y = 0; y < rows; y++) {
            const o = y * cols;
            for (let x = 0; x < cols; x++) f[x] = sq[o + x];
            edt1d(f, d, v, z, cols);
            for (let x = 0; x < cols; x++) sq[o + x] = d[x];
        }

        const dist = new Float32Array(n);
        for (let i = 0; i < n; i++) dist[i] = Math.sqrt(sq[i]) * s;

        // A query point sits up to half a cell diagonal from its cell centre
        const margin = s * Math.SQRT1_2;

        function cellIndex(x, y) {
            const col = clamp((x / s) | 0, 0, cols - 1);
            const row = clamp((y / s) | 0, 0, rows - 1);
            return row * cols + col;
        }

        return {
            containsPoint: function (x, y) {
                return inside[cellIndex(x, y)] === 1;
            },
            hitsCircle: function (cx, cy, r) {
                return dist[cellIndex(cx, cy)] < r + margin;
            }
        };
    }

    // ─── Paths from SVG drawn on the page (path option `svg`) ─────────────
    //
    // A path config may give `svg` instead of `d`: an <svg>, a single shape,
    // a list of them or a selector (looked up in the container first, then in
    // the document). Every shape is sampled as it is rendered — viewBox,
    // preserveAspectRatio, CSS size and transforms included — into a polyline
    // in the container's coordinates, so the blobs sit exactly on the drawn
    // line. This runs on every generate, so autoResize keeps them aligned.

    const SVG_SHAPES = 'path,line,polyline,polygon,circle,ellipse,rect';
    const SVG_SKIP = 'defs,clipPath,mask,symbol,marker,pattern,.blob-skip,.af-blob-skip';
    const SVG_SAMPLE_PX = 2;
    const SVG_MAX_SAMPLES = 4000;
    const SVG_MAX_SHAPES = 100;

    function resolveSvgShapes(spec, el) {
        let nodes = [];
        if (typeof spec === 'string') {
            try {
                nodes = Array.from(el.querySelectorAll(spec));
                if (!nodes.length) nodes = Array.from(document.querySelectorAll(spec));
            } catch (err) {
                console.warn('BlobBackground: invalid svg selector', spec);
            }
        } else if (spec && spec.nodeType === 1) {
            nodes = [spec];
        } else if (spec && typeof spec.length === 'number') {
            nodes = Array.from(spec);
        }
        const shapes = [];
        for (const n of nodes) {
            if (!n || (n.closest && n.closest('.blob-bg-svg'))) continue;
            if (n.ownerSVGElement && typeof n.getTotalLength === 'function') {
                shapes.push(n);
                continue;
            }
            if (!n.querySelectorAll) continue;
            for (const s of n.querySelectorAll(SVG_SHAPES)) {
                if (typeof s.getTotalLength !== 'function') continue;
                if (s.closest(SVG_SKIP) || s.closest('.blob-bg-svg')) continue;
                shapes.push(s);
            }
        }
        return shapes.slice(0, SVG_MAX_SHAPES);
    }

    function svgShapeClosed(shape) {
        const tag = shape.tagName.toLowerCase();
        if (tag === 'polygon' || tag === 'circle' || tag === 'ellipse' || tag === 'rect') return true;
        return tag === 'path' && /z\s*$/i.test(shape.getAttribute('d') || '');
    }

    /** Outermost <svg> of a shape. */
    function svgRootOf(shape) {
        let svg = shape.ownerSVGElement;
        while (svg && svg.ownerSVGElement) svg = svg.ownerSVGElement;
        return svg;
    }

    /** Rendered shape → polyline 'M x,y L …' in container coordinates (null if not rendered). */
    function svgShapeToD(shape, el) {
        const ctm = shape.getScreenCTM && shape.getScreenCTM();
        if (!ctm) return null;
        let len;
        try { len = shape.getTotalLength(); } catch (err) { return null; }
        if (!(len > 0)) return null;

        const rect = el.getBoundingClientRect();
        const ox = rect.left + el.clientLeft - el.scrollLeft;
        const oy = rect.top + el.clientTop - el.scrollTop;
        const zoom = Math.sqrt(Math.abs(ctm.a * ctm.d - ctm.b * ctm.c)) || 1;
        const n = Math.max(2, Math.min(SVG_MAX_SAMPLES, Math.ceil(len * zoom / SVG_SAMPLE_PX)));

        const root = shape.ownerSVGElement;
        const pt = root.createSVGPoint();
        const parts = [];
        for (let i = 0; i <= n; i++) {
            const p = shape.getPointAtLength((i / n) * len);
            pt.x = p.x;
            pt.y = p.y;
            const s = pt.matrixTransform(ctm);
            parts.push((s.x - ox).toFixed(1) + ',' + (s.y - oy).toFixed(1));
        }
        return 'M' + parts.join(' L') + (svgShapeClosed(shape) ? ' Z' : '');
    }

    /**
     * Remember a source SVG so destroy() can restore it: hide it (opacity keeps
     * the layout, so it can be measured again) and mark it — plus wrappers that
     * contain nothing else — with data-blob-ignore so avoidContent skips it.
     */
    function adoptSvgSource(el, svg, hide) {
        const list = el._blobSvgSources || (el._blobSvgSources = []);
        let rec = list.find(r => r.svg === svg);
        if (!rec) {
            rec = { svg, opacity: svg.style.opacity, marked: [] };
            list.push(rec);
            let node = svg;
            while (node && node !== el) {
                if (!node.hasAttribute('data-blob-ignore')) {
                    node.setAttribute('data-blob-ignore', '');
                    rec.marked.push(node);
                }
                const parent = node.parentElement;
                if (!parent || parent === el || parent.children.length !== 1) break;
                node = parent;
            }
        }
        if (hide === false) {
            svg.style.opacity = rec.opacity;
        } else {
            svg.style.opacity = String(typeof hide === 'number' ? clamp(hide, 0, 1) : 0);
        }
    }

    function releaseSvgSources(el) {
        for (const rec of el._blobSvgSources || []) {
            rec.svg.style.opacity = rec.opacity;
            rec.marked.forEach(n => n.removeAttribute('data-blob-ignore'));
        }
        delete el._blobSvgSources;
    }

    /** Expand `svg` path configs into one `d` config per rendered shape. */
    function expandSvgPaths(el, list) {
        if (!list || !list.length) return list || [];
        const out = [];
        for (const raw of list) {
            if (!raw || raw.svg == null) {
                out.push(raw);
                continue;
            }
            for (const shape of resolveSvgShapes(raw.svg, el)) {
                const d = svgShapeToD(shape, el);
                if (!d) continue;
                const cfg = Object.assign({}, raw, { d });
                delete cfg.svg;
                delete cfg.hideSvg;
                if (!/Z$/.test(d)) delete cfg.avoidFill; // only closed shapes have an inside
                out.push(cfg);
                const root = svgRootOf(shape);
                if (root) adoptSvgSource(el, root, raw.hideSvg != null ? raw.hideSvg : PATH_DEFAULTS.hideSvg);
            }
        }
        return out;
    }

    /**
     * Place blobs along SVG paths (brush).
     * Returns { placed, holes } — holes are avoidFill testers for background packing.
     */
    function packPathBlobs(pathConfigs, W, H, opts) {
        const placed = [];
        const holes = [];
        if (!pathConfigs || pathConfigs.length === 0) return { placed, holes };

        const tmpSvg = getTmpSvg();

        try {
            const jobs = [];
            const holeShapes = [];
            let gridMaxR = MIN_BLOB_R;
            let gridGap = 0;

            for (let pi = 0; pi < pathConfigs.length; pi++) {
                const cfg = Object.assign({}, PATH_DEFAULTS, pathConfigs[pi]);
                if (!cfg.d) continue;

                const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                pathEl.setAttribute('d', cfg.d);
                tmpSvg.appendChild(pathEl);

                const totalLen = pathEl.getTotalLength();
                if (totalLen < 1) {
                    tmpSvg.removeChild(pathEl);
                    continue;
                }

                const geom = pathBrushGeom(cfg, opts);
                const pts = samplePathPolyline(pathEl, totalLen);
                tmpSvg.removeChild(pathEl);

                gridMaxR = Math.max(gridMaxR, geom.maxR);
                gridGap = Math.max(gridGap, geom.spacing);
                if (cfg.avoidFill && isFillableHole(pts)) holeShapes.push({ d: cfg.d, pts });
                jobs.push({ pi, cfg, pts, geom });
            }

            // One shared mask/distance field for every avoidFill interior
            const holeField = buildHoleField(holeShapes, W, H);
            if (holeField) holes.push(holeField);

            const cellSize = Math.max(8, gridMaxR * 2 + gridGap);
            const cols = Math.ceil(Math.max(W, 1) / cellSize) || 1;
            const rows = Math.ceil(Math.max(H, 1) / cellSize) || 1;
            const grid = new Array(cols * rows);
            for (let i = grid.length; i--;) grid[i] = [];

            function gridInsert(blob) {
                const reach = blob.r + gridMaxR + gridGap;
                const cMin = clamp(((blob.cx - reach) / cellSize) | 0, 0, cols - 1);
                const cMax = clamp(((blob.cx + reach) / cellSize) | 0, 0, cols - 1);
                const rMin = clamp(((blob.cy - reach) / cellSize) | 0, 0, rows - 1);
                const rMax = clamp(((blob.cy + reach) / cellSize) | 0, 0, rows - 1);
                for (let row = rMin; row <= rMax; row++) {
                    for (let col = cMin; col <= cMax; col++) {
                        grid[row * cols + col].push(blob);
                    }
                }
            }

            function collides(cx, cy, r, spacing) {
                const reach = r + gridMaxR + Math.max(spacing, gridGap);
                const cMin = clamp(((cx - reach) / cellSize) | 0, 0, cols - 1);
                const cMax = clamp(((cx + reach) / cellSize) | 0, 0, cols - 1);
                const rMin = clamp(((cy - reach) / cellSize) | 0, 0, rows - 1);
                const rMax = clamp(((cy + reach) / cellSize) | 0, 0, rows - 1);
                for (let row = rMin; row <= rMax; row++) {
                    for (let col = cMin; col <= cMax; col++) {
                        const cell = grid[row * cols + col];
                        for (let i = cell.length; i--;) {
                            const p = cell[i];
                            const dx = cx - p.cx, dy = cy - p.cy;
                            const minDist = r + p.r + spacing;
                            if (dx * dx + dy * dy < minDist * minDist) return true;
                        }
                    }
                }
                return false;
            }

            // With clip: false the brush may follow a path past the container edges
            const unclipped = opts.clip === false;
            function inBounds(cx, cy) {
                return unclipped || (cx >= 0 && cx <= W && cy >= 0 && cy <= H);
            }

            for (let j = 0; j < jobs.length; j++) {
                const { pi, cfg, pts, geom } = jobs[j];
                // avoidFill paths keep their offset jitter out of every hole
                const avoid = cfg.avoidFill ? holeField : null;
                const { minR, maxR, spacing } = geom;
                const offset = Math.max(0, cfg.offset);
                const jitterTries = offset > 0 ? 10 : 1;

                let i = 0;
                let currentR = randRange(minR, maxR);

                while (i >= 0 && i < pts.length) {
                    const r = currentR;
                    const p = pts[i];
                    const { nx, ny } = polylineNormal(pts, i);

                    let blob = null;
                    if (r >= MIN_BLOB_R) {
                        for (let t = 0; t < jitterTries; t++) {
                            const useOffset = offset > 0 && t < jitterTries - 1;
                            const o = useOffset ? rand(-offset, offset) : 0;
                            const cx = p.x + nx * o;
                            const cy = p.y + ny * o;
                            if (!inBounds(cx, cy)) continue;
                            if (useOffset && avoid && avoid.containsPoint(cx, cy)) continue;
                            if (collides(cx, cy, r, spacing)) continue;
                            blob = {
                                cx, cy, r,
                                _pathIdx: pi,
                                _colorIndices: cfg.colorIndices,
                                _palette: cfg.palette,
                            };
                            break;
                        }
                    }

                    const nextR = randRange(minR, maxR);

                    if (blob) {
                        placed.push(blob);
                        gridInsert(blob);
                        i = nextIndexAtSeparation(pts, i, p.x, p.y, r + nextR + spacing);
                        currentR = nextR;
                    } else {
                        // Tight curve, clip, or self-intersection: nudge along the
                        // polyline instead of skipping a whole disk-width of path.
                        i += 1;
                        currentR = nextR;
                    }
                }
            }
        } finally {
            // Clear children but leave singleton in DOM for reuse
            while (tmpSvg.firstChild) tmpSvg.removeChild(tmpSvg.firstChild);
        }

        return { placed, holes };
    }

    // ─── Circle Packing ─────────────────────────────

    function packBlobs(W, H, opts, shapeTest, zones, prePlaced, holes) {
        const placed = [];

        // Neighbour search must cover path blobs that can exceed opts.maxRadius
        let maxR = opts.maxRadius;
        if (prePlaced) {
            for (let i = 0; i < prePlaced.length; i++) {
                if (prePlaced[i].r > maxR) maxR = prePlaced[i].r;
            }
        }

        // ── Spatial grid for O(1) average-case collision lookups ──
        const cellSize = Math.max(8, maxR * 2 + opts.gap);
        const cols = Math.ceil(W / cellSize) || 1;
        const rows = Math.ceil(H / cellSize) || 1;
        const grid = new Array(cols * rows);
        for (let i = grid.length; i--;) grid[i] = [];

        function gridInsert(blob) {
            const reach = blob.r + maxR + opts.gap;
            const cMin = clamp(((blob.cx - reach) / cellSize) | 0, 0, cols - 1);
            const cMax = clamp(((blob.cx + reach) / cellSize) | 0, 0, cols - 1);
            const rMin = clamp(((blob.cy - reach) / cellSize) | 0, 0, rows - 1);
            const rMax = clamp(((blob.cy + reach) / cellSize) | 0, 0, rows - 1);
            for (let row = rMin; row <= rMax; row++) {
                for (let col = cMin; col <= cMax; col++) {
                    grid[row * cols + col].push(blob);
                }
            }
        }

        function fits(cx, cy, r) {
            if (r < MIN_BLOB_R) return false;
            // Shape boundary check (with edgeGap)
            if (!shapeTest(cx, cy, r + (opts.edgeGap || 0))) return false;
            // Exclusion zones (circle vs rectangle collision)
            for (const z of zones) {
                const closestX = clamp(cx, z.x, z.x + z.w);
                const closestY = clamp(cy, z.y, z.y + z.h);
                const dx = cx - closestX;
                const dy = cy - closestY;
                if (dx * dx + dy * dy < r * r) return false;
            }
            // Closed path interiors (avoidFill)
            if (holes && holes.length) {
                for (let h = 0; h < holes.length; h++) {
                    if (holes[h].hitsCircle(cx, cy, r)) return false;
                }
            }
            // Blob-vs-blob: only check nearby cells
            const reach = r + maxR + opts.gap;
            const cMin = clamp(((cx - reach) / cellSize) | 0, 0, cols - 1);
            const cMax = clamp(((cx + reach) / cellSize) | 0, 0, cols - 1);
            const rMin = clamp(((cy - reach) / cellSize) | 0, 0, rows - 1);
            const rMax = clamp(((cy + reach) / cellSize) | 0, 0, rows - 1);
            for (let row = rMin; row <= rMax; row++) {
                for (let col = cMin; col <= cMax; col++) {
                    const cell = grid[row * cols + col];
                    for (let i = cell.length; i--;) {
                        const p = cell[i];
                        const dx = cx - p.cx, dy = cy - p.cy;
                        const minDist = r + p.r + opts.gap;
                        if (dx * dx + dy * dy < minDist * minDist) return false;
                    }
                }
            }
            return true;
        }

        function tryPlace(r, attempts, stopOnFirst) {
            if (r < MIN_BLOB_R || W < 2 * r || H < 2 * r) return;
            for (let attempt = 0; attempt < attempts; attempt++) {
                const cx = randRange(r, W - r);
                const cy = randRange(r, H - r);
                if (fits(cx, cy, r)) {
                    const blob = { cx, cy, r };
                    placed.push(blob);
                    gridInsert(blob);
                    if (stopOnFirst) return;
                }
            }
        }

        // Seed grid with pre-placed blobs (e.g. from paths) so fill avoids them
        if (prePlaced) {
            for (let i = 0; i < prePlaced.length; i++) {
                placed.push(prePlaced[i]);
                gridInsert(prePlaced[i]);
            }
        }

        // Scale candidate count to element area
        const area = W * H;
        const largeCandidateCount = Math.max(100, Math.round(area / 800));
        const smallAttempts = Math.max(500, Math.round(area / 50));

        // Phase 1: large blobs (sorted biggest-first)
        // Prefer the historical [max(min+6, 10), maxRadius] band; if that range
        // is empty (tiny maxRadius), fall back to [minRadius, maxRadius].
        let largeLo = Math.max(opts.minRadius + 6, 10);
        if (largeLo >= opts.maxRadius) largeLo = opts.minRadius;
        largeLo = Math.max(largeLo, MIN_BLOB_R);
        if (largeLo <= opts.maxRadius) {
            const largeCandidates = [];
            for (let i = 0; i < largeCandidateCount; i++) {
                largeCandidates.push(randRange(largeLo, opts.maxRadius));
            }
            largeCandidates.sort((a, b) => b - a);
            for (const r of largeCandidates) tryPlace(r, 80, true);
        }

        // Phase 2: small gap-fillers (skip when the band is inverted / empty)
        const smallHi = Math.min(8, opts.maxRadius * 0.4);
        const smallLo = Math.max(opts.minRadius, MIN_BLOB_R);
        if (smallLo < smallHi) {
            for (let attempt = 0; attempt < smallAttempts; attempt++) {
                tryPlace(randRange(smallLo, smallHi), 1, true);
            }
        }

        return placed;
    }

    // ─── Resolve palette ────────────────────────────────

    function pickSessionPalette() {
        sessionPalette = normalizePalette(
            DEFAULT_PALETTES[Math.floor(Math.random() * DEFAULT_PALETTES.length)]);
        injectPaletteCSS();
        return sessionPalette;
    }

    /**
     * Inject CSS custom properties and utility classes for the active palette.
     * Variables set on :root:
     *   --bl-bg              palette background color
     *   --bl-col-1 … N       ring colors as HSL
     *   --bl-accent-1 … 3    accent colors as HSL (not used in blobs)
     * Utility classes generated:
     *   .bl-bg               background-color: var(--bl-bg)
     *   .bl-col-N            color: var(--bl-col-N)
     *   .bl-bg-N             background-color: var(--bl-col-N)
     *   .bl-border-N         border-color: var(--bl-col-N)
     *   .bl-fill-N           fill: var(--bl-col-N)   (SVG)
     *   .bl-stroke-N         stroke: var(--bl-col-N) (SVG)
     *   .bl-accent-N         color: var(--bl-accent-N)
     *   .bl-bg-accent-N      background-color: var(--bl-accent-N)
     *   .bl-border-accent-N  border-color: var(--bl-accent-N)
     *   .bl-fill-accent-N    fill: var(--bl-accent-N)   (SVG)
     *   .bl-stroke-accent-N  stroke: var(--bl-accent-N) (SVG)
     */
    function injectPaletteCSS() {
        if (!sessionPalette) return;

        // Set CSS custom properties on :root
        const root = document.documentElement;
        root.style.setProperty('--bl-bg', sessionPalette.bg);
        const rings = sessionPalette.rings;
        for (let i = 0; i < rings.length; i++) {
            root.style.setProperty('--bl-col-' + (i + 1), colorToCss(rings[i]));
        }
        // Clear any leftover variables from a palette with more colors
        for (let i = rings.length; i < 6; i++) {
            root.style.removeProperty('--bl-col-' + (i + 1));
        }

        // Set accent color CSS custom properties
        const accents = sessionPalette.accents || [];
        for (let i = 0; i < accents.length; i++) {
            root.style.setProperty('--bl-accent-' + (i + 1), colorToCss(accents[i]));
        }
        // Clear any leftover accent variables
        for (let i = accents.length; i < 3; i++) {
            root.style.removeProperty('--bl-accent-' + (i + 1));
        }

        // Inject / update <style> block with utility classes
        let styleEl = document.getElementById('bl-palette-styles');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'bl-palette-styles';
            document.head.appendChild(styleEl);
        }

        let css = '.bl-bg{background-color:var(--bl-bg)}';
        for (let i = 1; i <= rings.length; i++) {
            const v = `var(--bl-col-${i})`;
            css += `.bl-col-${i}{color:${v}}`;
            css += `.bl-bg-${i}{background-color:${v}}`;
            css += `.bl-border-${i}{border-color:${v}}`;
            css += `.bl-fill-${i}{fill:${v}}`;
            css += `.bl-stroke-${i}{stroke:${v}}`;
        }
        // Accent color utility classes
        for (let i = 1; i <= accents.length; i++) {
            const v = `var(--bl-accent-${i})`;
            css += `.bl-accent-${i}{color:${v}}`;
            css += `.bl-bg-accent-${i}{background-color:${v}}`;
            css += `.bl-border-accent-${i}{border-color:${v}}`;
            css += `.bl-fill-accent-${i}{fill:${v}}`;
            css += `.bl-stroke-accent-${i}{stroke:${v}}`;
        }
        styleEl.textContent = css;
    }

    /**
     * destroy() removes the utility <style> when the last instance goes away,
     * but the session palette survives. Re-inject it on the next generate so
     * .bl-* classes keep working after a destroy-all → init cycle.
     */
    function ensurePaletteCSS() {
        if (sessionPalette && !document.getElementById('bl-palette-styles')) {
            injectPaletteCSS();
        }
    }

    /** Name / index / object → raw palette object (not yet normalised). */
    function lookupPalette(paletteOpt) {
        if (typeof paletteOpt === 'number') {
            const n = DEFAULT_PALETTES.length;
            return DEFAULT_PALETTES[((Math.floor(paletteOpt) % n) + n) % n];
        }
        if (typeof paletteOpt === 'string') {
            const found = DEFAULT_PALETTES.find(p => p.name === paletteOpt);
            return found || DEFAULT_PALETTES[0];
        }
        // Assume it's a palette object { bg, rings, accents? }
        if (paletteOpt && Array.isArray(paletteOpt.rings) && paletteOpt.rings.length) return paletteOpt;
        return DEFAULT_PALETTES[0];
    }

    function resolvePalette(paletteOpt) {
        if (paletteOpt == null) {
            // Use session palette (shared by all elements)
            if (!sessionPalette) pickSessionPalette();
            return sessionPalette;
        }
        return normalizePalette(lookupPalette(paletteOpt));
    }

    // ─── Generate for a single element ──────────────────

    // ─── Parameter sanitisation ────────────────────────

    function sanitizeOpts(opts) {
        opts.minRadius  = Math.max(0, opts.minRadius);
        opts.maxRadius  = Math.max(opts.minRadius, opts.maxRadius);
        opts.gap        = Math.max(0, opts.gap);
        opts.edgeGap    = Math.max(0, opts.edgeGap);
        opts.points     = Math.max(3, Math.round(opts.points));
        opts.wobble     = Math.max(0, opts.wobble);

        opts.avoidPadding = Math.max(0, opts.avoidPadding);
        opts.fadeDuration = Math.max(0.05, opts.fadeDuration);
        opts.fadeMaxDelay = Math.max(0, opts.fadeMaxDelay);
        const cv = Number(opts.colorVariation);
        opts.colorVariation = isFinite(cv) ? Math.max(0, cv) : DEFAULTS.colorVariation;
        return opts;
    }

    function generate(el, opts, animate) {
        // Use scroll dimensions when the element is scrollable (content larger than viewport)
        const W = Math.max(el.clientWidth, el.scrollWidth);
        const H = Math.max(el.clientHeight, el.scrollHeight);
        if (W === 0 || H === 0) return;

        // Ensure relative positioning for SVG overlay
        const pos = getComputedStyle(el).position;
        if (pos === 'static') {
            if (el._blobOrigPosition === undefined) {
                el._blobOrigPosition = el.style.position || '';
            }
            el.style.position = 'relative';
        }
        // Clip blobs to container — only override if overflow is 'visible' (the default).
        // auto, scroll, hidden, and clip all clip content already, so leave them untouched.
        // Save only on the first generate: later passes (resize, regenerate) would
        // otherwise record our own 'hidden' as the "original" value.
        // clip: false keeps the container's overflow, so blobs may spill past its edges.
        if (opts.clip !== false) {
            if (el._blobOrigOverflow === undefined) {
                el._blobOrigOverflow = el.style.overflow || '';
            }
            const curOverflow = getComputedStyle(el).overflow;
            if (curOverflow === 'visible') {
                el.style.overflow = 'hidden';
            }
        }

        // Clean previous
        const old = el.querySelector('.blob-bg-svg');
        if (old) old.remove();

        // Pick palette
        const palette = resolvePalette(opts.palette);
        ensurePaletteCSS();
        // paintBackground: false leaves the container background untouched
        // (e.g. a decorative path placed over page content)
        if (opts.paintBackground !== false) {
            if (el._blobOrigBackground === undefined) {
                el._blobOrigBackground = el.style.backgroundColor || '';
            }
            el.style.backgroundColor = palette.bg;
        }

        // Create SVG
        const id = el.dataset.blobId || ('blob-' + (++uid));
        el.dataset.blobId = id;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('blob-bg-svg');
        svg.setAttribute('aria-hidden', 'true');   // decorative only
        svg.setAttribute('focusable', 'false');
        svg.setAttribute('width', W);
        svg.setAttribute('height', H);
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:0;' +
            (opts.clip === false ? 'overflow:visible;' : '');

        // Paths given as page SVG (`svg`) become `d` polylines in this container.
        // Must run before the exclusion zones: it marks the source SVG with
        // data-blob-ignore, otherwise its shapes would be avoided as content
        // (a wide empty band around the path instead of blobs along it).
        const paths = expandSvgPaths(el, opts.paths);

        // Detect exclusion zones from child content
        const zones = opts.avoidContent ? getExclusionZones(el, W, H, opts.avoidPadding) : [];

        // Pack path blobs first (they have priority)
        const pathPack = packPathBlobs(paths, W, H, opts);
        const pathBlobs = pathPack.placed;
        const pathHoles = pathPack.holes;

        // Pack fill blobs with shape-aware boundary detection
        // Path blobs are pre-placed so fill blobs avoid them
        const shapeTest = createShapeTest(el, W, H);
        const blobs = (opts.fillBackground !== false && opts.maxRadius > 0) 
            ? packBlobs(W, H, opts, shapeTest, zones, pathBlobs, pathHoles) 
            : pathBlobs;

        // Batch blob <g> elements into a DocumentFragment to minimise reflows
        const frag = document.createDocumentFragment();
        for (const blob of blobs) {
            const { cx, cy, r } = blob;
            if (r < MIN_BLOB_R) continue;

            const blobPalette = blob._palette != null
                ? resolvePalette(blob._palette)
                : palette;
            const maxColors = blobPalette.rings.length;
            if (!maxColors) continue;

            // Ring count by size tier
            const isLarge = r >= 12;
            const roll = Math.random();
            let numRings;
            if (isLarge) {
                numRings = roll < 0.625
                    ? randInt(Math.max(maxColors - 1, 2), maxColors)
                    : Math.min(4, maxColors);
            } else {
                numRings = roll < 0.6
                    ? Math.min(4, maxColors)
                    : randInt(2, Math.min(3, maxColors));
            }

            // Per-blob colour jitter: rand(cv/2, cv). Default 10 keeps the
            // historical rand(5, 10); 0 renders exact palette colours.
            const cv = opts.colorVariation;
            const colorVar = cv > 0 ? rand(cv * 0.5, cv) : 0;
            const sx = rand(0.88, 1.12);
            const sy = 2 - sx;
            const rot = rand(0, 360);

            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            // Marks brush blobs so tools (e.g. SVG export) can tell them from fill
            if (blob._pathIdx != null) g.setAttribute('data-path', blob._pathIdx);
            g.setAttribute('transform',
                `translate(${cx.toFixed(1)},${cy.toFixed(1)}) ` +
                `rotate(${rot.toFixed(0)}) ` +
                `scale(${sx.toFixed(3)},${sy.toFixed(3)}) ` +
                `translate(${(-cx).toFixed(1)},${(-cy).toFixed(1)})`
            );

            let driftX = 0, driftY = 0;

            for (let ring = 0; ring < numRings; ring++) {
                const t = ring / Math.max(1, numRings - 1);
                const ringR = r * (1 - t * 0.72);

                driftX += rand(-r * 0.015, r * 0.015);
                driftY += rand(-r * 0.015, r * 0.015);

                const blobWobble = blob._pathIdx != null
                    ? (paths[blob._pathIdx] && paths[blob._pathIdx].wobble != null
                        ? paths[blob._pathIdx].wobble : opts.wobble)
                    : opts.wobble;
                const blobPoints = blob._pathIdx != null
                    ? (paths[blob._pathIdx] && paths[blob._pathIdx].points != null
                        ? paths[blob._pathIdx].points : opts.points)
                    : opts.points;

                const ringWobble = blobWobble * (1 - t * 0.3) * rand(0.8, 1.2);
                const ringPts = blobPoints + randInt(-1, 1);
                const pathD = blobPath(cx + driftX, cy + driftY, ringR, ringPts, ringWobble);

                // Color selection: respect _colorIndices for path blobs
                let colorIdx;
                if (blob._colorIndices && blob._colorIndices.length > 0) {
                    colorIdx = blob._colorIndices[ring % blob._colorIndices.length];
                } else {
                    colorIdx = Math.min(ring, maxColors - 1);
                }
                const fill = varyColor(blobPalette.rings[colorIdx % maxColors], colorVar);

                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', pathD);
                path.setAttribute('fill', fill);
                g.appendChild(path);
            }

            frag.appendChild(g);
        }
        svg.appendChild(frag);

        // Apply fade-in animation to each blob group
        if (animate && opts.fadeIn) {
            injectFadeKeyframes();
            const groups = svg.querySelectorAll(':scope > g');
            groups.forEach(function (g) {
                const delay = Math.random() * opts.fadeMaxDelay;
                g.style.opacity = '0';
                g.style.animation =
                    'bl-fadein ' + opts.fadeDuration + 's ease ' + delay.toFixed(2) + 's forwards';
                // Lock opacity after animation ends — prevents browser
                // from restarting the CSS animation on elements that
                // scroll out of the viewport and back in.
                g.addEventListener('animationend', function handler() {
                    g.style.animation = 'none';
                    g.style.opacity = '1';
                    g.removeEventListener('animationend', handler);
                });
            });
        }

        // Render debug paths if requested
        if (opts.debugPaths && paths.length) {
            for (let pi = 0; pi < paths.length; pi++) {
                const cfg = Object.assign({}, PATH_DEFAULTS, paths[pi]);
                if (cfg.d) {
                    const { maxR } = pathBrushGeom(cfg, opts);
                    const totalWidth = (maxR + cfg.offset) * 2;

                    if (cfg.avoidFill) {
                        const dpHole = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                        dpHole.setAttribute('d', cfg.d);
                        dpHole.setAttribute('fill', 'rgba(255, 0, 0, 0.08)');
                        dpHole.setAttribute('stroke', 'none');
                        svg.appendChild(dpHole);
                    }

                    const dpOuter = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    dpOuter.setAttribute('d', cfg.d);
                    dpOuter.setAttribute('fill', 'none');
                    dpOuter.setAttribute('stroke', 'rgba(255, 0, 0, 0.15)');
                    dpOuter.setAttribute('stroke-width', totalWidth);
                    svg.appendChild(dpOuter);

                    const dp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    dp.setAttribute('d', cfg.d);
                    dp.setAttribute('fill', 'none');
                    dp.setAttribute('stroke', 'rgba(255, 0, 0, 0.7)');
                    dp.setAttribute('stroke-width', '2');
                    dp.setAttribute('stroke-dasharray', '6,4');
                    svg.appendChild(dp);
                }
            }
        }

        // Insert SVG as first child so content stays on top
        el.insertBefore(svg, el.firstChild);
    }

    // ─── Public API ─────────────────────────────────────

    function init(target, options) {
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        if (!el) { console.warn('BlobBackground: target not found', target); return; }

        // FIX #1: Clean up previous instance to prevent listener leaks
        if (instances.has(el)) {
            destroy(el);
        }

        const opts = sanitizeOpts(Object.assign({}, DEFAULTS, options || {}));
        instances.set(el, opts);
        generate(el, opts, true);

        if (opts.autoResize) {
            // A debounced resize may fire after destroy() or a re-init; only
            // regenerate if this exact instance is still the live one.
            const regenIfCurrent = () => {
                if (instances.get(el) === opts) generate(el, opts, false);
            };
            // Prefer ResizeObserver (watches container itself, catches flex/grid/content
            // changes), fall back to window.resize for legacy browsers.
            if (typeof ResizeObserver !== 'undefined') {
                let timer;
                let lastW = el.clientWidth;
                let lastH = el.clientHeight;
                const ro = new ResizeObserver(() => {
                    const curW = el.clientWidth;
                    const curH = el.clientHeight;
                    if (curW === lastW && curH === lastH) return;
                    lastW = curW;
                    lastH = curH;
                    clearTimeout(timer);
                    timer = setTimeout(regenIfCurrent, 250);
                });
                ro.observe(el);
                el._blobResizeObserver = ro;
            } else {
                let timer;
                let lastW = el.clientWidth;
                const handler = () => {
                    const curW = el.clientWidth;
                    if (curW === lastW) return;
                    lastW = curW;
                    clearTimeout(timer);
                    timer = setTimeout(regenIfCurrent, 250);
                };
                el._blobResizeHandler = handler;
                window.addEventListener('resize', handler);
            }
        }

        return el;
    }

    function initAll(selector, options) {
        const els = document.querySelectorAll(selector);
        els.forEach(el => init(el, options));
        return els;
    }

    function regenerate(target) {
        // FIX #2: only pick a new session palette if none of the target elements
        // have an explicit palette set (avoids overriding CSS vars unexpectedly)
        if (!sessionPalette) pickSessionPalette();

        if (target) {
            const el = typeof target === 'string' ? document.querySelector(target) : target;
            const opts = instances.get(el) || DEFAULTS;
            generate(el, opts, true);
        } else {
            instances.forEach((opts, el) => generate(el, opts, true));
        }
    }

    function destroy(target) {
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        if (!el) return;
        const svg = el.querySelector('.blob-bg-svg');
        if (svg) svg.remove();
        // Clean up resize listener (ResizeObserver or legacy window handler)
        if (el._blobResizeObserver) {
            el._blobResizeObserver.disconnect();
            delete el._blobResizeObserver;
        }
        if (el._blobResizeHandler) {
            window.removeEventListener('resize', el._blobResizeHandler);
            delete el._blobResizeHandler;
        }
        // FIX #3: Restore original overflow
        if (el._blobOrigOverflow !== undefined) {
            el.style.overflow = el._blobOrigOverflow;
            delete el._blobOrigOverflow;
        }
        // Restore original position
        if (el._blobOrigPosition !== undefined) {
            el.style.position = el._blobOrigPosition;
            delete el._blobOrigPosition;
        }
        // Restore original inline background-color (overwritten with palette.bg)
        if (el._blobOrigBackground !== undefined) {
            el.style.backgroundColor = el._blobOrigBackground;
            delete el._blobOrigBackground;
        }
        releaseSvgSources(el);
        instances.delete(el);

        // FIX #6: Clean up injected styles when no instances remain
        if (instances.size === 0) {
            const fadeStyle = document.getElementById('bl-fadein-keyframes');
            if (fadeStyle) { fadeStyle.remove(); fadeKeyframesInjected = false; }
            const palStyle = document.getElementById('bl-palette-styles');
            if (palStyle) palStyle.remove();
        }
    }

    /**
     * Set the session palette explicitly instead of picking a random one.
     * Accepts a name, an index or an object { name?, bg, rings[], accents? }
     * whose colours are HEX strings or { h, s, l }. Updates CSS variables and
     * utility classes, then redraws every instance that has no own palette.
     */
    function setSessionPalette(paletteOpt) {
        if (paletteOpt == null) return sessionPalette;
        sessionPalette = normalizePalette(lookupPalette(paletteOpt));
        injectPaletteCSS();
        instances.forEach((opts, el) => {
            if (opts.palette == null) generate(el, opts, true);
        });
        return sessionPalette;
    }

    return {
        init: init,
        initAll: initAll,
        regenerate: regenerate,
        destroy: destroy,
        setSessionPalette: setSessionPalette,
        palettes: DEFAULT_PALETTES,
        /** Get the current session palette object { name, bg, rings[] } */
        getSessionPalette: function () {
            if (!sessionPalette) pickSessionPalette();
            return sessionPalette;
        },
        /** CSS colour of ring N (1-based): HEX if the palette was given in HEX, else HSL. '' if out of range. */
        getColor: function (n) {
            if (!sessionPalette) pickSessionPalette();
            const ring = sessionPalette.rings[n - 1];
            return ring ? colorToCss(ring) : '';
        },
        /** Get HSL string for accent N (1-based, max 3). Returns empty string if N exceeds accents. */
        getAccent: function (n) {
            if (!sessionPalette) pickSessionPalette();
            const accents = sessionPalette.accents || [];
            const a = accents[n - 1];
            return a ? colorToCss(a) : '';
        },
    };

})();

export { BlobBackground };
