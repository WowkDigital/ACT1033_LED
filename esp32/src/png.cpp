#include "png.h"

static uint32_t crcUpdate(uint32_t c, const uint8_t* d, size_t n) {
  for (size_t i = 0; i < n; i++) {
    c ^= d[i];
    for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return c;
}

static void be32(uint8_t* p, uint32_t v) {
  p[0] = v >> 24; p[1] = v >> 16; p[2] = v >> 8; p[3] = v;
}

static size_t chunk(uint8_t* o, const char* type, const uint8_t* data, size_t n) {
  be32(o, n);
  memcpy(o + 4, type, 4);
  if (n) memcpy(o + 8, data, n);
  be32(o + 8 + n, ~crcUpdate(0xFFFFFFFF, o + 4, n + 4));
  return n + 12;
}

static size_t encode(uint8_t* out, int w, int h, int depth, int ctype, const uint8_t* pal, int palBytes,
                     const uint8_t* raw, size_t rawLen) {
  static const uint8_t sig[8] = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
  memcpy(out, sig, 8);
  size_t o = 8;
  uint8_t ih[13] = {0};
  be32(ih, w); be32(ih + 4, h);
  ih[8] = depth; ih[9] = ctype;
  o += chunk(out + o, "IHDR", ih, 13);
  if (palBytes) o += chunk(out + o, "PLTE", pal, palBytes);

  size_t idat = o, z = o + 8;
  out[z++] = 0x78; out[z++] = 0x01;                  // zlib header: deflate, no compression
  uint16_t L = rawLen;                               // a single "stored" block (<= 65535 B)
  out[z++] = 0x01; out[z++] = L & 0xFF; out[z++] = L >> 8;
  out[z++] = (~L) & 0xFF; out[z++] = ((~L) >> 8) & 0xFF;
  memcpy(out + z, raw, rawLen); z += rawLen;
  uint32_t a = 1, b = 0;                             // adler32
  for (size_t i = 0; i < rawLen; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
  be32(out + z, (b << 16) | a); z += 4;
  size_t n = z - (idat + 8);
  be32(out + idat, n);
  memcpy(out + idat + 4, "IDAT", 4);
  be32(out + idat + 8 + n, ~crcUpdate(0xFFFFFFFF, out + idat + 4, n + 4));
  o = idat + n + 12;
  o += chunk(out + o, "IEND", nullptr, 0);
  return o;
}

static uint8_t rawBuf[64 * 16 * 3 + 16 + 8];

size_t pngRgb(const uint8_t* rgb, int w, int h, uint8_t* out) {
  size_t stride = w * 3, o = 0;
  for (int y = 0; y < h; y++) {
    rawBuf[o++] = 0;  // filter: none
    memcpy(rawBuf + o, rgb + y * stride, stride);
    o += stride;
  }
  return encode(out, w, h, 8, 2, nullptr, 0, rawBuf, o);
}

size_t pngIdx1(const uint8_t* bits, int w, int h, const uint8_t pal[6], uint8_t* out) {
  size_t stride = (w + 7) / 8, o = 0;
  for (int y = 0; y < h; y++) {
    rawBuf[o++] = 0;
    memcpy(rawBuf + o, bits + y * stride, stride);
    o += stride;
  }
  return encode(out, w, h, 1, 3, pal, 6, rawBuf, o);
}
