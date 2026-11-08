# Render Worker API (`cloudflare/`)

Universal renderer for the 64×16 BK-Light panel. Every other feature (transit departures, clock, notifications…) sends
a scene description here and gets back a finished **PNG** or **GIF** that the panel accepts as-is
(see [PROTOCOL.md](PROTOCOL.md)).

Base URL: `https://act1033-led.wowk-digital.workers.dev` · CORS enabled · no authentication (yet).

## `GET /render` – quick text

`/render?text=Hello%20Wrocław&color=00ff00&bg=000000&format=gif&anim=scroll&speed=3`

| Param | Default | Meaning |
|---|---|---|
| `text` | required | up to 500 characters, Polish letters supported |
| `color`, `bg` | `00ff00`, `000000` | `RRGGBB`, `#RRGGBB` or `#RGB` |
| `format` | `png` | `png` or `gif` |
| `scale` | `1` | 1 = 5×7 font with diacritics; 2–4 = integer upscale (diacritics dropped) |
| `anim` | `none` | `scroll` or `blink` (GIF only makes sense) |
| `speed` | `3` | scroll speed 1–5 |
| `align`, `valign` | `center`, `middle` | `left/center/right`, `top/middle/bottom` |
| `w`, `h` | `64`, `16` | canvas size, max 256 |
| `nonce` | `0` | `1` = random bytes after the GIF trailer (see below) |

## `POST /render` – full scene

```json
{
  "width": 64, "height": 16, "format": "gif", "background": "#000000",
  "elements": [
    { "type": "text", "text": "Linia 249 -> Leśnica", "color": "#ffaa00", "anim": "scroll", "speed": 3 },
    { "type": "rect", "x": 0, "y": 0, "w": 64, "h": 1, "color": "#303030" }
  ]
}
```

- Use **`elements`** for one scene (at most one text element may animate: `scroll` or `blink`; the other elements are drawn on every frame), or
- **`frames`**: `[{ "duration": 100, "elements": [...] }, ...]` for hand-made animations (`duration` in ms, min 10).
- `loop` (GIF, 0 = forever), `frame` (PNG: which frame to export, default 0), `nonce` (GIF).

Elements: `text {text,color,scale,x,y,align,valign,anim,speed}`, `rect {x,y,w,h,color,fill}`, `pixel {x,y,color}`,
`line {x1,y1,x2,y2,color}`, `bitmap {rows:["#.#"],x,y,color,scale}`. Text `y` is the top of the text box
(11 rows at scale 1 so accents fit; 16 − 11 → centred at y = 2).

## Response

The image bytes (`image/png` or `image/gif`) plus headers `X-Frames`, `X-Width`, `X-Height`, `X-Size`.
Errors are JSON `{ "error": "…" }` with 400 (bad input), 404 (missing frame), 405, 422 (GIF with more than 16 colours), 500.

## Panel-specific behaviour built in

- **PNG:** 1-bit indexed when the scene has ≤ 2 colours (~230 B for text), otherwise 8-bit RGB – the two variants tested on hardware.
- **GIF:** one global 16-entry colour table, no local tables, LZW min code size 4, looping forever. More than 16 colours → 422.
- A **single-frame GIF** is emitted as two identical frames (the known-good static form).
- **Never upload an identical GIF twice** – use `nonce` so the file differs each time.
- Scroll timing and frame counts match `python/act1033led/render.py` (verified pixel-for-pixel).

## Development

```
cd cloudflare
npm install
npm test            # node --test (Node >= 22.18 strips TypeScript natively)
npm run dev         # wrangler dev
npm run deploy
python tools/gen_font.py   # regenerate src/font.ts after editing python/act1033led/font.py
```
