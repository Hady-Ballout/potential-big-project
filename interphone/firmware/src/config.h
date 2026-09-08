// Tunables and credentials. Anything here can be overridden with -D flags in secrets.ini.
#pragma once

#ifndef INTERPHONE_VERSION
#define INTERPHONE_VERSION "0.1.0"   // platformio.ini overrides; this default serves the Wokwi browser build
#endif

// --- Door timing (ms) ---
#ifndef UNLOCK_MS
#define UNLOCK_MS        3000   // relay energised this long per unlock
#endif
#ifndef COOLDOWN_MS
#define COOLDOWN_MS      1000   // ignore further unlocks right after one
#endif
#ifndef DEBOUNCE_MS
#define DEBOUNCE_MS        30
#endif
#ifndef LOCAL_RING_MS
#define LOCAL_RING_MS    1000   // how long the door-side button "rings" before acting
#endif
// Bench/demo behaviour: the physical button also unlocks the door after LOCAL_RING_MS.
// Set to 0 for the product build where the button is only a bell/exit request.
#ifndef LOCAL_RING_UNLOCKS
#define LOCAL_RING_UNLOCKS  1
#endif

// --- Network ---
#ifndef WIFI_SSID
#define WIFI_SSID "Wokwi-GUEST"     // Wokwi's simulated open network
#endif
#ifndef WIFI_PASS
#define WIFI_PASS ""
#endif
#ifndef SUPABASE_FUNCTIONS_URL
#define SUPABASE_FUNCTIONS_URL ""   // e.g. https://abcd1234.supabase.co/functions/v1 ; empty = networking disabled
#endif
#ifndef DEVICE_TOKEN
#define DEVICE_TOKEN ""             // per-device secret issued by the backend (see supabase/seed.sql)
#endif
#ifndef POLL_INTERVAL_MS
#define POLL_INTERVAL_MS 1000
#endif
#ifndef WIFI_RETRY_MS
#define WIFI_RETRY_MS   10000
#endif
