#include "mpk.h"

#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include "mpk_font.h"

// Provided by main.cpp
void plog(const char* level, const char* fmt, ...);
void queueJob(uint8_t* buf, size_t len, bool owned, const String& name);
extern bool jobPending, jobRunning, lastOk, apMode;
bool g_mpkJob = false;  // true while MPK itself queues a job (main.cpp disables MPK mode for any other job)

static const char* WORKER = "https://wroclaw-transit.wowk-digital.workers.dev/departures";
static const int W = 64, H = 16;

struct Dep { String line, min, time; };

static struct {
  bool en = false;
  String stop = "12020", lines = "13", dir = "Stadion Olimpijski";
  int iv = 30;
  // runtime state
  bool due = true;
  uint32_t nextAt = 0, fetchedAt = 0;
  String stopName, err;
  String rowL[2], rowR[2];  // what is currently shown (left/right part of each row)
  String sentKey, pendingKey;
  int fetches = 0;
} S;

static Preferences prefs;

static String clean(const String& in, size_t max) {  // keep it safe to embed in JSON / URLs
  String o;
  for (size_t i = 0; i < in.length() && o.length() < max; i++) {
    char c = in[i];
    if (c == '"' || c == '\\' || (uint8_t)c < 32) continue;
    o += c;
  }
  o.trim();
  return o;
}

void mpkBegin() {
  prefs.begin("mpk", true);
  S.en = prefs.getBool("en", false);
  S.stop = prefs.getString("stop", S.stop);
  S.lines = prefs.getString("lines", S.lines);
  S.dir = prefs.getString("dir", S.dir);
  S.iv = prefs.getInt("iv", S.iv);
  prefs.end();
}

static void save() {
  prefs.begin("mpk", false);
  prefs.putBool("en", S.en);
  prefs.putString("stop", S.stop);
  prefs.putString("lines", S.lines);
  prefs.putString("dir", S.dir);
  prefs.putInt("iv", S.iv);
  prefs.end();
}

String mpkConfigure(bool enabled, const String& stop, const String& lines, const String& dir, int iv) {
  String st = clean(stop, 12), ln = clean(lines, 40), d = clean(dir, 40);
  if (!st.length()) return "stop code is required";
  for (char c : st) if (!isalnum((uint8_t)c)) return "stop code: letters and digits only";
  for (char c : ln) if (!isalnum((uint8_t)c) && c != ',') return "lines: comma-separated, e.g. 13,23";
  if (iv < 15 || iv > 600) return "interval must be 15-600 s";
  bool changed = st != S.stop || ln != S.lines || d != S.dir;
  S.stop = st; S.lines = ln; S.dir = d; S.iv = iv;
  if (enabled && !S.en) S.sentKey = "";  // re-send after being re-enabled (the panel may show something else)
  S.en = enabled;
  if (changed) { S.sentKey = ""; S.stopName = ""; }
  S.due = true;
  save();
  plog("i", "MPK mode %s: stop %s, lines '%s', direction '%s', every %d s", S.en ? "on" : "off", S.stop.c_str(), S.lines.c_str(), S.dir.c_str(), S.iv);
  return "";
}

void mpkRefreshNow() { S.due = true; S.sentKey = ""; }

void mpkDisable() {
  if (!S.en) return;
  S.en = false;
  save();
  plog("i", "MPK mode off (another job took over the panel)");
}

// ---------------- worker request + tiny JSON extraction ----------------
static String urlEnc(const String& s) {
  String o;
  char b[4];
  for (size_t i = 0; i < s.length(); i++) {
    uint8_t c = s[i];
    if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == ',') o += (char)c;
    else { snprintf(b, sizeof(b), "%%%02X", c); o += b; }
  }
  return o;
}

// Value of "key": inside s[from,to) - a quoted string or a bare number. "" when absent.
static String jval(const String& s, int from, int to, const char* key) {
  String k = String("\"") + key + "\"";
  int p = s.indexOf(k, from);
  if (p < 0 || (to >= 0 && p >= to)) return "";
  p = s.indexOf(':', p + k.length());
  if (p < 0) return "";
  p++;
  while (p < (int)s.length() && s[p] == ' ') p++;
  int e;
  if (s[p] == '"') { p++; e = s.indexOf('"', p); }
  else { e = p; while (e < (int)s.length() && s[e] != ',' && s[e] != '}' && s[e] != ']') e++; }
  if (e < 0) return "";
  return s.substring(p, e);
}

