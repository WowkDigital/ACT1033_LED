# ESP32-C3 bridge for the BK-Light 64×16 panel

The ESP32-C3 stays powered on, joins your Wi-Fi and serves a control page. From a phone or PC you can change what the
panel shows at any moment: built-in animations, your own GIF, text (with Polish letters) or Game of Life. The ESP
connects to the panel over **BLE** and uploads the animation; the panel then plays it by itself, even after the ESP disconnects.

```
 browser ──HTTP (Wi-Fi)──▶ ESP32-C3 ──BLE──▶ BK-Light panel 64×16
 (renders text / Life to GIF)   (HTTP server + BLE client)   (plays the uploaded GIF)
```

All rendering (text, Game of Life, GIF encoding) happens in the browser; the ESP is a relay from HTTP to BLE. The panel's protocol
is described in [../docs/PROTOCOL.md](../docs/PROTOCOL.md). The same features are available from a PC with the Python tool in
[../python](../python).

## Features

| Feature | Status |
|---|---|
| Upload the built-in animations A / B | verified on hardware |
| Upload your own GIF (64×16, ≤ 64 KB): drag & drop, `curl` | verified (`curl`, Game of Life) |
| Game of Life → GIF (2×2 px cells, live file size, trim to the limit) | verified on the panel |
| Text → GIF (5×7 font with Polish letters; static / scrolling / blinking) | encoder verified with Pillow; appearance on the panel not confirmed |
| Live status: job steps, progress bar, BLE log, device info | verified (earlier firmware build) |
| Wi-Fi provisioning (setup portal, USB command) | verified |
| PNG frame stream benchmark (Game of Life computed on the ESP) | measured, see below; no "live Life" mode yet |

## Hardware

