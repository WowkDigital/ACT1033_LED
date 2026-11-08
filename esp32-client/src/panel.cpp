#include "panel.h"

#include "log.h"

static const char* UUID_WRITE = "0000fa02-0000-1000-8000-00805f9b34fb";
static const char* UUID_NOTIFY = "0000fa03-0000-1000-8000-00805f9b34fb";
static const uint8_t HS1[] = {0x08, 0x00, 0x01, 0x80, 0x0E, 0x06, 0x32, 0x00};
static const uint8_t HS2[] = {0x04, 0x00, 0x05, 0x80};

static volatile bool fStage1, fStage2, fAck, fDone;

uint32_t crc32(const uint8_t* d, size_t n) {
  uint32_t c = 0xFFFFFFFF;
  for (size_t i = 0; i < n; i++) {
    c ^= d[i];
    for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c;
}

static void onNotify(NimBLERemoteCharacteristic*, uint8_t* d, size_t n, bool) {
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
    if (addr.length() ? (a == addr) : nm.startsWith("LED_BLE")) {
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
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);
}

bool Panel::waitFlag(volatile bool& f, uint32_t ms) {
  uint32_t t = millis();
  while (!f && millis() - t < ms) delay(5);
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
    while (scan->isScanning() && !scanCb.found && millis() - t < 9000) delay(20);
    if (scan->isScanning()) scan->stop();
    delay(100);
    if (scanCb.found) {
      out = scanCb.dev;
      plog("i", "Panel found: %s (RSSI %d dBm)", out.getAddress().toString().c_str(), out.getRSSI());
      scan->clearResults();
      return true;
    }
    plog("err", "Panel not visible - is it powered on, nearby and not connected to a phone?");
  }
  return false;
}

// Timing of the last BLE upload (ms), logged at the end of send()
static uint32_t tScan, tConn, tHand, tSend;

