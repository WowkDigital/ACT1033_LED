#pragma once
// BLE client for the BK-Light LED panel (64x16). Protocol: ../../docs/PROTOCOL.md
#include <Arduino.h>
#include <NimBLEDevice.h>

class Panel {
 public:
  // address: "aa:bb:cc:dd:ee:ff" (lower case) or "" = first advertised LED_BLE_* device
  void begin(const String& address);
  const String& address() const { return addr_; }
  // Connects, uploads a GIF in 4096-byte segments, disconnects. Returns true when the panel confirmed the whole file.
  // scratch: writable buffer with capacity >= len+4 (may be the GIF buffer itself) - avoids a copy;
  // nullptr = copy on the heap.
  bool sendGif(const uint8_t* gif, size_t len, uint8_t* scratch = nullptr);

  // --- PNG frame stream over one open connection (the "clock mode" of the original BK-Light project) ---
  bool streamBegin();  // scan + connect + handshake
  // Sends one PNG frame (frame type 0x02). gapMs = pause between BLE packets.
  // ackMs (optional) = time from the start of the write to the panel's confirmation.
  bool streamFrame(const uint8_t* png, size_t len, uint32_t gapMs, uint32_t* ackMs);
  void streamValidate();  // "05 00 00 01 00" packet every ~30 frames, as in the original code
  void streamEnd();
  bool connected() const { return cli_ && cli_->isConnected(); }

 private:
  bool handshake();
  bool findPanel(NimBLEAdvertisedDevice& out);
  bool connect();
  void disconnect();
  bool writeChunked(const uint8_t* data, size_t len, size_t base, size_t total);
  bool waitFlag(volatile bool& f, uint32_t ms);

  String addr_;
  NimBLEClient* cli_ = nullptr;
  NimBLERemoteCharacteristic* wr_ = nullptr;
  size_t chunk_ = 20;
  uint8_t* sbuf_ = nullptr;
  size_t sbufCap_ = 0;
};
