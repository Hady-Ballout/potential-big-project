# Interphone Project Two

Door entry / interphone controller built on an ESP32 dev board. Breadboard prototype
stage. Source of truth for the wiring is the Fritzing sketch and its exported netlist.

Last updated: 2026-09-01

---

## 1. What it does

A visitor or resident presses a button. The controller sounds a buzzer, shows status on
an LED, and fires a relay that would drive the electric door strike. On the current
breadboard build the strike is replaced by a resistor and LED on the relay contacts so
the actuation is visible on the bench.

Four functional blocks:

1. **Button input.** Tactile pushbutton with a 10k pull-up to 3V3. Active low: the GPIO
   reads HIGH at idle and LOW when pressed.
2. **Relay output.** GPIO drives the relay module IN pin. COM sits on the 5V rail, NO
   feeds 330R into an LED to ground. NC unconnected.
3. **Buzzer driver.** GPIO through 1k into the base of an NPN. Emitter to ground,
   collector to the buzzer, buzzer other side to the 5V rail, flyback diode across it.
   Low side switch.
4. **Status LED.** GPIO through 330R into an LED to ground, driven directly.

---

## 2. Bill of materials (from the netlist)

| Ref | Component | Qty |
|---|---|---|
| M1 | ESP32 dev board | 1 |
| Part1 | KY-019 5V relay module | 1 |
| J1 | Buzzer | 1 |
| D1 | Rectifier diode (1N4007) | 1 |
| Q1 | NPN transistor (2N2222 / BC547) | 1 |
| S1 | Tactile pushbutton, 4 pin | 1 |
| LED1 | Red LED 5mm (relay indicator) | 1 |
| LED2 | Red LED 5mm (status) | 1 |
| R1 | 330R (LED1 series) | 1 |
| R2 | 330R (LED2 series) | 1 |
| R3 | 10k (button pull-up) | 1 |
| R4 | 1k (transistor base) | 1 |
| Breadboard1 | RSR 03MB102 breadboard, 830 point | 1 |

12 components plus the breadboard.

---

## 3. Power rails

| Rail | Source | Feeds |
|---|---|---|
| 3V3 | Board 3V3 pins | R3 pull-up |
| 5V | Board 5V / VIN pin | Relay coil VCC, relay COM, buzzer, D1 cathode |
| GND | Board GND pins, both breadboard minus rails tied together | Everything |

Current budget on the 5V rail is roughly 70 to 80 mA for the relay coil plus about
30 mA for the buzzer. That is inside USB limits but coil inrush coinciding with a Wi-Fi
transmit burst is the likely cause of any brownout resets. Mitigation: 1000uF bulk cap
on the rail, 100nF decoupling near the relay and buzzer, and a 5V 2A wall adapter rather
than a laptop port.

---

## 4. Pin mapping

### 4a. Original design: ESP32-S3-DevKitC-1-N8R8

The Fritzing part numbers pins DIP style: 1 to 22 down the left header (J1), then 23 to
44 back up the right header (J3). Verified against the Espressif v1.1 header tables.

| Netlist pin | Actual pin | Use |
|---|---|---|
| 1, 2 | 3V3, 3V3 | 3V3 rail |
| 21 | 5V | 5V rail |
| 22, 23, 24, 44 | GND x4 | ground rails |
| 5 | GPIO5 | Relay IN |
| 6 | GPIO6 | Status LED via R2 |
| 11 | GPIO18 | Buzzer via R4 into Q1 base |
| 27 | GPIO21 | Pushbutton input |

GPIO5, 6, 18 and 21 are all plain I/O on the S3. No strapping, boot, USB or PSRAM
conflicts. GPIO43 and 44 are untouched, so UART0 and flashing stay intact.

**Status: verified functional as drawn.**

### 4b. Fallback: classic ESP32 DevKit V1 (ESP32-WROOM-32, 30 pin)

Only needed if the S3 stays out of stock. Different chip, so the netlist pin mapping
does not carry over and the Fritzing part must be swapped.

| Function | S3 | DevKit V1 |
|---|---|---|
| Relay IN | GPIO5 | GPIO5 |
| Status LED | GPIO6 | GPIO4 |
| Buzzer | GPIO18 | GPIO18 |
| Button | GPIO21 | GPIO19 |

