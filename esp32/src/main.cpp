// ESP32-C3 <-> BK-Light LED panel.
// - Wi-Fi: credentials stored in NVS; none/invalid -> setup portal (AP "ESP-Panel-setup", password "panel-setup", http://192.168.4.1)
// - HTTP server (port 80): control page with a live log
//     GET /  | GET /status?since=N | GET /demo?n=a|b | GET /demo.gif?n=a|b | POST /gif (multipart) |
//     GET /bench | GET /stop | POST /reboot | GET /font.js
// - USB serial: a | b | status | wifi <ssid> <password> | wifireset
#include <Arduino.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <stdarg.h>

#include "font_js.h"
#include "gifs.h"
#include "log.h"
#include "panel.h"
#include "png.h"
#include "web.h"

static const char* PANEL_ADDR = "aa:bb:cc:dd:ee:ff";  // "" = first LED_BLE_* device found
static const char* HOSTNAME = "panel";                 // http://panel.local
static const size_t MAX_GIF = 64 * 1024;
static const char* FW = __DATE__ " " __TIME__;

Panel panel;
WebServer server(80);
Preferences prefs;
bool apMode = false;

// ---------------- log + job state ----------------
struct LogEntry { uint32_t seq, t; char l[4]; char m[110]; };
static LogEntry logBuf[40];
static uint32_t logSeq = 0;

static String phase = "idle";
static int phasePct = 0;
static int errStep = 0;
int g_panelRssi = 0;
uint32_t g_panelSeenAt = 0;

static int stepIndex(const String& p) {
  const char* s[] = {"scan", "connect", "handshake", "send", "confirm"};
  for (int i = 0; i < 5; i++) if (p == s[i]) return i;
  return 0;
}

void setPhase(const char* p, int pct) {
  if (String(p) == "error") errStep = stepIndex(phase);
  phase = p;
  phasePct = pct;
}

void plog(const char* level, const char* fmt, ...) {
  LogEntry& e = logBuf[logSeq % 40];
  e.seq = ++logSeq;
  e.t = millis();
  strlcpy(e.l, level, sizeof(e.l));
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(e.m, sizeof(e.m), fmt, ap);
  va_end(ap);
  for (char* c = e.m; *c; c++) if (*c == '"' || *c == '\\' || (uint8_t)*c < 32) *c = '\'';
  Serial.printf("[%s] %s\n", e.l, e.m);
}

void panelTick() { server.handleClient(); }

// ---------------- single BLE job queue ----------------
uint8_t* jobBuf = nullptr;
size_t jobLen = 0;
bool jobOwned = false, jobPending = false, jobRunning = false, jobBench = false;
String jobName = "";
bool lastOk = false;
String lastMsg = "";
uint32_t lastResultAt = 0, jobCount = 0;

uint8_t* upBuf = nullptr;
size_t upLen = 0;
bool upErr = false, upBusy = false;
String upName = "";

volatile bool g_stopReq = false;

// ---------------- Game of Life 32x8 (2x2 px cells) + PNG stream benchmark ----------------
struct Life {
  uint8_t c[8][32];
  uint32_t gen = 0, hist[4] = {0, 0, 0, 0};
  void seed() {
    for (auto& r : c) for (auto& v : r) v = (esp_random() % 100) < 30;
    gen = 0;
    for (auto& h : hist) h = 0;
  }
  uint32_t hash() const {
    uint32_t h = 2166136261u;
    for (auto& r : c) for (auto v : r) h = (h ^ v) * 16777619u;
    return h;
  }
  int alive() const { int n = 0; for (auto& r : c) for (auto v : r) n += v; return n; }
  void step() {
    uint8_t n[8][32];
    for (int y = 0; y < 8; y++)
      for (int x = 0; x < 32; x++) {
        int s = 0;
        for (int dy = -1; dy <= 1; dy++)
          for (int dx = -1; dx <= 1; dx++)
            if (dx || dy) s += c[(y + dy + 8) & 7][(x + dx + 32) & 31];
        n[y][x] = c[y][x] ? (s == 2 || s == 3) : (s == 3);
      }
    memcpy(c, n, sizeof(c));
    gen++;
  }
  bool stale() {  // stagnation / oscillator with period <= 4 -> reseed
    uint32_t h = hash();
    for (auto v : hist) if (v == h) return true;
    hist[gen & 3] = h;
    return false;
  }
  void renderRgb(uint8_t* out) const {  // 64x16x3
    for (int py = 0; py < 16; py++)
      for (int px = 0; px < 64; px++) {
        bool on = c[py >> 1][px >> 1];
        uint8_t* p = out + (py * 64 + px) * 3;
        p[0] = 0; p[1] = on ? 160 : 0; p[2] = 0;
      }
  }
  void renderBits(uint8_t* out) const {  // 16 rows x 8 bytes, MSB first
    memset(out, 0, 16 * 8);
    for (int py = 0; py < 16; py++)
      for (int px = 0; px < 64; px++)
        if (c[py >> 1][px >> 1]) out[py * 8 + (px >> 3)] |= 0x80 >> (px & 7);
  }
};

