# Render Worker API (`cloudflare/`)

Universal renderer for the 64×16 BK-Light panel. Every other feature (transit departures, clock, notifications…) sends
a scene description here and gets back a finished **PNG** or **GIF** that the panel accepts as-is
(see [PROTOCOL.md](PROTOCOL.md)).

Base URL: your own Worker, e.g. `https://act1033-led.<your-subdomain>.workers.dev` (see [../cloudflare/README.md](../cloudflare/README.md)).
CORS is limited to the pages listed in the `ALLOWED_ORIGIN` variable (any page when unset, see [../cloudflare/README.md](../cloudflare/README.md)). **Every endpoint except `/health` and `/` needs a token**: `Authorization: Bearer <token>`.

| Token | Who holds it | Allowed |
|---|---|---|
| admin (`ADMIN_TOKEN`, a Worker secret) | the Worker's owner | everything, incl. creating panels |
| panel write token (`w_…`) | the control page | upload to its panel, `/render` |
| panel read token (`r_…`) | the ESP32 | download from its panel, `/render` |

Tokens are random 256-bit values; only their SHA-256 hashes are stored (in D1). A leaked read token cannot overwrite the panel.

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

## Panel API (images stored in D1)

| Request | Token | Result |
|---|---|---|
| `POST /admin/panels` `{"id":"kitchen","name":"Kitchen"}` | admin | `201` with `write_token` and `read_token` (shown once) |
| `GET /admin/panels` | admin | list (no hashes) |
| `POST /admin/panels/:id/rotate` `{"which":"write"\|"read"\|"both"}` | admin | new token(s); old ones stop working |
| `DELETE /admin/panels/:id` | admin | removes the panel and its image |
| `PUT /panel/:id` (body = GIF or PNG, ≤ 64 KB) | write / admin | `{ok, changed, etag, size}`; an identical upload is not written again |
| `GET /panel/:id/image` | read / write / admin | the image with an `ETag`; `If-None-Match` → `304` |
| `GET /panel/:id` | any panel token | metadata (`has_image`, `etag`, `size`, `updated_at`) |

`id` is 1–32 characters `[a-z0-9-]`. One ESP32 reads one panel; the control page writes to it.

**Faster updates without a persistent connection.** Every `GET /panel/:id/image` answer (200 and 304) carries `X-Poll-After: <seconds>`:
`3` while the panel changed within the last 180 s (more edits are likely), `30` otherwise. The ESP simply obeys it, so the polling
policy lives in the Worker and can be tuned without re-flashing. Optional Worker variables: `POLL_BURST_S` (default 3),
`POLL_IDLE_S` (30), `BURST_WINDOW_S` (180). A `304` costs no D1 write.

## Departures job (runs on the Worker, no browser needed)

A cron trigger (`* * * * *`, every minute) looks after every panel that has the job enabled. It asks the transit API (`TRANSIT_URL`, default the public
API from [API_GUIDE.md](API_GUIDE.md)) for the next departures of a stop and renders two lines of 5×7 text: the line number on the left, the remaining
time on the right, one line per departure (the second tram goes to the second row). A failed transit call keeps the last picture.

**Mode `seconds` (default)** - `13   3m 10s`. The panel plays a GIF by itself, so the countdown needs no upload every minute (every upload makes the panel flash for ~2 s):
- One GIF has **50 frames of 10 s** (500 s). Frame *k* shows the next two departures as they will be *k × 10 s* later; when a tram has left, the next one moves up.
- Frame 0 is the moment the picture is expected to appear on the panel (`MPK_LEAD_S`, 8 s after generation, covering the fast pickup and the BLE upload), aligned to 10 s so timetable rows count `3m 10s`, `3m 00s`, `2m 50s` ….
- The GIF is **replaced every 5 minutes** (`MPK_REFRESH_S`) - well before its 500 s end, so it never loops back - or earlier when live data moved: a timetable row by more than 20 s,
  a live vehicle estimate (which the API gives only to the minute) by more than 90 s, a different line first, or a tram that vanished.
- Timetable rows are exact (HH:MM, Warsaw time). Live vehicles only have rounded minutes, so their seconds are an estimate.
- An automatic replacement gives the ESP a short fast-poll window (`FRESH_WINDOW_S`, 20 s) so the new GIF reaches the panel within seconds.

**Mode `minutes`** - the older static picture `13   12 min`, rewritten whenever the minutes change.

| Request | Token | Result |
|---|---|---|
| `PUT /panel/:id/mpk` `{"stop":"12020","lines":"13,23","dir":"Stadion Olimpijski","color":"#ffb000","mode":"seconds"}` | write / admin | validates, renders immediately, enables the job; answers with `stop_name` and `rows` |
| `GET /panel/:id/mpk` | any panel token | `{enabled, config}` |
| `DELETE /panel/:id/mpk` | write / admin | disables the job (the configuration is kept) |

`stop` is a stop code (letters and digits); `lines` and `dir` are optional filters; `mode` is `seconds` (default) or `minutes`.
Optional Worker variables: `MPK_FRAMES` (50), `MPK_STEP_S` (10), `MPK_REFRESH_S` (300), `MPK_LEAD_S` (8), `FRESH_WINDOW_S` (20).
**A manual upload (`PUT /panel/:id`) switches the job off** so the person's picture stays; automatic updates never trigger the 3-minute burst polling
(`X-Poll-After` follows manual changes, plus a 20 s window after an automatic replacement).

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
