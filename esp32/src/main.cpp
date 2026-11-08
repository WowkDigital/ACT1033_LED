// ESP32-C3 bridge: Cloudflare render Worker (HTTPS) -> BK-Light LED panel (BLE).
//
// Every `iv` seconds the ESP downloads a finished PNG/GIF from the configured URL and, when it differs from what the
// panel already shows, uploads it over BLE. All rendering happens in the Worker (see ../cloudflare).
//
// USB serial commands (115200):  status | now | url <https://...> | iv <seconds> | wifi <ssid> <password> | wifireset
#include <Arduino.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_wifi.h>
#include <stdarg.h>

#include "log.h"
#include "panel.h"

static const char* PANEL_ADDR = "aa:bb:cc:dd:ee:ff";  // "" = first LED_BLE_* device found
static const char* DEFAULT_URL =
    "https://act1033-led.wowk-digital.workers.dev/render?text=Hello%20from%20Cloudflare&format=gif&anim=scroll&color=00ff00";
static const uint32_t DEFAULT_IV = 30;  // seconds between downloads
static const size_t MAX_IMG = 64 * 1024;

static Panel panel;
static Preferences prefs;
static String url;
static uint32_t ivSec = DEFAULT_IV;
static bool due = true;
static uint32_t nextAt = 0, lastCrc = 0;
static bool haveLast = false;

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
  prefs.begin("cfg", true);
  url = prefs.getString("url", DEFAULT_URL);
  ivSec = prefs.getUInt("iv", DEFAULT_IV);
  prefs.end();
}

static void saveConfig() {
  prefs.begin("cfg", false);
  prefs.putString("url", url);
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

static uint8_t* download(size_t& n) {
  n = 0;
  WiFiClientSecure client;
  client.setInsecure();  // public, read-only graphics; the ESP has no certificate store
  HTTPClient http;
  http.setTimeout(10000);
  http.setConnectTimeout(8000);
  http.setUserAgent("ACT1033-ESP32");
  if (!http.begin(client, url)) { plog("err", "bad URL"); return nullptr; }
  uint32_t t0 = millis();
  int code = http.GET();
  if (code != 200) {
    plog("err", code > 0 ? "worker returned HTTP %d" : "worker unreachable (%d)", code);
    http.end();
    return nullptr;
  }
  BufStream bs;
  http.writeToStream(&bs);  // handles Content-Length and chunked bodies
  http.end();
  if (bs.overflow || bs.len < 8) {
    plog("err", bs.overflow ? "image larger than %u KB" : "empty response", (unsigned)(MAX_IMG / 1024));
    free(bs.buf);
    return nullptr;
  }
  plog("i", "Downloaded %u B in %u ms", (unsigned)bs.len, (unsigned)(millis() - t0));
  n = bs.len;
  return bs.buf;
}

static void cycle() {
  size_t n;
  uint8_t* img = download(n);
  if (!img) return;  // keep showing what is on the panel
  uint32_t crc = crc32(img, n);
  if (haveLast && crc == lastCrc) {
    plog("i", "Image unchanged - panel not touched");
    free(img);
    return;
  }
  bool ok = false;
  for (int attempt = 1; attempt <= 2 && !ok; attempt++) {
    if (attempt > 1) plog("i", "Retrying (2/2)");
    ok = panel.send(img, n);
  }
  free(img);
  if (ok) { lastCrc = crc; haveLast = true; }
}

// ---------------- serial commands ----------------
static void printStatus() {
  Serial.printf("ip=%s rssi=%d heap=%u uptime=%us\nurl=%s\niv=%us last_crc=%s\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI(), (unsigned)ESP.getFreeHeap(), (unsigned)(millis() / 1000),
                url.c_str(), (unsigned)ivSec, haveLast ? String(lastCrc, HEX).c_str() : "none");
}

static void handleSerial() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c != '\n' && c != '\r') { line += c; continue; }
    line.trim();
    if (line == "status") printStatus();
    else if (line == "now") { due = true; haveLast = false; }
    else if (line.startsWith("url ")) { url = line.substring(4); url.trim(); saveConfig(); due = true; haveLast = false; Serial.println("url saved"); }
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
    } else if (line.length()) Serial.println("commands: status | now | url <https://...> | iv <seconds> | wifi <ssid> <password> | wifireset");
    line = "";
  }
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\n=== ESP32-C3 ACT1033_LED (Cloudflare client) ===");
  loadConfig();
  panel.begin(PANEL_ADDR);
  if (connectWifi()) Serial.printf("Wi-Fi OK, IP %s\nsource: %s every %us\n", WiFi.localIP().toString().c_str(), url.c_str(), (unsigned)ivSec);
  else Serial.println("No Wi-Fi. Set it with:  wifi <ssid> <password>");
}

void loop() {
  handleSerial();

  static uint32_t downSince = 0, hint = 0;
  if (WiFi.status() == WL_CONNECTED) {
    downSince = 0;
    if (due || (int32_t)(millis() - nextAt) >= 0) {
      due = false;
      nextAt = millis() + ivSec * 1000;
      cycle();
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