static uint8_t pngBuf[3300];
static uint8_t rgbBuf[64 * 16 * 3];
static uint8_t bitBuf[16 * 8];

String benchMode = "both";
uint32_t benchSec = 10, benchGap = 10;

static void runStreamTest(bool idx) {
  Life life;
  life.seed();
  static const uint8_t PAL[6] = {0, 0, 0, 0, 160, 0};
  uint32_t t0 = millis(), frames = 0, fails = 0, ackSum = 0, ackMin = 99999, ackMax = 0, bytes = 0, reseeds = 0;
  uint32_t lastPct = 0;
  while (millis() - t0 < benchSec * 1000 && !g_stopReq) {
    size_t n;
    if (idx) { life.renderBits(bitBuf); n = pngIdx1(bitBuf, 64, 16, PAL, pngBuf); }
    else { life.renderRgb(rgbBuf); n = pngRgb(rgbBuf, 64, 16, pngBuf); }
    uint32_t ack = 0;
    bool ok = panel.streamFrame(pngBuf, n, benchGap, &ack);
    if (ok) { frames++; ackSum += ack; ackMin = min(ackMin, ack); ackMax = max(ackMax, ack); bytes += n; }
    else { fails++; if (!panel.connected()) { plog("err", "BLE connection lost during the stream"); break; } }
    if (frames % 30 == 29) panel.streamValidate();
    life.step();
    if (life.stale() || life.alive() == 0) { life.seed(); reseeds++; }
    uint32_t pct = 40 + 55 * (millis() - t0) / (benchSec * 1000);
    if (pct != lastPct) { setPhase("send", pct > 95 ? 95 : pct); lastPct = pct; }
  }
  float sec = (millis() - t0) / 1000.0f;
  plog(fails ? "err" : "ok", "%s: %u frames in %.1f s = %.1f fps | ack avg/min/max %u/%u/%u ms | %u B/frame | errors %u | reseeds %u",
       idx ? "PNG 1-bit" : "PNG RGB", (unsigned)frames, sec, frames / sec, frames ? (unsigned)(ackSum / frames) : 0,
       frames ? (unsigned)ackMin : 0, (unsigned)ackMax, frames ? (unsigned)(bytes / frames) : 0, (unsigned)fails, (unsigned)reseeds);
}

static bool runBench() {
  g_stopReq = false;
  setPhase("scan", 0);
  plog("i", "Stream test: mode=%s, %u s per variant, packet gap %u ms", benchMode.c_str(), (unsigned)benchSec, (unsigned)benchGap);
  if (!panel.streamBegin()) { plog("err", "Could not connect to the panel"); setPhase("error", 0); return false; }
  g_quietNotif = true;
  setPhase("send", 40);
  if (benchMode == "rgb" || benchMode == "both") runStreamTest(false);
  if ((benchMode == "idx" || benchMode == "both") && !g_stopReq && panel.connected()) runStreamTest(true);
  g_quietNotif = false;
  panel.streamEnd();
  setPhase("done", 100);
  return true;
}

void setCountryEU() {
  // Channels 1-13 (the ESP default is 1-11 only; some routers use channel 13).
  wifi_country_t c = {"PL", 1, 13, 20, WIFI_COUNTRY_POLICY_MANUAL};
  esp_wifi_set_country(&c);
}

