#pragma once
// Shared log and job state. Implemented in main.cpp.
#include <Arduino.h>

void plog(const char* level, const char* fmt, ...);  // level: "i" info, "ok", "err"
void setPhase(const char* phase, int pct);           // scan|connect|handshake|send|confirm|done|error
void panelTick();                                    // serve HTTP during long BLE operations
extern volatile bool g_quietNotif;                   // true = do not log panel notifications (streaming)
extern volatile bool g_stopReq;                      // job aborted with the Stop button
extern int g_panelRssi;                              // panel RSSI from the last scan (0 = unknown)
extern uint32_t g_panelSeenAt;                       // millis() when the panel was last found
