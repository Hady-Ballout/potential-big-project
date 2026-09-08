# Wokwi simulation

Two ways to run the firmware with no hardware.

## A. wokwi.com in the browser (no toolchain needed)

1. Run `python pack_for_browser.py` in this folder. It creates `browser-project/` with a
   flat copy of the firmware, a `sketch.ino`, `libraries.txt` and this `diagram.json`.
2. Go to https://wokwi.com -> New Project -> ESP32.
3. In the Wokwi editor, use the file menu to upload every file from `browser-project/`
   (or drag-and-drop them). Overwrite `sketch.ino` and `diagram.json` when asked.
4. Press the green Start button. In the serial monitor you should see the banner and
   `[door] -> IDLE` (standalone mode: no backend URL is configured, so the device counts as online).
5. Click the green pushbutton: LED2 blinks fast and the buzzer plays the ring pattern,
   then after 1 s the relay clicks, LED1 (on the relay contacts) lights for 3 s, LED2 is solid.
6. Type `u` in the serial monitor to simulate a cloud unlock, `d` for deny, `s` for status.

## B. Wokwi extension in VS Code (uses the real PlatformIO build)

1. Install the "Wokwi Simulator" VS Code extension and request the free license key it asks for.
2. `pio run -e esp32devkit`
3. F1 -> "Wokwi: Start Simulator" (it reads `wokwi.toml`).

## Differences from the real breadboard

- Wokwi has no NPN transistor or diode parts, so the buzzer is driven straight from GPIO18.
  On the real board GPIO18 -> 1k -> NPN base, buzzer on the collector with the 1N4007 flyback
  diode. The firmware is identical: a HIGH on the pin means sound in both cases.
- Wokwi has no 30-pin "DevKit V1" board with real 5V on VIN; power rails are logical here.
- LED1 on the relay's NO contact stands in for the 12V lock, exactly like the bench build.
