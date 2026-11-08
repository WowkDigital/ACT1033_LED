// ESP32-C3 client: your Cloudflare Worker (HTTPS) -> BK-Light LED panel (BLE).
//
// Every `iv` seconds the ESP asks the Worker for the panel's current image (GET .../panel/<id>/image with a read token).
// The Worker answers 304 when nothing changed; otherwise the ESP uploads the new GIF/PNG to the panel over BLE.
// All rendering happens elsewhere (the control page in a browser, or the Worker's /render endpoint).
//
// USB serial commands (115200):
//   status | now | url <https://worker/panel/<id>/image> | token <read token> | addr <panel BLE address|auto>
//   iv <seconds> | wifi <ssid> <password> | wifireset
#include <Arduino.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_wifi.h>
#include <stdarg.h>

#include "log.h"
#include "panel.h"

static const uint32_t DEFAULT_IV = 30;  // seconds between checks
static const size_t MAX_IMG = 64 * 1024;

static Panel panel;
static Preferences prefs;
static String url, token, panelAddr;  // panelAddr "" = first LED_BLE_* device found
static uint32_t ivSec = DEFAULT_IV;
static bool due = true;
static uint32_t nextAt = 0, lastCrc = 0;
static bool haveLast = false;
static String lastEtag;  // ETag of the image the panel confirmed

void plog(const char* level, const char* fmt, ...) {
  char m[160];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(m, sizeof(m), fmt, ap);
  va_end(ap);
  Serial.printf("[%s] %s\n", level, m);
}

// ---------------- config (NVS) ----------------
static void loadConfig() {
  prefs.begin("cfg", false);  // read-write so the namespace exists on first boot
  url = prefs.getString("url", "");
  token = prefs.getString("token", "");
  panelAddr = prefs.getString("addr", "");
  ivSec = prefs.getUInt("iv", DEFAULT_IV);
  prefs.end();
}

static void saveConfig() {
  prefs.begin("cfg", false);
  prefs.putString("url", url);
  prefs.putString("token", token);
  prefs.putString("addr", panelAddr);
  prefs.putUInt("iv", ivSec);
  prefs.end();
}

// ---------------- Wi-Fi ----------------
static bool haveCreds() {
  prefs.begin("wifi", true);
  bool h = prefs.getString("ssid", "").length() > 0;
  prefs.end();
  return h;
}

static bool connectWifi() {
  prefs.begin("wifi", true);
  String ssid = prefs.getString("ssid", ""), pass = prefs.getString("pass", "");
  prefs.end();
  if (!ssid.length()) return false;
  WiFi.mode(WIFI_STA);
  wifi_country_t c = {"PL", 1, 13, 20, WIFI_COUNTRY_POLICY_MANUAL};  // channels 1-13
  esp_wifi_set_country(&c);
  WiFi.setAutoReconnect(true);
  WiFi.setMinSecurity(WIFI_AUTH_WPA2_PSK);  // WPA2/WPA3 routers: force WPA2
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  WiFi.begin(ssid.c_str(), pass.c_str());
  Serial.printf("Wi-Fi: connecting to '%s'", ssid.c_str());
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print('.'); }
  Serial.println();
  return WiFi.status() == WL_CONNECTED;
}

// ---------------- download ----------------
// Collects the HTTP body in a heap buffer (4 spare bytes for the random GIF tail).
class BufStream : public Stream {
 public:
  uint8_t* buf = nullptr;
  size_t len = 0, cap = 0;
  bool overflow = false;
  size_t write(uint8_t b) override { return write(&b, 1); }
  size_t write(const uint8_t* d, size_t n) override {
    if (len + n > MAX_IMG) { overflow = true; return 0; }
    if (len + n + 4 > cap) {
      size_t nc = max(cap * 2, len + n + 4 + 512);
      uint8_t* nb = (uint8_t*)realloc(buf, nc);
      if (!nb) { overflow = true; return 0; }
      buf = nb;
      cap = nc;
    }
    memcpy(buf + len, d, n);
    len += n;
    return n;
  }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
};