static bool fetchDepartures(Dep out[2], int& n) {
  n = 0;
  String url = String(WORKER) + "?stop=" + urlEnc(S.stop) + "&mode=hybrid&limit=2";
  if (S.lines.length()) url += "&lines=" + urlEnc(S.lines);
  if (S.dir.length()) url += "&dir=" + urlEnc(S.dir);
  WiFiClientSecure client;
  client.setInsecure();  // public read-only data; no certificate store on the ESP
  HTTPClient http;
  http.setTimeout(8000);
  http.setConnectTimeout(6000);
  if (!http.begin(client, url)) { S.err = "bad URL"; return false; }
  http.addHeader("Accept", "application/json");
  int code = http.GET();
  if (code != 200) {
    S.err = code > 0 ? "worker returned HTTP " + String(code) : "worker unreachable (" + http.errorToString(code) + ")";
    http.end();
    return false;
  }
  String body = http.getString();
  http.end();
  int dp = body.indexOf("\"departures\"");
  if (dp < 0) { S.err = "unexpected response"; return false; }
  String name = clean(jval(body, 0, dp, "stop"), 40);
  if (name.length()) S.stopName = name;
  int arrEnd = body.indexOf(']', dp);
  int pos = body.indexOf('[', dp);
  while (pos >= 0 && n < 2) {
    int o = body.indexOf('{', pos), c = o < 0 ? -1 : body.indexOf('}', o);
    if (o < 0 || c < 0 || (arrEnd >= 0 && o > arrEnd)) break;
    out[n].line = clean(jval(body, o, c, "line"), 4);
    out[n].min = clean(jval(body, o, c, "min"), 4);
    out[n].time = clean(jval(body, o, c, "time"), 5);
    n++;
    pos = c + 1;
  }
  S.err = "";
  return true;
}

// ---------------- rendering: 2 rows of 5x7 text -> 64x16 1-bit frame -> GIF ----------------
static int textWidth(const String& s) {
  int w = 0;
  for (size_t i = 0; i < s.length(); i++) {
    uint8_t c = s[i];
    if (c < 32 || c > 126) continue;
    w += MPK_FONT[c - 32].w + 1;
  }
  return w > 0 ? w - 1 : 0;
}

static void drawText(uint8_t* px, int x, int y, const String& s) {
  for (size_t i = 0; i < s.length(); i++) {
    uint8_t c = s[i];
    if (c < 32 || c > 126) continue;
    const MpkGlyph& g = MPK_FONT[c - 32];
    for (int r = 0; r < 7; r++)
      for (int k = 0; k < g.w; k++)
        if (g.r[r] & (0x10 >> k)) {
          int X = x + k, Y = y + r;
          if (X >= 0 && X < W && Y >= 0 && Y < H) px[Y * W + X] = 1;
        }
    x += g.w + 1;
  }
}

