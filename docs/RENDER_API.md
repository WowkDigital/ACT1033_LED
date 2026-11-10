# Render Worker API (`cloudflare/`)

Universal renderer for the 64×16 BK-Light panel. Every other feature (transit departures, clock, notifications…) sends
a scene description here and gets back a finished **PNG** or **GIF** that the panel accepts as-is
(see [PROTOCOL.md](PROTOCOL.md)).

Base URL: your own Worker, e.g. `https://act1033-led.<your-subdomain>.workers.dev` (see [../cloudflare/README.md](../cloudflare/README.md)).
CORS is limited to the pages listed in the `ALLOWED_ORIGIN` variable (any page when unset, see [../cloudflare/README.md](../cloudflare/README.md)). **Every endpoint except `/health` and `/` needs a token**: `Authorization: Bearer <token>`.

| Token | Who holds it | Allowed |
|---|---|---|
| admin session (`s_…`, from `POST /admin/login` `{"password":…}`, valid 8 h) | the Worker's owner | everything, incl. creating panels |
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

**Mode `seconds` (default)** - `13   3m 10s`, **computed from the timetable** (exact HH:MM, Warsaw time; the API is called with `mode=schedule`).
Live GPS vehicles are deliberately not used here: the API gives them only as rounded minutes estimated from the straight-line distance, with no heading, so on a
platform shared by both directions a tram that just left looks "1 min away" and a countdown to the second would be a guess. The panel plays a GIF by itself, so the
countdown needs no upload every minute (every upload makes the panel flash for ~2 s):
- One GIF has **50 frames of 10 s** (500 s). Frame *k* shows the next two departures as they will be *k × 10 s* later; when a tram has left, the next one moves up
  (the second tram is always in the second row).
- Frame 0 is the moment the picture is expected to appear on the panel (`MPK_LEAD_S`, 8 s after generation, covering the fast pickup and the BLE upload), aligned to 10 s so
  rows count `3m 10s`, `3m 00s`, `2m 50s` ….
- The GIF is **replaced every 5 minutes** (`MPK_REFRESH_S`) - well before its 500 s end, so it never loops back - or earlier when the timetable data changed
  (a departure moved by more than 20 s, a different line first, a departure vanished).
- An automatic replacement gives the ESP a short fast-poll window (`FRESH_WINDOW_S`, 20 s) so the new GIF reaches the panel within seconds.

**Extras of the `seconds` mode** (`cloudflare/src/board.ts`, on by default, each can be switched off):
- **Stop screen** (`info_every` 40, `info_for` 10): every 40 s, for 10 s, the panel shows the stop name and a clock on the first row and the lines on the second,
  in 5×7 capitals, e.g. `RYNEK 21:37` / `131, N`. The window is placed between the whole-minute marks (timetable departures happen on whole minutes), so it
  never hides a departure (with 40 s: at :05-:15, :25-:35, :45-:55 …). When the name and the clock do not fit one row (`POLESKA` + `21:37` = 70 px), the clock
  moves to the right of the second row and the lines get the space left of it; a too long name is cut (set `label` to a short name); lines that do not fit end
  with `+`. The clock is `HH:MM` by default (one frame per screen); `info_seconds: true` shows `HH:MM:SS` (one frame per second, a bigger GIF).
- **Departure animation** (`anim`, `anim_s` default 5 s): when a vehicle leaves, a bus or tram sprite (by line number: 0L, 0P and 1-33 are trams) appears right
  of the line number, stands still for a moment, then drives off to the right, speeding up and pulling the number behind it (40 frames, identical ones merged);
  the other row stays exactly as it was until the animation ends, then both rows move on to the next two departures. With the stop screen every 40 s the 5 s animation ends exactly when the screen starts.
- **Timed at delivery.** The ESP checks only every 30 s when idle, so a GIF made by the cron job would reach the panel 0-30 s later than planned (measured with a
  camera: the panel's clock was 38 s late). When the ESP (read token) downloads a changed image, the Worker rebuilds the GIF from the stored timetable with its
  first frame at *download + `MPK_DELIVERY_LEAD_S`* (default 9 s: download + BLE upload + the panel's switch; measured: the panel then shows the time within about ±1.5 s, the rest is BLE connect jitter), cut to 1/100 s rather than rounded to 10 s.
- **Size budget.** The GIF is a timeline: identical consecutive frames are merged (at most 10 s per frame), so a typical GIF with all extras is ~25-35 KB
  (~140 B per frame) against ~7 KB for the plain countdown. It must stay under `MPK_MAX_BYTES` (default 40 KB; the Worker and the ESP accept 64 KB, and a bigger
  GIF takes longer over BLE: ≈2 s for 29 KB). If it would not, the Worker gives things up in this order: a shorter GIF (360 s instead of 500 s), the animation,
  the clock's seconds, the stop screen. The PUT answer reports `gif: {size, frames, seconds, dropped}`.

**Mode `minutes`** - live vehicles + timetable (`mode=hybrid`) as a static picture `13   12 min`, rewritten whenever the minutes change. Use it when you want delays
and vehicles that are really on their way; use `dir` (a terminus or stop that lies in your direction of travel) so vehicles going the other way are filtered out.

| Request | Token | Result |
|---|---|---|
| `PUT /panel/:id/mpk` `{"stop":"12020","lines":"13,23","dir":"Stadion Olimpijski","color":"#ffb000","mode":"seconds","info_every":40,"info_for":10,"info_seconds":true,"label":"","anim":true}` | write / admin | validates, renders immediately, enables the job; answers with `stop_name`, `rows` and `gif` |
| `GET /panel/:id/mpk` | any panel token | `{enabled, config}` |
| `DELETE /panel/:id/mpk` | write / admin | disables the job (the configuration is kept) |

`stop` is a stop code (letters and digits); `lines` and `dir` are optional filters; `mode` is `seconds` (default) or `minutes`.
Extras (seconds mode only): `info_every` 0 (off) or 10-600 s, `info_for` 1-120 s and shorter than `info_every`, `info_seconds` (default false = HH:MM),
`label` (≤ 24 characters, empty = the stop name from the transit API), `anim`, `anim_s` (0.5-10, default 3). A stored configuration without these fields gets the defaults.
Optional Worker variables: `MPK_FRAMES` (50 countdown steps = 500 s), `MPK_STEP_S` (10), `MPK_REFRESH_S` (300), `MPK_LEAD_S` (8), `MPK_DELIVERY_LEAD_S` (9, may be fractional), `MPK_MAX_BYTES` (40960),
`FRESH_WINDOW_S` (20). Generating a GIF with all extras takes ~10-15 ms of CPU, once per 5 minutes.
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
