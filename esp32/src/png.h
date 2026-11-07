#pragma once
// Minimal PNG encoder (deflate "stored", no compression) for streaming 64x16 frames to the panel.
#include <Arduino.h>

// rgb: w*h*3 bytes. Returns the PNG length written to out (out >= w*h*3 + h + 100 bytes).
size_t pngRgb(const uint8_t* rgb, int w, int h, uint8_t* out);
// bits: h rows of (w+7)/8 bytes, MSB first; pal: 2 RGB colours (6 bytes: background, foreground). 1-bit indexed PNG.
size_t pngIdx1(const uint8_t* bits, int w, int h, const uint8_t pal[6], uint8_t* out);