// Static GIF (2 identical frames, like the web text mode), "stored" LZW: a clear code every 12 pixels keeps the
// code width at 5 bits, so no dictionary is needed.
static size_t buildGif(const uint8_t* px, uint8_t* out) {
  size_t n = 0;
  auto b8 = [&](uint8_t v) { out[n++] = v; };
  auto w16 = [&](int v) { b8(v & 255); b8((v >> 8) & 255); };
  const char* sig = "GIF89a";
  for (int i = 0; i < 6; i++) b8(sig[i]);
  w16(W); w16(H); b8(0xF3); b8(0); b8(0);
  for (int i = 0; i < 16; i++) {  // palette: black background, amber text
    if (i == 1) { b8(255); b8(176); b8(0); } else { b8(0); b8(0); b8(0); }
  }
  b8(0x21); b8(0xFF); b8(0x0B);
  for (const char* p = "NETSCAPE2.0"; *p; p++) b8(*p);
  b8(3); b8(1); b8(0); b8(0); b8(0);

  // LZW data (identical for both frames)
  static uint8_t lz[800];
  size_t ln = 0;
  uint32_t cur = 0;
  int nb = 0;
  auto emit = [&](int code) {
    cur |= (uint32_t)code << nb;
    nb += 5;
    while (nb >= 8) { lz[ln++] = cur & 255; cur >>= 8; nb -= 8; }
  };
  emit(16);
  for (int i = 0; i < W * H; i++) {
    emit(px[i]);
    if (i % 12 == 11) emit(16);
  }
  emit(17);
  if (nb > 0) lz[ln++] = cur & 255;

  for (int f = 0; f < 2; f++) {
    b8(0x21); b8(0xF9); b8(4); b8(0x04); w16(100); b8(0); b8(0);
    b8(0x2C); w16(0); w16(0); w16(W); w16(H); b8(0); b8(4);
    for (size_t o = 0; o < ln; o += 255) {
      size_t k = min((size_t)255, ln - o);
      b8(k);
      memcpy(out + n, lz + o, k);
      n += k;
    }
    b8(0);
  }
  b8(0x3B);
  return n;
}

static void showRows(const String L[2], const String R[2]) {
  String key;
  for (int i = 0; i < 2; i++) key += L[i] + "|" + R[i] + "#";
  S.pendingKey = "";
  if (key == S.sentKey) return;  // nothing changed - do not touch the panel
  static uint8_t px[W * H];
  memset(px, 0, sizeof(px));
  const int y0[2] = {0, 9};
  for (int i = 0; i < 2; i++) {
    drawText(px, 0, y0[i], L[i]);
    drawText(px, W - textWidth(R[i]), y0[i], R[i]);
  }
  uint8_t* buf = (uint8_t*)malloc(2600);  // 4 extra bytes are needed for the random tail (Panel::sendGif)
  if (!buf) { plog("err", "MPK: out of memory"); return; }
  size_t len = buildGif(px, buf);
  S.pendingKey = key;
  g_mpkJob = true;
  queueJob(buf, len, true, "MPK " + L[0] + " " + R[0]);
  g_mpkJob = false;
}

void mpkLoop() {
  // result of the previous panel job
  if (S.pendingKey.length() && !jobPending && !jobRunning) {
    S.sentKey = lastOk ? S.pendingKey : "";
    S.pendingKey = "";
  }
  if (!S.en || apMode || WiFi.status() != WL_CONNECTED || jobPending || jobRunning) return;
  if (!S.due && (int32_t)(millis() - S.nextAt) < 0) return;
  S.due = false;
  S.nextAt = millis() + (uint32_t)S.iv * 1000;

  Dep d[2];
  int n = 0;
  bool ok = fetchDepartures(d, n);
  S.fetches++;
  if (!ok) {
    plog("err", "MPK: %s", S.err.c_str());
    return;  // keep showing the last departures
  }
  S.fetchedAt = millis();
  String L[2], R[2];
  for (int i = 0; i < 2; i++) {
    if (i < n) {
      L[i] = d[i].line;
      R[i] = d[i].min.length() ? d[i].min + " min" : d[i].time;
    } else if (i == 0) {
      L[i] = "NO DATA";
    }
  }
  for (int i = 0; i < 2; i++) { S.rowL[i] = L[i]; S.rowR[i] = R[i]; }
  plog("i", "MPK: %s - %d departure(s)", S.stopName.c_str(), n);
  showRows(L, R);
}

String mpkJson() {
  String s = "{\"en\":" + String(S.en ? "true" : "false") + ",\"stop\":\"" + S.stop + "\",\"lines\":\"" + S.lines + "\",\"dir\":\"" + S.dir +
             "\",\"iv\":" + S.iv + ",\"stop_name\":\"" + S.stopName + "\",\"err\":\"" + S.err + "\",\"fetches\":" + S.fetches +
             ",\"age_s\":" + (S.fetchedAt ? String((millis() - S.fetchedAt) / 1000) : String("null")) + ",\"rows\":[";
  for (int i = 0; i < 2; i++) {
    if (i) s += ',';
    s += "[\"" + S.rowL[i] + "\",\"" + S.rowR[i] + "\"]";
  }
  return s + "]}";
}
