// Pin map for the interphone door controller.
// Select the board with -DBOARD_DEVKIT_V1 (default) or -DBOARD_ESP32_S3 in platformio.ini.
// Source: docs/PROJECT_CONTEXT.md section 4.
#pragma once

#if defined(BOARD_ESP32_S3)
// ESP32-S3-DevKitC-1 (original design). Plain I/O, no strapping/USB/PSRAM conflicts.
#define PIN_RELAY    5   // KY-019 IN
#define PIN_LED      6   // status LED via 330R
#define PIN_BUZZER  18   // 1k into NPN base, low-side switch for the buzzer
#define PIN_BUTTON  21   // pushbutton to GND, 10k pull-up to 3V3 (active low)
#define BOARD_NAME "esp32-s3-devkitc-1"

#else
// ESP32 DevKit V1, 30-pin WROOM-32 (the board on the shopping list).
// Avoid GPIO6-11 (flash), GPIO0/2/12/15 (strapping); GPIO34-39 are input only.
#ifndef BOARD_DEVKIT_V1
#define BOARD_DEVKIT_V1
#endif
#define PIN_RELAY   13
#define PIN_LED     19
#define PIN_BUZZER  18
#define PIN_BUTTON  21
#define BOARD_NAME "esp32-devkit-v1"
#endif

// Electrical conventions (same on both boards)
#define RELAY_ACTIVE_LEVEL   HIGH   // KY-019 with NPN input: IN high = coil energised
#define BUZZER_ACTIVE_LEVEL  HIGH   // GPIO high -> NPN on -> active buzzer sounds
#define BUTTON_PRESSED_LEVEL LOW    // pull-up, button shorts to GND
