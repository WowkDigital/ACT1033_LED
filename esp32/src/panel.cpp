#include "panel.h"

#include "log.h"

static const char* UUID_WRITE = "0000fa02-0000-1000-8000-00805f9b34fb";
static const char* UUID_NOTIFY = "0000fa03-0000-1000-8000-00805f9b34fb";
static const uint8_t HS1[] = {0x08, 0x00, 0x01, 0x80, 0x0E, 0x06, 0x32, 0x00};
static const uint8_t HS2[] = {0x04, 0x00, 0x05, 0x80};

static volatile bool fStage1, fStage2, fAck, fDone;

// Notifications arrive on the NimBLE task; they are logged later from the main task.
static char nq[8][40];
static volatile uint8_t nqHead = 0, nqTail = 0;

static void flushNotifs() {
  while (nqTail != nqHead) {
    plog("i", "panel: %s", nq[nqTail & 7]);
    nqTail = (nqTail + 1) & 15;
  }
}

static void tickDelay(uint32_t ms) {
  uint32_t t = millis();
  do {
    panelTick();
    flushNotifs();
    delay(2);
  } while (millis() - t < ms);
}

static uint32_t crc32(const uint8_t* d, size_t n) {
  uint32_t c = 0xFFFFFFFF;
  for (size_t i = 0; i < n; i++) {
    c ^= d[i];
    for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c;
}

volatile bool g_quietNotif = false;  // while streaming, do not log every confirmation

static void onNotify(NimBLERemoteCharacteristic*, uint8_t* d, size_t n, bool) {
  if (!g_quietNotif) {
    char* b = nq[nqHead & 7];
    size_t o = 0;
    for (size_t i = 0; i < n && o + 3 < 40; i++) o += snprintf(b + o, 40 - o, "%02X ", d[i]);
    nqHead = (nqHead + 1) & 15;
  }
  if (n >= 4 && d[2] == 0x01 && d[3] == 0x80) fStage1 = true;
  else if (n >= 4 && d[2] == 0x05 && d[3] == 0x80) fStage2 = true;
  else if (n == 5 && d[3] == 0x00) {
    fAck = true;
    if (d[4] == 0x03) fDone = true;  // 05 00 03 00 03 = GIF complete, 05 00 02 00 03 = PNG frame accepted
  }
}

class ScanCb : public NimBLEAdvertisedDeviceCallbacks {
 public:
  String addr;
  NimBLEAdvertisedDevice dev;
  volatile bool found = false;
  void onResult(NimBLEAdvertisedDevice* d) override {
    if (found) return;
    String a = String(d->getAddress().toString().c_str());
    String nm = String(d->getName().c_str());
    bool match = addr.length() ? (a == addr) : nm.startsWith("LED_BLE");
    if (match) {
      dev = *d;
      found = true;
      NimBLEDevice::getScan()->stop();
    }
  }
};
static ScanCb scanCb;
static void scanDone(NimBLEScanResults) {}

void Panel::begin(const String& address) {
  addr_ = address;
  addr_.toLowerCase();
  NimBLEDevice::init("");
  NimBLEDevice::setMTU(512);
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);  // maximum TX power
}

bool Panel::waitFlag(volatile bool& f, uint32_t ms) {
  uint32_t t = millis();
  while (!f && millis() - t < ms) tickDelay(5);
  return f;
}

bool Panel::findPanel(NimBLEAdvertisedDevice& out) {
  NimBLEScan* scan = NimBLEDevice::getScan();
  scan->setAdvertisedDeviceCallbacks(&scanCb, false);
  scan->setActiveScan(true);
  scan->setInterval(100);
  scan->setWindow(99);
  scanCb.addr = addr_;
  for (int attempt = 1; attempt <= 2; attempt++) {
    scanCb.found = false;
    scan->clearResults();
    plog("i", "Scanning BLE (%d/2)...", attempt);
    scan->start(8, scanDone, false);
    uint32_t t = millis();
    while (scan->isScanning() && !scanCb.found && millis() - t < 9000) tickDelay(20);
    if (scan->isScanning()) scan->stop();
    tickDelay(100);
    if (scanCb.found) {
      out = scanCb.dev;
      g_panelRssi = out.getRSSI();
      g_panelSeenAt = millis();
      plog("i", "Panel found: %s (RSSI %d dBm)", out.getAddress().toString().c_str(), g_panelRssi);
      scan->clearResults();
      return true;
    }
    plog("err", "Panel not visible - is it powered on, nearby and not connected to a phone?");
  }
  return false;
}

