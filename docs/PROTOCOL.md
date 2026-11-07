# BK-Light panel BLE protocol (64×16, ACT1025 variant)

Collected from the code of the original BK-Light project and from our own tests on real hardware (first a PC with `bleak`,
then an ESP32-C3 with NimBLE). Everything below was checked on one panel (`LED_BLE_xxxxxxxx`) unless marked otherwise.

## GATT

| Element | UUID | Properties |
|---|---|---|
| Service | `0xFA00` | |
| Write (commands and data) | `0000fa02-0000-1000-8000-00805f9b34fb` | write, write without response |
| Notifications | `0000fa03-0000-1000-8000-00805f9b34fb` | notify |

The panel also exposes service `0xAE00` (`ae01` write-no-response, `ae02` notify) – not used.
MTU 512; data is written in 509-byte chunks (write without response) with a ~10 ms pause between chunks (0 ms also worked).

> Enabling notifications (the CCCD write) must be **acknowledged**. `NimBLE-Arduino 1.4.x` writes the CCCD *without* a response by
> default in `subscribe()`; the panel then sends no notifications at all and the handshake times out.

## Handshake

Before the first data frame in a connection:

1. write `08 00 01 80 0E 06 32 00` → reply `0B 00 01 80 83 06 32 00 00 01 00`
2. write `04 00 05 80` → reply `08 00 05 80 0E 02 07 04`

A missing reply to either step does not block uploading (the clients log a warning and continue).

## Data frame

```
bytes 0..1   frame length = len(data) + 15          (LE)
byte  2      type: 0x02 = PNG, 0x03 = GIF
byte  3      0x00
byte  4      0x00 = single frame / first segment, 0x02 = next segment
bytes 5..8   length of the WHOLE data               (LE, 4 bytes)
bytes 9..12  CRC32 of the whole data                (LE)
bytes 13..14 0x00 0x65                              (byte 14 must be 0x65)
bytes 15..   data (a GIF or PNG file)
```

### Confirmations (notifications on `fa03`)

| Reply | Meaning |
|---|---|
| `05 00 03 00 03` | GIF received completely |
| `05 00 03 00 01` | GIF segment received, waiting for more |
| `05 00 02 00 03` | PNG frame received |
| `05 00 00 00 00` | short acknowledgement (seen with very small packets) |

The clients treat any 5-byte reply with byte 3 = `0x00` and byte 4 = `0x03` as "complete".

## GIF (animation stored in the panel)

An uploaded GIF stays in the panel's memory and keeps playing after the BLE link is closed. A new GIF **replaces** the old one.
After the confirmation the panel needs ~2 s to switch to the new animation (the screen flashes briefly).

- **Segmentation** (avoids the ~12 KB single-frame limit): segments of 4096 data bytes; each segment's frame has the header above with
  the *segment* length + 15 in bytes 0..1, byte 4 = `0x00` (first) / `0x02` (next), and bytes 5..12 (size and CRC) describing the whole
  file. The panel confirms each segment with `…01` and the last one with `…03`. Wait for the confirmation after every segment (up to 2 s).
- **Size:** ≥ 424 KB worked in a PC test. A single (non-segmented) frame is limited to 12 305 B; a larger file wipes the stored animation.
  The ESP firmware limits itself to 64 KB.
- **Shared palette:** one global colour table (e.g. 16 entries) and no local tables. Per-frame palettes of a different size than the
  global one freeze the animation on the first frame.
- **Never re-send an identical file** (same size and CRC): the panel answers "complete" for every segment and the stored animation is
  corrupted. Workaround: 4 random bytes after the GIF trailer `0x3B` (decoders ignore them).
- **Frame time:** works from 10 ms (1 cs) up to at least 1 s.
- **Byte 14 = `0x65`;** other values give a frozen first frame or a white screen.
- Frames may be full or cropped to a rectangle; the panel handles both.

## PNG (single frames / streaming)

This is how the original BK-Light project works (clock, text): one frame of type `0x02` per picture, nothing stored.
After one handshake many frames can be sent in the same connection; the original code sends `05 00 00 01 00` about every 30 frames.

Tested from the ESP32-C3 (Game of Life 32×8 → 64×16; full table in [esp32/README.md](../esp32/README.md#measurements)):
- 8-bit RGB PNG (3156 B, deflate "stored"): confirmed, ~3–4 fps,
- 1-bit indexed PNG with a 2-colour palette (230 B): confirmed, ~11 fps. A confirmation does not prove correct rendering –
  how the frames looked was judged by the user on the panel.
- **After a stream the panel stays in its loading mode** (blue transfer indicator). Uploading a regular GIF or power-cycling the
  panel fixes it.
- The confirmation latency (58–88 ms even for a 230 B frame) is dominated by the BLE connection interval. Requesting
  `updateConnParams(6, 12, 0, 400)` (7.5–15 ms) shortens it considerably.

## Order of operations in the clients

`scan → connect → (get characteristics) → subscribe with response → handshake → GIF segments, waiting for the confirmation of each →
05 00 03 00 03 → disconnect`. The ESP firmware retries the whole job once on failure.
`Panel::streamBegin/streamFrame/streamEnd` (ESP) keep one connection and handshake for many PNG frames.

## Unknowns

- How to choose one of several animations (the panel keeps only one); a candidate is the packet `07 00 08 80 01 00 CH` from the native text protocol.
- The upper size limit of a stored animation (> 424 KB).
- The meaning of byte 14 other than `0x65`.
- Whether a frame time of 0 ms is accepted.
- How to close a PNG stream session cleanly so that the panel returns to its normal state without uploading a GIF.
