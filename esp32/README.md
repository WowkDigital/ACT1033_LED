# ESP32-C3 client for the BK-Light 64×16 panel

A thin bridge: the ESP32-C3 joins Wi-Fi, downloads a **finished PNG or GIF** from the Cloudflare render Worker
([../cloudflare](../cloudflare), API in [../docs/RENDER_API.md](../docs/RENDER_API.md)) and uploads it to the panel over
**BLE**. It does no rendering and has no web server.

```
 Cloudflare Worker ──HTTPS──▶ ESP32-C3 ──BLE──▶ BK-Light panel 64×16
 (renders text / shapes → GIF/PNG)  (download + relay)   (plays the uploaded GIF)
```

Every `iv` seconds (default 30) the ESP fetches the configured URL. If the bytes differ from the last file the panel
confirmed (CRC32), it uploads them; otherwise the panel is left alone. A failed download keeps the current picture.
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

| Command | Effect |
|---|---|
| `wifi <ssid> <password>` | save Wi-Fi credentials (NVS) and restart – never put them in the repo |
| `wifireset` | forget Wi-Fi credentials |
| `url <https://…>` | image source, e.g. `https://act1033-led.wowk-digital.workers.dev/render?text=Hi&format=gif&anim=scroll` |
| `iv <seconds>` | download interval, 5–3600 |
| `now` | fetch and send immediately, even if unchanged |
| `status` | IP, RSSI, heap, URL, interval |

Opening the serial port resets the ESP. The panel address is `PANEL_ADDR` in `src/main.cpp` (`""` = first `LED_BLE_*` device).

## Hardware notes

- ESP32-C3 board with 4 MB flash. The tested board had **no antenna**: BLE RSSI around −77 dBm and occasional failed
  connection attempts (the firmware retries 3×, then the whole upload once). A board with an antenna is recommended.
- Wi-Fi: WPA2 only (WPA3 is disabled), channels 1–13; a phone hotspot works.
- The panel must be powered, in range, and not connected to a phone app.

## Layout

`src/main.cpp` – Wi-Fi, download, change detection, serial commands · `src/panel.cpp/.h` – BLE client (scan, handshake,
GIF/PNG upload) · `src/log.h` – serial logging.