bool Panel::connect() {
  setPhase("scan", 5);
  NimBLEAdvertisedDevice dev;
  if (!findPanel(dev)) return false;

  setPhase("connect", 22);
  cli_ = NimBLEDevice::createClient();
  cli_->setConnectTimeout(6);
  bool conn = false;
  for (int t = 1; t <= 3 && !conn; t++) {
    plog("i", "Connecting to the panel (attempt %d/3)...", t);
    panelTick();
    conn = cli_->connect(&dev);
    if (!conn) plog("err", "Connection failed (attempt %d)", t);
  }
  if (!conn) {
    NimBLEDevice::deleteClient(cli_);
    cli_ = nullptr;
    return false;
  }
  cli_->updateConnParams(6, 12, 0, 400);  // 7.5-15 ms interval (shorter confirmations when streaming)
  tickDelay(300);
  uint16_t mtu = cli_->getMTU();
  chunk_ = min<size_t>(509, mtu > 3 ? mtu - 3 : 20);
  plog("i", "Connected, MTU %u, chunk %u B", mtu, (unsigned)chunk_);

  NimBLERemoteCharacteristic* nf = nullptr;
  wr_ = nullptr;
  for (auto* s : *cli_->getServices(true)) {
    if (!wr_) wr_ = s->getCharacteristic(NimBLEUUID(UUID_WRITE));
    if (!nf) nf = s->getCharacteristic(NimBLEUUID(UUID_NOTIFY));
  }
  if (!wr_ || !nf) {
    plog("err", "fa02/fa03 characteristics not found - is this really a BK-Light panel?");
    disconnect();
    return false;
  }
  // The CCCD write must be acknowledged - otherwise the panel sends no notifications.
  if (!nf->subscribe(true, onNotify, true)) plog("err", "Notification subscribe failed");
  tickDelay(300);
  return true;
}

void Panel::disconnect() {
  if (cli_) {
    cli_->disconnect();
    NimBLEDevice::deleteClient(cli_);
    cli_ = nullptr;
  }
  wr_ = nullptr;
}

bool Panel::writeChunked(const uint8_t* data, size_t len, size_t base, size_t total) {
  for (size_t o = 0; o < len; o += chunk_) {
    size_t n = min(chunk_, len - o);
    int tries = 0;
    while (!wr_->writeValue(data + o, n, false)) {
      if (++tries > 200 || !cli_->isConnected()) return false;
      tickDelay(5);
    }
    setPhase("send", 40 + (int)(55UL * (base + o + n) / total));
    tickDelay(10);
  }
  return true;
}

bool Panel::handshake() {
  setPhase("handshake", 32);
  plog("i", "Handshake...");
  wr_->writeValue(HS1, sizeof(HS1), false);
  if (!waitFlag(fStage1, 5000)) plog("err", "handshake 1: no reply (continuing)");
  tickDelay(200);
  wr_->writeValue(HS2, sizeof(HS2), false);
  if (!waitFlag(fStage2, 5000)) plog("err", "handshake 2: no reply (continuing)");
  tickDelay(200);
  return true;
}

bool Panel::streamBegin() {
  fStage1 = fStage2 = fAck = fDone = false;
  nqHead = nqTail = 0;
  if (!connect()) return false;
  handshake();
  sbufCap_ = 4096 + 64;
  free(sbuf_);
  sbuf_ = (uint8_t*)malloc(sbufCap_);
  if (!sbuf_) { plog("err", "Out of memory for the frame buffer"); disconnect(); return false; }
  return true;
}