bool Panel::connect() {
  NimBLEAdvertisedDevice dev;
  uint32_t t0 = millis();
  if (!findPanel(dev)) return false;
  tScan = millis() - t0;
  t0 = millis();

  cli_ = NimBLEDevice::createClient();
  cli_->setConnectTimeout(6);
  bool conn = false;
  for (int t = 1; t <= 3 && !conn; t++) {
    plog("i", "Connecting to the panel (attempt %d/3)...", t);
    conn = cli_->connect(&dev);
    if (!conn) plog("err", "Connection failed (attempt %d)", t);
  }
  if (!conn) {
    NimBLEDevice::deleteClient(cli_);
    cli_ = nullptr;
    return false;
  }
  cli_->updateConnParams(6, 12, 0, 400);  // 7.5-15 ms interval
  delay(300);
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
  delay(300);
  tConn = millis() - t0;
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

bool Panel::write(const uint8_t* data, size_t len) {
  for (size_t o = 0; o < len; o += chunk_) {
    size_t n = min(chunk_, len - o);
    int tries = 0;
    while (!wr_->writeValue(data + o, n, false)) {
      if (++tries > 200 || !cli_->isConnected()) return false;
      delay(5);
    }
    delay(10);
  }
  return true;
}

bool Panel::handshake() {
  uint32_t t0 = millis();
  wr_->writeValue(HS1, sizeof(HS1), false);
  if (!waitFlag(fStage1, 5000)) plog("err", "handshake 1: no reply (continuing)");
  delay(200);
  wr_->writeValue(HS2, sizeof(HS2), false);
  if (!waitFlag(fStage2, 5000)) plog("err", "handshake 2: no reply (continuing)");
  delay(200);
  tHand = millis() - t0;
  return true;
}

bool Panel::send(uint8_t* buf, size_t len) {
  fStage1 = fStage2 = fAck = fDone = false;
  tScan = tConn = tHand = tSend = 0;
  uint32_t t0 = millis();
  bool ok;
  if (len > 6 && memcmp(buf, "GIF8", 4) == 0) ok = sendGif(buf, len);
  else if (len > 8 && buf[0] == 0x89 && memcmp(buf + 1, "PNG", 3) == 0) ok = sendPng(buf, len);
  else { plog("err", "Not a GIF or PNG file"); return false; }
  uint32_t total = millis() - t0;
  // whatever is left after scan, connect and handshake is the upload itself plus the confirmation wait and disconnect
  tSend = total > tScan + tConn + tHand ? total - tScan - tConn - tHand : 0;
  plog("i", "BLE timing: scan %u ms, connect %u ms, handshake %u ms, upload+confirm %u ms, total %u ms", (unsigned)tScan,
       (unsigned)tConn, (unsigned)tHand, (unsigned)tSend, (unsigned)total);
  return ok;
}

bool Panel::sendPng(const uint8_t* png, size_t n) {
  if (n > 12000) { plog("err", "PNG too large (%u B, limit 12000)", (unsigned)n); return false; }
  uint8_t* fr = (uint8_t*)malloc(n + 15);
  if (!fr) { plog("err", "Out of memory"); return false; }
  uint32_t crc = crc32(png, n);
  uint16_t total = n + 15;
  fr[0] = total & 0xFF; fr[1] = total >> 8;
  fr[2] = 0x02; fr[3] = 0x00; fr[4] = 0x00;  // type 0x02 = PNG
  uint32_t n32 = n;
  memcpy(fr + 5, &n32, 4);
  memcpy(fr + 9, &crc, 4);
  fr[13] = 0x00; fr[14] = 0x65;
  memcpy(fr + 15, png, n);

  bool ok = false;
  if (connect()) {
    handshake();
    fDone = false;
    plog("i", "Sending PNG, %u B", (unsigned)n);
    if (write(fr, total)) ok = waitFlag(fDone, 3000);
    delay(300);
    disconnect();
  }
  free(fr);
  if (ok) plog("ok", "Panel confirmed the PNG frame");
  else plog("err", "No confirmation from the panel");
  return ok;
}

bool Panel::sendGif(uint8_t* gif, size_t srcLen) {
  // The panel recognises an identical file and corrupts the animation -> 4 random bytes after the GIF trailer.
  size_t len = srcLen + 4;
  uint32_t r = esp_random();
  memcpy(gif + srcLen, &r, 4);
  uint32_t crc = crc32(gif, len);

  bool ok = false;
  if (connect()) {
    handshake();
    const size_t SEG = 4096;
    size_t nseg = (len + SEG - 1) / SEG;
    uint8_t* fr = (uint8_t*)malloc(SEG + 15);
    ok = fr != nullptr;
    if (!ok) plog("err", "Out of memory for the segment buffer");
    plog("i", "Sending GIF, %u B in %u segment(s)", (unsigned)len, (unsigned)nseg);
    uint32_t len32 = len;
    for (size_t k = 0; ok && k < nseg; k++) {
      size_t off = k * SEG, n = min(SEG, len - off);
      uint16_t flen = n + 15;
      fr[0] = flen & 0xFF; fr[1] = flen >> 8;
      fr[2] = 0x03; fr[3] = 0x00; fr[4] = k == 0 ? 0x00 : 0x02;
      memcpy(fr + 5, &len32, 4);
      memcpy(fr + 9, &crc, 4);
      fr[13] = 0x00; fr[14] = 0x65;
      memcpy(fr + 15, gif + off, n);
      fAck = false;
      ok = write(fr, n + 15);
      if (!ok) plog("err", "Write failed on segment %u/%u", (unsigned)k + 1, (unsigned)nseg);
      if (ok && k < nseg - 1) waitFlag(fAck, 2000);
    }
    free(fr);
    if (ok) ok = waitFlag(fDone, 6000);
    delay(500);
    disconnect();
  }
  if (ok) plog("ok", "Panel confirmed the complete GIF");
  else plog("err", "No confirmation from the panel");
  return ok;
}