void queueJob(uint8_t* buf, size_t len, bool owned, const String& name) {
  jobBuf = buf; jobLen = len; jobOwned = owned; jobName = name; jobPending = true;
  setPhase("scan", 0);
  plog("i", "Job '%s' queued (%u B)", name.c_str(), (unsigned)len);
}

String statusJson(uint32_t since) {
  String s;
  s.reserve(6000);
  s += "{\"ip\":\"" + WiFi.localIP().toString() + "\",\"ssid\":\"" + WiFi.SSID() + "\",\"rssi\":" + WiFi.RSSI();
  s += ",\"uptime_s\":" + String(millis() / 1000) + ",\"heap\":" + ESP.getFreeHeap() + ",\"fw\":\"" + FW + "\",\"jobs\":" + jobCount;
  s += ",\"panel\":{\"addr\":\"" + panel.address() + "\",\"rssi\":" + g_panelRssi + ",\"seen_s\":";
  s += g_panelSeenAt ? String((millis() - g_panelSeenAt) / 1000) : String("null");
  s += "},\"job\":{\"running\":" + String(jobRunning ? "true" : "false") + ",\"pending\":" + String(jobPending ? "true" : "false");
  s += ",\"phase\":\"" + phase + "\",\"pct\":" + phasePct + ",\"name\":\"" + jobName + "\"}";
  s += ",\"err_step\":" + String(errStep);
  s += ",\"last\":{\"ok\":" + String(lastOk ? "true" : "false") + ",\"msg\":\"" + lastMsg + "\",\"ago_s\":" +
       String(lastResultAt ? (millis() - lastResultAt) / 1000 : 0) + "}";
  s += ",\"seq\":" + String(logSeq) + ",\"log\":[";
  uint32_t from = logSeq > 40 ? logSeq - 40 : 0;
  if (since > from) from = since;
  bool first = true;
  for (uint32_t q = from; q < logSeq; q++) {
    const LogEntry& e = logBuf[q % 40];
    if (!first) s += ',';
    first = false;
    s += "{\"i\":" + String(e.seq) + ",\"t\":" + e.t + ",\"l\":\"" + e.l + "\",\"m\":\"" + e.m + "\"}";
  }
  s += "]}";
  return s;
}

void sendJson(int code, const String& body) {
  server.sendHeader("Cache-Control", "no-store");
  server.send(code, "application/json", body);
}

