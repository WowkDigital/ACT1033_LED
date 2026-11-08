#pragma once
// BLE client for the BK-Light LED panel (64x16). Protocol: ../../docs/PROTOCOL.md
#include <Arduino.h>
#include <NimBLEDevice.h>

uint32_t crc32(const uint8_t* data, size_t len);

class Panel {
 public:
  // address: BLE address like "aa:bb:cc:dd:ee:ff" or "" = first advertised LED_BLE_* device
  void begin(const String& address);

  // Uploads a finished image (as produced by the Cloudflare render Worker) and disconnects.
  //  - GIF: segmented upload, stays stored in the panel and keeps playing. buf must have capacity >= len + 4
  //    (4 random bytes are appended so an identical file is never byte-identical).
  //  - PNG: a single frame (<= 12000 B), nothing is stored.
  // Returns true when the panel confirmed the whole file.
  bool send(uint8_t* buf, size_t len);

 private:
  bool sendGif(uint8_t* buf, size_t len);
  bool sendPng(const uint8_t* png, size_t len);
  bool handshake();
  bool findPanel(NimBLEAdvertisedDevice& out);
  bool connect();
  void disconnect();
  bool write(const uint8_t* data, size_t len);
  bool waitFlag(volatile bool& f, uint32_t ms);

  String addr_;
  NimBLEClient* cli_ = nullptr;
  NimBLERemoteCharacteristic* wr_ = nullptr;
  size_t chunk_ = 20;
};