enum class Fetch { Failed, Unchanged, Image };

// One TLS connection is kept open between checks (keep-alive), so a 3 s check does not pay for a handshake each time.
static WiFiClientSecure tls;
static HTTPClient http;
static uint32_t serverPoll = 0;  // seconds the Worker asked us to wait before the next check (X-Poll-After), 0 = none

static Fetch download(uint8_t*& img, size_t& n, String& etag) {
  img = nullptr;
  n = 0;
  serverPoll = 0;
  int code = -1;
  uint32_t t0 = millis();
  for (int attempt = 1; attempt <= 2; attempt++) {  // a stale kept-alive connection fails once; then reconnect
    http.setReuse(true);
    http.setTimeout(10000);
    http.setConnectTimeout(8000);
    http.setUserAgent("ACT1033-ESP32");
    if (!http.begin(tls, url)) { plog("err", "bad URL"); return Fetch::Failed; }
    if (token.length()) http.addHeader("Authorization", "Bearer " + token);
    if (lastEtag.length()) http.addHeader("If-None-Match", lastEtag);
    const char* wanted[] = {"ETag", "X-Poll-After"};
    http.collectHeaders(wanted, 2);
    code = http.GET();
    if (code > 0) break;
    http.end();
    tls.stop();
  }
  if (code > 0) serverPoll = constrain(http.header("X-Poll-After").toInt(), 0, 300);
  if (code == 304) { http.end(); return Fetch::Unchanged; }
  if (code != 200) {
    plog("err", code == 401 ? "token rejected by the Worker (HTTP 401)" : code > 0 ? "worker returned HTTP %d" : "worker unreachable (%d)", code);
    http.end();
    if (code <= 0) tls.stop();
    return Fetch::Failed;
  }
  etag = http.header("ETag");
  BufStream bs;
  http.writeToStream(&bs);  // handles Content-Length and chunked bodies
  http.end();
  if (bs.overflow || bs.len < 8) {
    plog("err", bs.overflow ? "image larger than %u KB" : "empty response", (unsigned)(MAX_IMG / 1024));
    free(bs.buf);
    return Fetch::Failed;
  }
  plog("i", "Downloaded %u B in %u ms", (unsigned)bs.len, (unsigned)(millis() - t0));
  img = bs.buf;
  n = bs.len;
  return Fetch::Image;
}

// Returns false when something failed and a quick retry makes sense.
static bool cycle() {
  uint8_t* img;
  size_t n;
  String etag;
  Fetch r = download(img, n, etag);
  if (r == Fetch::Failed) return false;  // keep showing what is on the panel
  if (r == Fetch::Unchanged) { plog("i", "No change (304)"); return true; }
  uint32_t crc = crc32(img, n);
  if (haveLast && crc == lastCrc) {  // same bytes under a different/missing ETag
    plog("i", "Image unchanged - panel not touched");
    lastEtag = etag;
    free(img);
    return true;
  }
  bool ok = false;
  for (int attempt = 1; attempt <= 2 && !ok; attempt++) {
    if (attempt > 1) plog("i", "Retrying (2/2)");
    ok = panel.send(img, n);
  }
  free(img);
  if (ok) { lastCrc = crc; haveLast = true; lastEtag = etag; }
  return ok;
}

// ---------------- serial commands ----------------
static void printStatus() {
  Serial.printf("ip=%s rssi=%d heap=%u uptime=%us\nurl=%s\ntoken=%s panel=%s iv=%us\nlast_crc=%s etag=%s\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI(), (unsigned)ESP.getFreeHeap(), (unsigned)(millis() / 1000),
                url.length() ? url.c_str() : "(not set)", token.length() ? "set" : "(not set)",
                panelAddr.length() ? panelAddr.c_str() : "auto", (unsigned)ivSec,
                haveLast ? String(lastCrc, HEX).c_str() : "none", lastEtag.length() ? lastEtag.c_str() : "none");
}