bool Panel::streamFrame(const uint8_t* png, size_t n, uint32_t gapMs, uint32_t* ackMs) {
  if (!connected() || !sbuf_ || n + 15 > sbufCap_) return false;
  uint16_t total = n + 15;
  uint32_t crc = crc32(png, n);
  sbuf_[0] = total & 0xFF; sbuf_[1] = total >> 8;
  sbuf_[2] = 0x02; sbuf_[3] = 0x00; sbuf_[4] = 0x00;     // type 0x02 = PNG
  sbuf_[5] = n & 0xFF; sbuf_[6] = n >> 8; sbuf_[7] = 0; sbuf_[8] = 0;
  memcpy(sbuf_ + 9, &crc, 4);
  sbuf_[13] = 0x00; sbuf_[14] = 0x65;
  memcpy(sbuf_ + 15, png, n);
  fDone = false;
  uint32_t t0 = millis();
  for (size_t o = 0; o < total; o += chunk_) {
    size_t c = min(chunk_, (size_t)total - o);
    int tries = 0;
    while (!wr_->writeValue(sbuf_ + o, c, false)) {
      if (++tries > 200 || !connected()) return false;
      tickDelay(2);
    }
    if (gapMs) tickDelay(gapMs); else panelTick();
  }
  while (!fDone && millis() - t0 < 2000) tickDelay(1);
  if (ackMs) *ackMs = millis() - t0;
  return fDone;
}

void Panel::streamValidate() {
  static const uint8_t V[] = {0x05, 0x00, 0x00, 0x01, 0x00};
  if (connected()) wr_->writeValue(V, sizeof(V), false);
}

void Panel::streamEnd() {
  tickDelay(300);
  disconnect();
  free(sbuf_);
  sbuf_ = nullptr;
}

bool Panel::sendGif(const uint8_t* src, size_t srcLen, uint8_t* scratch) {
  // The panel recognises an identical file and corrupts the animation -> 4 random bytes after the GIF trailer.
  size_t len = srcLen + 4;
  uint8_t* gif;
  bool own = false;
  if (scratch) {
    gif = scratch;
  } else {
    gif = (uint8_t*)malloc(len);
    if (!gif) { plog("err", "Out of memory"); setPhase("error", 0); return false; }
    memcpy(gif, src, srcLen);
    own = true;
  }
  uint32_t r = esp_random();
  memcpy(gif + srcLen, &r, 4);
  uint32_t crc = crc32(gif, len);

  fStage1 = fStage2 = fAck = fDone = false;
  nqHead = nqTail = 0;
  bool ok = false;
  if (connect()) {
    handshake();

    const size_t SEG = 4096;
    size_t nseg = (len + SEG - 1) / SEG;
    uint8_t* fr = (uint8_t*)malloc(SEG + 15);
    ok = fr != nullptr;
    if (!ok) plog("err", "Out of memory for the segment buffer");
    setPhase("send", 40);
    plog("i", "Sending %u B in %u segment(s)", (unsigned)len, (unsigned)nseg);
    for (size_t k = 0; ok && k < nseg; k++) {
      size_t off = k * SEG, n = min(SEG, len - off);
      uint16_t flen = n + 15;
      fr[0] = flen & 0xFF; fr[1] = flen >> 8;
      fr[2] = 0x03; fr[3] = 0x00; fr[4] = k == 0 ? 0x00 : 0x02;
      memcpy(fr + 5, &len, 4);  // little-endian on ESP32
      memcpy(fr + 9, &crc, 4);
      fr[13] = 0x00; fr[14] = 0x65;
      memcpy(fr + 15, gif + off, n);
      fAck = false;
      ok = writeChunked(fr, n + 15, off, len);
      if (!ok) plog("err", "Write failed on segment %u/%u", (unsigned)k + 1, (unsigned)nseg);
      else plog("i", "Segment %u/%u sent", (unsigned)k + 1, (unsigned)nseg);
      if (ok && k < nseg - 1) waitFlag(fAck, 2000);
    }
    free(fr);
    if (ok) {
      setPhase("confirm", 97);
      plog("i", "Waiting for the panel's confirmation...");
      waitFlag(fDone, 6000);
      ok = fDone;
    }
    tickDelay(500);
    disconnect();
  }
  if (own) free(gif);
  if (ok) { plog("ok", "Panel confirmed the complete file"); setPhase("done", 100); }
  else { plog("err", "No confirmation from the panel"); setPhase("error", 0); }
  return ok;
}