- **ESP32-C3** (tested on a QFN32 rev 0.4 board with 4 MB flash and **no antenna** – reception was poor, RSSI around −75…−95 dBm).
  A board with a proper antenna is strongly recommended; see [Troubleshooting](#troubleshooting).
- **BK-Light panel**, 64×16, advertising as `LED_BLE_xxxxxxxx`.

## Build and flash

Requires [PlatformIO](https://platformio.org/) (`pip install platformio`).

```bash
cd esp32
pio run -t upload --upload-port COM4        # e.g. /dev/ttyACM0 on Linux
```

Notes:
- `platformio.ini` pins **`espressif32@6.9.0`** (Arduino core 2.x). Newer platforms (Arduino core 3.x) crash on start-up
  (Guru Meditation) with `NimBLE-Arduino@1.4.x`.
- The board uses native USB (USB-Serial/JTAG). **Opening the serial port resets the ESP**, so do not watch the log while you
  configure Wi-Fi or while a job is running.

### Configuration in the code

In [src/main.cpp](src/main.cpp):

| Constant | Meaning |
|---|---|
| `PANEL_ADDR` | BLE address of your panel, lower case (e.g. `aa:bb:cc:dd:ee:ff`); `""` = first `LED_BLE_*` device found |
| `HOSTNAME` | mDNS name (`http://panel.local`) |
| `MAX_GIF` | upload size limit (default 64 KB) |

Set `PANEL_ADDR` to your own panel (scan with `act1033 scan` from the Python tool, or any BLE scanner app).

## Wi-Fi setup

Credentials are stored in the ESP's NVS (not in the source) and survive re-flashing.

**Setup portal.** With no saved network, or when connecting fails (about 20 s), the ESP starts the access point
`ESP-Panel-setup` (password `panel-setup` – change it in `setupPortal()` before any public use). Connect to it, open
`http://192.168.4.1`, choose your network, enter the password and save; the ESP restarts and joins the network.
If a network *is* saved but unreachable, the ESP retries every 2 minutes unless someone is connected to the setup access point.

**Over USB (serial, 115200):**

```
wifi <ssid> <password>    # saves and restarts (SSID without spaces; the password may contain spaces)
wifireset                 # forgets the saved network -> setup portal after restart
```

Radio settings that were needed on the test board:
- channels 1–13 (`esp_wifi_set_country` "PL"): the default is 1–11 only, and the router was on channel 13,
- minimum security WPA2 (router with WPA2/WPA3 and Wi-Fi 7),
- the network scan runs before the access point starts (in AP+STA mode it came back empty).

## Web interface

`http://<esp-ip>/` (or `http://panel.local/`):

- **Live job** – steps BLE scan → Connect → Handshake → Transfer → Confirmation, a progress bar and a timestamped log.
- **Built-in animations** – A (green bar), B (checkerboard).
- **Text** – preview, mode, size (5×7 or 10×14 without diacritics), colour, background, scroll speed.
- **Game of Life → GIF** – generations (up to 600), frame time, density, seed, colours, edge wrap, reseed on stagnation.
  The size of every frame is known, so the page shows the file size, the animation time and the maximum number of generations that
  fit in the limit; "Trim to the 64 KB limit" shortens the animation automatically, otherwise sending is blocked above 64 KB.
- **Custom GIF** – checks the header, the dimensions (warning if not 64×16) and the size.
- **Stream test** – benchmark of PNG frames (see below).
- **Device** – network, IP, Wi-Fi and BLE RSSI, uptime, free memory, firmware build, restart.

## HTTP API

One BLE job at a time; another request gets `409 {"error":"panel is busy"}`.

| Method | Path | Description |
|---|---|---|
| GET | `/` | control page |
| GET | `/status?since=N` | JSON: IP, SSID, RSSI, `job{running,pending,phase,pct,name}`, `last{ok,msg,ago_s}`, `panel{addr,rssi,seen_s}`, `log[]` (entries with `i` > N) |
| GET | `/demo?n=a\|b` | upload a built-in animation |
| GET | `/demo.gif?n=a\|b` | the built-in GIF itself (thumbnails) |
| POST | `/gif` | `multipart/form-data`, field `gif` – upload a GIF (≤ 64 KB) |
| GET | `/bench?mode=rgb\|idx\|both&sec=10&gap=10` | PNG stream test (Game of Life computed on the ESP) |
| GET | `/stop` | abort a running stream test |
| POST | `/reboot` | restart the ESP |
| GET | `/font.js` | the 5×7 font for the page |

```bash
curl -F "gif=@animation.gif" http://panel.local/gif
curl "http://panel.local/demo?n=b"
curl http://panel.local/status
```

> **Security:** there is no authentication. Keep the ESP on a trusted local network and never expose it to the internet.

## USB commands (serial 115200)

`a`, `b` (animations), `status` (JSON), `wifi <ssid> <password>`, `wifireset`.

## Project layout

```
esp32/
├── platformio.ini
├── src/
│   ├── main.cpp      Wi-Fi, HTTP server, job queue, log/phases, Game of Life + stream benchmark
│   ├── panel.cpp/.h  BLE client (scan, connect, handshake, GIF in segments, PNG stream)
│   ├── png.cpp/.h    minimal PNG encoder (deflate "stored"; RGB and 1-bit with palette)
│   ├── web.h         the web page (HTML + JS: text and Life rendering, GIF/LZW encoder)
│   ├── log.h         shared log and job state
│   ├── gifs.h        generated demo animations A/B (tools/make_gifs.py)
│   └── font_js.h     generated 5x7 font (tools/gen_font.py)
└── tools/
    ├── make_gifs.py  generates gifs.h and gif_a/b.gif (needs Pillow)
    └── gen_font.py   exports ../python/act1033led/font.py to font_js.h
```

`gifs.h` and `font_js.h` are generated but committed, so building does not need Python.

## Limits and pitfalls

- **64 KB per file** (firmware and page). The panel accepts more (≥ 424 KB was tested from a PC), but the ESP buffer is small.
- **GIF palette:** all frames must share one colour table (global, 16 entries, no local tables). Per-frame palettes can freeze the
  panel on the first frame.
- **Re-sending an identical file breaks the animation** – the panel recognises the CRC. The firmware appends 4 random bytes after
  the GIF trailer (`0x3B`) on every upload.
- **After a PNG stream the panel stays in its loading mode** (blue transfer indicator). Sending a regular GIF or power-cycling the
  panel fixes it. That is why there is no "live Life" mode yet.
- While connecting over BLE (up to ~20 s) the page may stop answering for a moment; the HTTP server is served between BLE packets,
  but `connect()` itself blocks.
- Wi-Fi and BLE share one radio on the ESP32-C3.

## Measurements

**GIF upload** (scan + connect + transfer, weak signal): 3.4 KB ≈ 3 s, 12 KB ≈ 4 s.

**PNG frame stream** (one connection, Game of Life 32×8, 10 s per variant, short BLE connection interval 7.5–15 ms, 0 ms packet gap):

| Frame format | Frame size | fps | Panel confirmation (avg / min / max) | Errors |
|---|---|---|---|---|
| PNG 1-bit with palette | 230 B | **11.2** | 88 / 58 / 164 ms | 0 |
| PNG RGB | 3156 B | 3.2 | 242 / 190 / 353 ms | 1 |

With the default connection interval and a 10 ms gap: 6.8 fps (1-bit, 2 errors) and 3.7 fps (RGB). These were measured on a board without
an antenna; they describe the confirmation throughput, not how the frames look on the panel.

## Troubleshooting

| Symptom | Check |
|---|---|
| "Panel not visible" in the log | panel powered on, near the ESP, **not connected to a phone** (the vendor app holds the BLE link); power-cycle the panel |
| BLE connection fails, RSSI < −90 dBm | move the ESP closer, attach an antenna |
| Wi-Fi disconnect reason `201` | the ESP cannot see the network: channel 13 (country setting), range, or the ESP radio sees nothing at all |
| Wi-Fi reason `202` (AUTH_FAIL) / `2` | wrong password or too weak a signal; WPA3-only router |
| Page does not open | the computer must be on the same network; `panel.local` does not work everywhere (e.g. Android) – use the IP from the serial log |
| Panel stuck in loading mode | upload a regular GIF (animation A/B) or power-cycle the panel |
| ESP restarts when the serial port is opened | normal for USB-Serial/JTAG; do not open the port while it works |

## Ideas

- "Live Life" through the PNG stream (after finding a clean way to close the session).
- A stable address (remember the IP, DHCP reservation), HTTP authentication, OTA updates, several panels.
- Verify the text mode on the panel.

## MPK mode (Wrocław departures)

The web panel has an **MPK departures** card. When the mode is on, the ESP polls
`https://wroclaw-transit.wowk-digital.workers.dev/departures` (see `docs/API_GUIDE.md`) every N seconds
(`mode=hybrid&limit=2`), renders the next 2 departures (line on the left, minutes on the right, one per row)
and sends them to the panel as a static GIF. The panel is only touched when the departures change.
Defaults: stop `12020` (Budziszyńska), line `13`, direction `Stadion Olimpijski`. Settings are stored in NVS.
Sending any other animation from the web panel or serial console switches the mode off.
The 5x7 font table `src/mpk_font.h` is generated by `tools/gen_mpk_font.py`.