static void refetch() { due = true; haveLast = false; lastEtag = ""; }

static void handleSerial() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c != '\n' && c != '\r') { line += c; continue; }
    line.trim();
    if (line == "status") printStatus();
    else if (line == "now") refetch();
    else if (line.startsWith("url ")) { url = line.substring(4); url.trim(); saveConfig(); refetch(); Serial.println("url saved"); }
    else if (line.startsWith("token ")) { token = line.substring(6); token.trim(); saveConfig(); refetch(); Serial.println("token saved"); }
    else if (line.startsWith("addr ")) {
      panelAddr = line.substring(5);
      panelAddr.trim();
      panelAddr.toLowerCase();
      if (panelAddr == "auto") panelAddr = "";
      saveConfig();
      Serial.println("panel address saved, restarting");
      delay(300);
      ESP.restart();
    }
    else if (line.startsWith("iv ")) { ivSec = constrain(line.substring(3).toInt(), 5, 3600); saveConfig(); Serial.printf("interval %us\n", (unsigned)ivSec); }
    else if (line == "wifireset") { prefs.begin("wifi", false); prefs.clear(); prefs.end(); Serial.println("cleared, restarting"); delay(300); ESP.restart(); }
    else if (line.startsWith("wifi ")) {
      String r = line.substring(5);
      int sp = r.indexOf(' ');
      prefs.begin("wifi", false);
      prefs.putString("ssid", sp < 0 ? r : r.substring(0, sp));
      prefs.putString("pass", sp < 0 ? "" : r.substring(sp + 1));
      prefs.end();
      Serial.println("saved, restarting");
      delay(300);
      ESP.restart();
    } else if (line.length())
      Serial.println("commands: status | now | url <image url> | token <read token> | addr <ble address|auto> | iv <seconds> | wifi <ssid> <password> | wifireset");
    line = "";
  }
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\n=== ESP32-C3 ACT1033_LED (Cloudflare client) ===");
  loadConfig();
  tls.setInsecure();  // the token still protects the content; the ESP has no certificate store
  panel.begin(panelAddr);
  if (connectWifi()) Serial.printf("Wi-Fi OK, IP %s\n", WiFi.localIP().toString().c_str());
  else Serial.println("No Wi-Fi. Set it with:  wifi <ssid> <password>");
  if (!url.length() || !token.length()) Serial.println("Not configured. Set:  url <https://worker/panel/<id>/image>   and   token <read token>");
  else Serial.printf("source: %s every %us\n", url.c_str(), (unsigned)ivSec);
}

void loop() {
  handleSerial();

  static uint32_t downSince = 0, hint = 0, lastLoggedPoll = 0xFFFFFFFF;
  if (WiFi.status() == WL_CONNECTED) {
    downSince = 0;
    if (!url.length() || !token.length()) {
      if (millis() - hint > 15000) { hint = millis(); Serial.println("Not configured: set url and token (see 'help')."); }
    } else if (due || (int32_t)(millis() - nextAt) >= 0) {
      due = false;
      bool ok = cycle();
      // The Worker decides: a few seconds right after a change (more edits likely), `iv` when idle. 10 s retry on errors.
      uint32_t wait = !ok ? min<uint32_t>(ivSec, 10) : serverPoll ? serverPoll : ivSec;
      nextAt = millis() + wait * 1000;
      if (ok && serverPoll != lastLoggedPoll) { lastLoggedPoll = serverPoll; plog("i", "Worker asks for a check every %u s", (unsigned)wait); }
    }
  } else if (haveCreds()) {
    if (!downSince) downSince = millis();
    else if (millis() - downSince > 120000) ESP.restart();  // Wi-Fi lost for too long
  } else if (millis() - hint > 10000) {
    hint = millis();
    Serial.println("No Wi-Fi credentials. Set them with:  wifi <ssid> <password>");
  }
  delay(5);
}
