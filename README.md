# ACT1033_LED

Control a BK-Light 64×16 BLE LED panel in two ways, with the same features and the same GIF pipeline:

| | **ESP32 standalone** ([`esp32/`](esp32/)) | **Python on a PC** ([`python/`](python/)) |
|---|---|---|
| Runs on | ESP32-C3, always on | Windows (also macOS/Linux) with Python ≥ 3.9 |
| How you use it | web page from any phone/PC on the Wi-Fi, HTTP API | command line `act1033 …` or import the library |
| Link to the panel | BLE from the ESP | BLE from the PC (bleak) – or through the ESP with `--esp HOST` |
| Needs | ESP32-C3 + PlatformIO to flash it once | Bluetooth adapter on the PC |

```
 phone / PC browser ──HTTP──▶ ESP32-C3 ──BLE──▶ ┐
                                                 ├─▶ BK-Light panel (plays the uploaded GIF by itself)
 PC: act1033 (Python) ──────────BLE────────────▶ ┘
        └─ or ──HTTP──▶ ESP32-C3 (act1033 --esp panel.local …)
```

A third, cloud-based mode keeps the ESP minimal: a **Cloudflare Worker** ([`cloudflare/`](cloudflare/)) renders
text / shapes / animations into a finished PNG/GIF, and a thin **ESP32 client** ([`esp32-client/`](esp32-client/))
downloads it and relays it to the panel over BLE. See [docs/RENDER_API.md](docs/RENDER_API.md).

```
 Cloudflare Worker ──HTTPS (PNG/GIF)──▶ ESP32-C3 client ──BLE──▶ BK-Light panel
```

Both sides render the same things (text, Game of Life, GIFs) into a GIF that stays inside the panel and keeps
playing after the sender disconnects. The renderers are intentionally identical: the same text, seed and settings
produce the same animation from the web page and from Python (checked by comparing frame hashes).

## What you can show

- the two built-in demo animations,
- your own 64×16 GIF (the Python tool can re-encode other GIFs with `--fix`),
- scrolling / static / blinking text with a 5×7 pixel font (Polish letters included) or a 10×14 variant,
- Conway's Game of Life on a 32×8 grid of 2×2 px cells, with the file size computed live and an automatic trim to
  the 64 KB limit.

## Quick start

**Python (Windows, no extra hardware):**

```powershell
cd python
python -m venv .venv
.venv\Scripts\pip install -e .
.venv\Scripts\act1033 scan
.venv\Scripts\act1033 text "Hello" --color 00ff00
```

**ESP32 bridge:** see [esp32/README.md](esp32/README.md) – flash with PlatformIO, join the Wi-Fi through the setup
portal, open `http://panel.local/`.

**Both together:** `act1033 --esp panel.local text "Hello"` sends through the ESP instead of BLE.

## Repository layout

```
ACT1033_LED/
├── esp32/         standalone firmware (PlatformIO, Arduino, NimBLE): Wi-Fi, web UI, HTTP API, BLE client, on-device rendering
├── esp32-client/  thin firmware for the cloud mode: downloads PNG/GIF from the Worker and relays it over BLE
├── cloudflare/    Cloudflare Worker (TypeScript, wrangler): universal PNG/GIF renderer
├── python/        act1033led package + CLI (bleak, optional Pillow) and offline tests
└── docs/          PROTOCOL.md (BLE protocol), RENDER_API.md (Worker API), API_GUIDE.md (Wrocław transit API)
```

## Status

| Area | State |
|---|---|
| Python → panel over BLE on Windows 11 (bleak, Python 3.11) | **verified on hardware**: handshake, 3-segment upload, panel confirmed |
| Python protocol/render/ESP-client code | 14 offline tests pass (framing, LZW round-trip through Pillow, Life determinism, fake-ESP HTTP) |
| Python ↔ web page parity (Game of Life frames for the same seed) | verified (frame hashes match) |
| ESP32: GIF upload, Game of Life → GIF, live log, Wi-Fi provisioning | verified on hardware (earlier firmware build) |
| ESP32: PNG frame stream benchmark | measured: ~11 fps (1-bit), ~3–4 fps (RGB); no "live Life" mode yet |
| Text rendering on the real panel | encoder verified with Pillow; appearance on the panel not confirmed |
| Python → panel through the ESP (`--esp`) on hardware | not verified – the ESP lost Wi-Fi reception during the last session |
| ESP32 web UI after the English rewrite | built and flashed, not yet opened in a browser |

## License

No license has been chosen yet – add a `LICENSE` file before publishing. The BLE protocol was worked out from the
open-source BK-Light project and from testing on a real panel (tested panel: 64×16, `LED_BLE_xxxxxxxx`, ACT1025 variant).
