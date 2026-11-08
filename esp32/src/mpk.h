#pragma once
// "MPK" mode: poll the Wroclaw transit worker (docs/API_GUIDE.md) and show the next 2 departures
// on the 64x16 panel, one per row. The frame is rendered on the ESP and sent as a static GIF.
#include <Arduino.h>

void mpkBegin();                  // load the saved configuration from NVS
void mpkLoop();                   // call from loop(): polls the worker and queues a panel job when the rows changed
String mpkJson();                 // JSON object for /status
// Returns an empty string on success, otherwise an error message.
String mpkConfigure(bool enabled, const String& stop, const String& lines, const String& dir, int intervalSec);
void mpkRefreshNow();             // poll on the next loop() pass
void mpkDisable();                // leave MPK mode (a manual job took over the panel)
