#pragma once
#include <Arduino.h>

// printf-style log to the USB serial port. level: "i" info, "ok", "err".
void plog(const char* level, const char* fmt, ...);
