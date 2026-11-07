"""Command line interface: ``act1033 [--address MAC | --esp HOST] <command>``.

Commands
    scan              list nearby LED_BLE panels (BLE)
    gif FILE          upload a GIF (``--fix`` re-encodes it to 64x16 with a shared palette; needs Pillow)
    text "Hello"      render text and upload it
    life              simulate Conway's Game of Life and upload the animation
    demo a|b          upload one of the built-in animations
    esp-status        print the status of the ESP32 bridge (needs --esp)

Without ``--esp`` the PC talks to the panel directly over BLE (bleak). With ``--esp HOST`` the same commands
go through the ESP32 bridge over HTTP, e.g. ``act1033 --esp panel.local text "Hi"``.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

from . import protocol as proto
from . import render
from .esp import Esp, EspError


def _log(verbose: bool):
    return (lambda m: print("  " + m)) if verbose else (lambda _m: None)


def deliver(args, gif: bytes, name: str) -> int:
    """Send a GIF via BLE or the ESP bridge; returns a process exit code."""
    info = proto.inspect_gif(gif)
    for w in info.warnings:
        print(f"warning: {w}", file=sys.stderr)
    print(f"uploading {len(gif) / 1024:.1f} KB, {info.frames} frame(s) ...")
    try:
        if args.esp:
            ok = Esp(args.esp).send_gif(gif, name, log=_log(args.verbose))
        else:
            from .device import Panel

            async def go() -> bool:
                async with Panel(args.address, log=_log(args.verbose)) as p:
                    return await p.send_gif(gif, unique=not args.no_unique, max_size=max(args.limit, 512 * 1024))

            ok = asyncio.run(go())
    except (EspError, ConnectionError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    print("done: the panel confirmed the upload" if ok else "failed: no confirmation from the panel")
    return 0 if ok else 1


def _finish(args, gif: bytes, name: str) -> int:
    if args.save:
        Path(args.save).write_bytes(gif)
        print(f"saved {args.save} ({len(gif) / 1024:.1f} KB)")
    if args.no_send:
        return 0
    if len(gif) > args.limit:
        print(f"error: {len(gif)} B exceeds the {args.limit} B limit", file=sys.stderr)
        return 1
    return deliver(args, gif, name)


def cmd_scan(args) -> int:
    from .device import scan

    rows = asyncio.run(scan(args.timeout, show_all=args.all))
    if not rows:
        print("no panels found (is it powered on and not connected to a phone?)")
        return 1
    for addr, name, rssi in rows:
        print(f"{addr}  rssi={rssi:4}  {name}")
    return 0


def cmd_gif(args) -> int:
    data = Path(args.file).read_bytes()
    if args.fix:
        data = render.normalize_gif(data)
    return _finish(args, data, Path(args.file).name)


def cmd_text(args) -> int:
    frames, delays = render.text_frames(args.text, args.mode, args.size, args.speed)
    pal = render.make_palette(render.hex_to_rgb(args.bg), render.hex_to_rgb(args.color))
    gif = render.encode_gif(frames, delays, pal)
    print(f"{len(frames)} frames, {len(gif) / 1024:.1f} KB")
    return _finish(args, gif, "text")


def cmd_life(args) -> int:
    pal = render.make_palette(render.hex_to_rgb(args.bg), render.hex_to_rgb(args.color))
    frames, reseeds = render.life_frames(render.LIFE_MAX, args.density / 100,
                                         args.seed, not args.no_wrap, not args.no_reseed)
    cs = max(1, round(args.delay_ms / 10))
    fit, size = render.fit_to_limit(frames, cs, pal, args.limit)
    keep = min(args.gens, render.LIFE_MAX)
    if keep > fit:
        if args.no_trim:
            print(f"error: {keep} generations do not fit in {args.limit} B (max {fit}); "
                  "lower --gens or drop --no-trim", file=sys.stderr)
            return 1
        print(f"trimmed from {keep} to {fit} generations to fit the {args.limit} B limit")
        keep = fit
    gif = render.encode_gif(frames[:keep], [cs] * keep, pal)
    print(f"{keep} generations, {len(gif) / 1024:.1f} KB of {args.limit / 1024:.0f} KB, "
          f"{keep * args.delay_ms / 1000:.1f} s, seed {args.seed}, reseeded {reseeds}x "
          f"(max within the limit: {fit})")
    return _finish(args, gif, f"life {args.seed}")


def cmd_demo(args) -> int:
    gif = render.demo_a() if args.name == "a" else render.demo_b()
    return _finish(args, gif, f"demo {args.name}")


def cmd_esp_status(args) -> int:
    if not args.esp:
        print("error: esp-status needs --esp HOST", file=sys.stderr)
        return 1
    try:
        s = Esp(args.esp).status()
    except EspError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    s.pop("log", None)
    print(json.dumps(s, indent=2))
    return 0


def _colour(s: str) -> str:
    render.hex_to_rgb(s)
    return s


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="act1033",
        description="Control a BK-Light 64x16 LED panel over BLE, or through the ESP32 bridge with --esp HOST.")
    p.add_argument("--address", default=os.environ.get("ACT1033_ADDRESS"),
                   help="panel BLE address (default: $ACT1033_ADDRESS, else the strongest LED_BLE_* device)")
    p.add_argument("--esp", metavar="HOST", default=os.environ.get("ACT1033_ESP"),
                   help="send through the ESP32 bridge at HOST (default: $ACT1033_ESP) instead of BLE")
    p.add_argument("--limit", type=int, default=render.LIMIT, help="maximum GIF size in bytes (default 65536)")
    p.add_argument("--no-unique", action="store_true", help="BLE only: do not append the 4 random bytes")
    p.add_argument("-v", "--verbose", action="store_true", help="show panel notifications and progress")
    sub = p.add_subparsers(dest="cmd", required=True)

    def sendopts(sp):
        sp.add_argument("--save", metavar="FILE", help="also save the generated GIF")
        sp.add_argument("--no-send", action="store_true", help="only generate/save, do not send")

    s = sub.add_parser("scan", help="list nearby panels")
    s.add_argument("--timeout", type=float, default=8.0)
    s.add_argument("--all", action="store_true", help="show every BLE device")
    s.set_defaults(func=cmd_scan)

    s = sub.add_parser("gif", help="upload a GIF file")
    s.add_argument("file")
    s.add_argument("--fix", action="store_true", help="re-encode to 64x16 with a shared 16-colour palette (Pillow)")
    sendopts(s)
    s.set_defaults(func=cmd_gif)

    s = sub.add_parser("text", help="render text and upload it")
    s.add_argument("text")
    s.add_argument("--mode", choices=("scroll", "static", "blink"), default="scroll")
    s.add_argument("--size", type=int, choices=(1, 2), default=1, help="1 = 5x7 (Polish letters), 2 = 10x14")
    s.add_argument("--speed", type=int, choices=range(1, 6), default=3)
    s.add_argument("--color", type=_colour, default="00ff00", help="RRGGBB")
    s.add_argument("--bg", type=_colour, default="000000", help="RRGGBB")
    sendopts(s)
    s.set_defaults(func=cmd_text)

    s = sub.add_parser("life", help="Game of Life animation (32x8 grid of 2x2 px cells)")
    s.add_argument("--gens", type=int, default=100, help="generations (1-600)")
    s.add_argument("--delay-ms", type=int, default=100, choices=(50, 100, 150, 200, 300, 500))
    s.add_argument("--density", type=int, default=30, help="initial live cells, percent")
    s.add_argument("--seed", type=int, default=1)
    s.add_argument("--color", type=_colour, default="00c000")
    s.add_argument("--bg", type=_colour, default="000000")
    s.add_argument("--no-wrap", action="store_true", help="do not wrap around the edges")
    s.add_argument("--no-reseed", action="store_true", help="do not reseed after stagnation")
    s.add_argument("--no-trim", action="store_true", help="fail instead of trimming to the size limit")
    sendopts(s)
    s.set_defaults(func=cmd_life)

    s = sub.add_parser("demo", help="upload a built-in animation")
    s.add_argument("name", choices=("a", "b"))
    sendopts(s)
    s.set_defaults(func=cmd_demo)

    s = sub.add_parser("esp-status", help="print the ESP32 bridge status")
    s.set_defaults(func=cmd_esp_status)
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if getattr(args, "gens", 1) < 1:
        print("error: --gens must be at least 1", file=sys.stderr)
        return 2
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