Constraints on the classic ESP32: avoid GPIO6 to 11 (flash), avoid GPIO0, 2, 12 and 15
(strapping), GPIO34 to 39 are input only. The 5V pin is labelled VIN and sits around
4.6 to 4.7V on USB power after the protection diode, which is marginal but usually
enough for the relay coil.

---

## 5. Design notes and things to verify on hardware

- **Relay COM on the logic 5V rail.** Correct for the bench stand-in. For the real
  installation, COM goes to the door strike supply and stays isolated from the logic
  side. Do not carry this over to the final build.
- **Clone boards.** If the board is a clone rather than a genuine Espressif DevKitC-1
  (tell by the connector: genuine is Micro-B, clones often use dual USB-C), meter the
  header before wiring. Confirm the 5V pin and all four GND pins, since the rails hang
  off them.
- **Relay trigger threshold.** Most KY-019 boards trigger fine from a 3.3V GPIO. If it
  is stubborn, that is the threshold, not the wiring.
- **Buzzer type.** Circuit assumes an active 5V buzzer. A passive one needs a PWM tone
  on the GPIO instead of a simple HIGH.
- **Arduino IDE settings for S3 N16R8 clones:** board = ESP32S3 Dev Module, flash 16MB,
  PSRAM = OPI. Wrong PSRAM setting causes boot loops.

---

## 6. Procurement

Local supplier: Electroslab (Lebanon), also reachable on WhatsApp.

| Board | Price | Status |
|---|---|---|
| ESP32-S3 N16R8 dev board (clone, dual USB-C) | $12.00 | Out of stock, notify list |
| ESP32 DevKit V1 (WROOM-32, 30 pin) | $9.00 | In stock |

Full prototype kit including spares, debug gear and a second board estimates at $110 to
$195 cash USD locally, or $90 to $155 if the lab already has a multimeter. Ordering the
dev boards from AliExpress saves roughly $25 but adds three to six weeks.

Cables: genuine DevKitC-1 is Micro-B, the Electroslab S3 clone is USB-C, the DevKit V1
is Micro-B. Data cables, not charge only.

---

## 7. Optional expansion

- **Real door hardware:** 12V electric strike, 12V 2A supply, spade or screw terminals.
  Roughly $35 to $80. Keep that supply completely separate from the ESP32 5V rail.
- **On-device QR scanning:** requires an ESP32-S3 board with a camera. The DevKitC-1 has
  no imager. If the QR is scanned on the visitor's phone instead, no extra hardware is
  needed and the DevKit V1 is sufficient.

---

## 8. PCB Pilot coverage

Every component in this design exists in the PCB Pilot registry:

`esp32`, `relay_module`, `buzzer`, `diode`, `led`, `bjt_npn`, `pushbutton`, `resistor`.

The `esp32` kind is 12 pins, fixed order: 3V3, GND, VIN, EN, GPIO2, GPIO4, GPIO5,
GPIO13, GPIO18, GPIO19, GPIO21, GPIO22. Flagged `mcu` and `wiringOnly`, so it is
excluded from the SPICE deck but participates in layout and the topology rules.
`relay_module` pin order is VCC, GND, IN, COM, NO, NC, matching the KY-019.

**Registry gap:** there is no `esp32_s3` kind. Only classic ESP32, Arduino Uno and
Raspberry Pi are available under `mcu`. The `esp32` kind also exposes only 8 GPIOs,
which is enough for this project but tight. Worth logging as a product item given how
common S3 boards are in student work.

---

## 9. Open items

- [ ] Confirm S3 restock date with Electroslab, or commit to the DevKit V1 fallback
- [ ] Meter the board header (5V pin, all GND pins) before wiring
- [ ] Decide whether QR scanning happens on device or on the visitor's phone
- [ ] Confirm with instructor whether the demo needs a real strike or the LED stand-in
- [ ] Firmware: button debounce, relay pulse duration, buzzer pattern, Wi-Fi provisioning
- [ ] Run the design through PCB Pilot `validate_circuit` as a toolchain smoke test

---

## 10. Files

| File | What it is |
|---|---|
| `Interphone_Project_two_netlist.xml` | Fritzing netlist export, source of truth for wiring |
| `Interphone Project two.fzz` | Fritzing sketch |
| `PROJECT_CONTEXT.md` | This file |
