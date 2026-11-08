# act1033led – Python control for the BK-Light 64×16 panel

Command line tool and library. Talks to the panel **directly over BLE** (bleak) or **through the ESP32 bridge over HTTP**
(standard library only).

## Install (Windows)

```powershell
python -m venv .venv
.venv\Scripts\pip install -e .          # installs bleak
.venv\Scripts\pip install -e ".[gif]"   # optional: Pillow, only for `act1033 gif --fix`
```

Requirements: Python ≥ 3.9, a Bluetooth LE adapter, Bluetooth switched on. Close the phone app that may be connected to
the panel (the panel accepts only one BLE connection) and make sure the ESP32 bridge is not sending at the same time.

## Use

```powershell
act1033 scan                                    # lists LED_BLE_* panels with their signal strength
act1033 text "Hello" --color ff8000             # scrolling text
act1033 text "Zażółć gęślą jaźń" --mode static --size 1
act1033 life --gens 200 --seed 42 --delay-ms 100
act1033 gif my.gif --fix                        # re-encode any GIF to 64x16 + shared palette
act1033 demo a
act1033 -v text "debug"                         # -v prints the panel's notifications
```

Common options (before the command):

| Option | Meaning |
|---|---|
| `--address MAC` | panel address (or `ACT1033_ADDRESS`); default: the strongest `LED_BLE_*` device |
| `--esp HOST` | send through the ESP32 bridge (or `ACT1033_ESP`), e.g. `--esp panel.local` |
| `--limit BYTES` | maximum GIF size, default 65536 (the ESP's limit; BLE itself accepts more) |
| `--no-unique` | BLE only: do not append the 4 random bytes (see [PROTOCOL](../docs/PROTOCOL.md)) |

`text`, `life`, `gif` and `demo` also accept `--save FILE` (keep the generated GIF) and `--no-send` (generate only).
The Life command trims the animation to the size limit automatically; `--no-trim` makes it fail instead.

## Library

```python
import asyncio
from act1033led import render
from act1033led.device import Panel

frames, delays = render.text_frames("Hello", mode="scroll", scale=1, speed=3)
gif = render.encode_gif(frames, delays, render.make_palette(bg=(0, 0, 0), fg=(0, 255, 0)))

async def main():
    async with Panel() as panel:            # or Panel("AA:BB:CC:DD:EE:FF")
        print(await panel.send_gif(gif))    # True when the panel confirmed the upload

asyncio.run(main())
```

Through the ESP instead:

```python
from act1033led.esp import Esp
Esp("panel.local").send_gif(gif, "my text")
```

Modules: `protocol` (frames, segmentation, GIF inspection – no I/O), `render` (font, text, Game of Life, GIF encoder),
`device` (BLE), `esp` (HTTP), `cli`.

## Tests

```powershell
python -m unittest discover -s tests        # offline, no hardware needed
```

They cover frame headers and segmentation, notification parsing, the LZW encoder (decoded back with Pillow, including the
4096-entry table reset), text geometry, Game of Life determinism and the size-limit logic, and the ESP HTTP client against
a local fake server.

## Notes

- A GIF re-sent unchanged is recognised by the panel and breaks the stored animation; the library therefore appends
  4 random bytes after the GIF trailer on every upload (the web UI/firmware does the same).
- Uploads take a few seconds (≈ 3 s for 3 KB, ≈ 4–5 s for 12 KB on the tested panel). After the panel confirms, it needs about
  2 s to switch to the new animation.
- `font.py` is the single source of the pixel font; `esp32/tools/gen_font.py` exports it for the ESP's web page.
