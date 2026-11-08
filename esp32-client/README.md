# ESP32-C3 client for the BK-Light 64×16 panel

A thin bridge: the ESP32-C3 joins Wi-Fi, downloads the panel's current **finished PNG or GIF** from your own Cloudflare Worker
([../cloudflare](../cloudflare), API in [../docs/RENDER_API.md](../docs/RENDER_API.md)) and uploads it to the panel over
**BLE**. It does no rendering and has no web server.

```
 control page ──PUT (write token)──▶ Cloudflare Worker + D1 ◀──GET (read token, ETag)── ESP32-C3 ──BLE──▶ panel
 (../web, GitHub Pages)                                                                (this firmware)
```

Every few seconds the ESP asks the Worker for the image: the Worker's `X-Poll-After` header sets the pace (3 s for 3 minutes after a change,
`iv` seconds - default 30 - when idle), and one TLS connection is kept open between checks. `304 Not Modified` means nothing to do; otherwise the new
file is uploaded to the panel (bytes identical to the last confirmed file are skipped by CRC32). A failed download keeps the
current picture.
The panel protocol is described in [../docs/PROTOCOL.md](../docs/PROTOCOL.md).

- **GIF** – segmented upload (4096 B), stored in the panel and played by it. Four random bytes are appended after the
  trailer so a re-sent file is never identical. Limit 64 KB.
- **PNG** – one frame (≤ 12 000 B), nothing is stored. After a PNG the panel stays in its loading mode until a GIF is uploaded
  (see PROTOCOL.md), so prefer GIF for anything permanent.

## Build and flash

Requires [PlatformIO](https://platformio.org/) (`pip install platformio`).

```bash
cd esp32
pio run -t upload --upload-port COM4        # e.g. /dev/ttyACM0 on Linux
```

## Configure (USB serial, 115200)

Everything is stored in the ESP's flash (NVS) – **nothing secret is compiled in or committed**.

| Command | Effect |
|---|---|
| `wifi <ssid> <password>` | save Wi-Fi credentials and restart |
| `wifireset` | forget Wi-Fi credentials |
| `url <https://<your-worker>/panel/<id>/image>` | where to fetch the picture |
| `token <read token>` | the panel's `r_…` token from your Worker (`POST /admin/panels`) |
| `addr <aa:bb:cc:dd:ee:ff \| auto>` | BLE address of your panel; `auto` = first `LED_BLE_*` device found |
| `iv <seconds>` | check interval, 5–3600 (default 30) |
| `now` | fetch and send immediately, even if unchanged |
| `status` | IP, RSSI, heap, URL, interval (the token is never printed) |

Each check sends `If-None-Match` with the last ETag; the Worker answers `304` when nothing changed, so an idle ESP downloads nothing.
Opening the serial port resets the ESP. Set up the Worker and create a panel first: [../cloudflare/README.md](../cloudflare/README.md).

## Latency

Measured on the real panel (RSSI about −75 dBm): a change uploaded to the Worker is downloaded by the ESP after ≈3 s
(the burst poll interval) and confirmed by the panel ≈7 s after the upload. The BLE part takes ≈3.5–4.5 s: scan ≈0.2 s, connect ≈1.7–2 s,
handshake ≈0.45 s, upload + confirmation ≈1.1 s for 10 KB (≈2.1 s for 29 KB). Each upload logs this breakdown on the serial port.
About 1.4 s of it are fixed `delay()`s in `panel.cpp` that could be trimmed.

## Hardware notes

- ESP32-C3 board with 4 MB flash. The tested board had **no antenna**: BLE RSSI around −77 dBm and occasional failed
  connection attempts (the firmware retries 3×, then the whole upload once). A board with an antenna is recommended.
- Wi-Fi: WPA2 only (WPA3 is disabled), channels 1–13; a phone hotspot works.
- The panel must be powered, in range, and not connected to a phone app.

## Layout

`src/main.cpp` – Wi-Fi, download, change detection, serial commands · `src/panel.cpp/.h` – BLE client (scan, handshake,
GIF/PNG upload) · `src/log.h` – serial logging.