void setupHttp() {
  server.on("/", HTTP_GET, [] { server.send_P(200, "text/html; charset=utf-8", PAGE); });
  server.on("/font.js", HTTP_GET, [] { server.send_P(200, "application/javascript; charset=utf-8", FONT_JS); });
  server.on("/status", HTTP_GET, [] {
    sendJson(200, statusJson(server.hasArg("since") ? (uint32_t)server.arg("since").toInt() : 0));
  });
  server.on("/demo.gif", HTTP_GET, [] {
    String n = server.arg("n");
    if (n == "a") server.send_P(200, "image/gif", (const char*)GIF_A, GIF_A_len);
    else if (n == "b") server.send_P(200, "image/gif", (const char*)GIF_B, GIF_B_len);
    else server.send(404, "text/plain", "n=a|b");
  });
  server.on("/demo", HTTP_GET, [] {
    if (jobPending || jobRunning) return sendJson(409, "{\"error\":\"panel is busy\"}");
    String n = server.arg("n");
    if (n == "a") queueJob((uint8_t*)GIF_A, GIF_A_len, false, "animation A");
    else if (n == "b") queueJob((uint8_t*)GIF_B, GIF_B_len, false, "animation B");
    else return sendJson(400, "{\"error\":\"n=a|b\"}");
    sendJson(202, "{\"ok\":true}");
  });
  server.on("/bench", HTTP_GET, [] {
    if (jobPending || jobRunning) return sendJson(409, "{\"error\":\"panel is busy\"}");
    String m = server.arg("mode");
    benchMode = (m == "rgb" || m == "idx") ? m : "both";
    benchSec = constrain(server.hasArg("sec") ? server.arg("sec").toInt() : 10, 3, 60);
    benchGap = constrain(server.hasArg("gap") ? server.arg("gap").toInt() : 10, 0, 50);
    jobBench = true;
    queueJob(nullptr, 0, false, "stream test");
    sendJson(202, "{\"ok\":true}");
  });
  server.on("/stop", HTTP_GET, [] { g_stopReq = true; sendJson(200, "{\"ok\":true}"); });
  server.on("/reboot", HTTP_POST, [] {
    sendJson(200, "{\"ok\":true}");
    delay(300);
    ESP.restart();
  });
  server.on(
      "/gif", HTTP_POST,
      [] {
        bool busy = upBusy || jobPending || jobRunning;
        bool ok = !busy && upBuf && !upErr && upLen > 6 && memcmp(upBuf, "GIF8", 4) == 0;
        if (busy) sendJson(409, "{\"error\":\"panel is busy\"}");
        else if (!ok) sendJson(400, String("{\"error\":\"") + (upErr ? "file too large or out of memory" : "not a GIF file") + "\"}");
        else {
          queueJob(upBuf, upLen, true, upName);
          upBuf = nullptr; upLen = 0;
          sendJson(202, "{\"ok\":true}");
        }
        free(upBuf); upBuf = nullptr; upLen = 0; upBusy = false;
      },
      [] {
        HTTPUpload& u = server.upload();
        if (u.status == UPLOAD_FILE_START) {
          free(upBuf); upBuf = nullptr; upLen = 0; upErr = false;
          upName = u.filename;
          upBusy = jobPending || jobRunning;
          if (upBusy) return;
          upBuf = (uint8_t*)malloc(MAX_GIF + 4);  // +4 B for the random tail (see Panel::sendGif)
          if (!upBuf) upErr = true;
        } else if (u.status == UPLOAD_FILE_WRITE) {
          if (upBusy || !upBuf) return;
          if (upLen + u.currentSize <= MAX_GIF) { memcpy(upBuf + upLen, u.buf, u.currentSize); upLen += u.currentSize; }
          else upErr = true;
        }
      });
  server.begin();
}

void setupPortal() {
  apMode = true;
  WiFi.disconnect(true);
  WiFi.mode(WIFI_STA);
  setCountryEU();
  int n = WiFi.scanNetworks();  // scan before the AP starts (in AP+STA mode it can come back empty)
  Serial.printf("Wi-Fi scan: %d networks\n", n);
  WiFi.mode(WIFI_AP_STA);
  bool ap = WiFi.softAP("ESP-Panel-setup", "panel-setup", 1);
  Serial.printf("softAP=%d ip=%s\n", ap, WiFi.softAPIP().toString().c_str());
  String opts;
  for (int i = 0; i < n; i++) {
    opts += "<option value=\"" + WiFi.SSID(i) + "\">";
    Serial.printf("  network: '%s' ch=%d rssi=%d\n", WiFi.SSID(i).c_str(), WiFi.channel(i), WiFi.RSSI(i));
  }
  Serial.println("SETUP MODE: network 'ESP-Panel-setup', password 'panel-setup', http://192.168.4.1");
  server.on("/", HTTP_GET, [opts] {
    String p = FPSTR(SETUP_PAGE);
    p.replace("%NETS%", opts);
    server.send(200, "text/html; charset=utf-8", p);
  });
  server.on("/save", HTTP_POST, [] {
    prefs.begin("wifi", false);
    prefs.putString("ssid", server.arg("ssid"));
    prefs.putString("pass", server.arg("pass"));
    prefs.end();
    server.send(200, "text/html; charset=utf-8", "<meta charset=utf-8>Saved. The device is restarting - try http://panel.local in a moment.");
    delay(1500);
    ESP.restart();
  });
  server.onNotFound([] { server.sendHeader("Location", "http://192.168.4.1/"); server.send(302); });
  server.begin();
}

bool connectWifi() {
  prefs.begin("wifi", true);
  String ssid = prefs.getString("ssid", ""), pass = prefs.getString("pass", "");
  prefs.end();
  if (!ssid.length()) return false;
  WiFi.mode(WIFI_STA);
  setCountryEU();
  WiFi.setHostname(HOSTNAME);
  WiFi.setAutoReconnect(true);
  WiFi.onEvent([](arduino_event_id_t, arduino_event_info_t info) {
    Serial.printf("\n[wifi] disconnected, reason=%d\n", info.wifi_sta_disconnected.reason);
  }, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
  WiFi.setMinSecurity(WIFI_AUTH_WPA2_PSK);  // WPA2/WPA3 + Wi-Fi 7 routers: force WPA2
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  WiFi.begin(ssid.c_str(), pass.c_str());
  Serial.printf("Wi-Fi: connecting to '%s'", ssid.c_str());
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print('.'); }
  Serial.println();
  return WiFi.status() == WL_CONNECTED;
}

void handleSerial() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c != '\n' && c != '\r') { line += c; continue; }
    line.trim();
    if (line == "a" && !jobPending) queueJob((uint8_t*)GIF_A, GIF_A_len, false, "animation A");
    else if (line == "b" && !jobPending) queueJob((uint8_t*)GIF_B, GIF_B_len, false, "animation B");
    else if (line == "status") Serial.println(statusJson(0));
    else if (line == "wifireset") { prefs.begin("wifi", false); prefs.clear(); prefs.end(); Serial.println("cleared, restarting"); delay(300); ESP.restart(); }
    else if (line.startsWith("wifi ")) {
      String r = line.substring(5); int sp = r.indexOf(' ');
      prefs.begin("wifi", false);
      prefs.putString("ssid", sp < 0 ? r : r.substring(0, sp));
      prefs.putString("pass", sp < 0 ? "" : r.substring(sp + 1));
      prefs.end();
      Serial.println("saved, restarting"); delay(300); ESP.restart();
    } else if (line.length()) Serial.println("commands: a | b | status | wifi <ssid> <password> | wifireset");
    line = "";
  }
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\n=== ESP32-C3 ACT1033_LED ===");
  panel.begin(PANEL_ADDR);
  if (connectWifi()) {
    Serial.printf("Wi-Fi OK, IP %s\n", WiFi.localIP().toString().c_str());
    if (MDNS.begin(HOSTNAME)) { MDNS.addService("http", "tcp", 80); Serial.println("http://panel.local"); }
    setupHttp();
    plog("i", "System started, IP %s", WiFi.localIP().toString().c_str());
  } else {
    setupPortal();
  }
}

void loop() {
  server.handleClient();
  handleSerial();
  if (jobPending) {
    jobPending = false;
    jobRunning = true;
    uint32_t t0 = millis();
    bool ok = false;
    if (jobBench) {
      ok = runBench();
      jobBench = false;
    } else {
      for (int attempt = 1; attempt <= 2 && !ok; attempt++) {
        if (attempt > 1) plog("i", "Retrying (2/2)");
        ok = panel.sendGif(jobBuf, jobLen, jobOwned ? jobBuf : nullptr);
      }
    }
    if (jobOwned) free(jobBuf);
    jobBuf = nullptr; jobOwned = false;
    uint32_t sec = (millis() - t0) / 1000;
    lastOk = ok;
    lastMsg = ok ? "OK, " + String(sec) + " s" : "Failed (no confirmation from the panel)";
    lastResultAt = millis(); jobCount++; jobRunning = false;
    if (ok) plog("ok", "Finished in %u s", (unsigned)sec);
    else plog("err", "Job failed after %u s", (unsigned)sec);
  }
  // In setup mode with saved credentials (the network was only temporarily unreachable), retry every 2 minutes
  // unless somebody is connected to the setup access point.
  static bool haveCreds = [] {
    prefs.begin("wifi", true);
    bool h = prefs.getString("ssid", "").length() > 0;
    prefs.end();
    return h;
  }();
  if (apMode && haveCreds && millis() > 120000 && WiFi.softAPgetStationNum() == 0) ESP.restart();

  // Wi-Fi lost for too long -> restart (it will reconnect or fall back to the setup portal)
  static uint32_t downSince = 0;
  if (!apMode && WiFi.status() != WL_CONNECTED) {
    if (!downSince) downSince = millis();
    else if (millis() - downSince > 120000) ESP.restart();
  } else downSince = 0;
  delay(2);
}
