# Interphone — hardware brief

Door entry / interphone controller built on an ESP32 dev board. Breadboard prototype stage;
the software is being built ahead of the hardware (see PLAN.md).

Last updated: 2026-09-02. Supersedes the copy in the parent folder.

---

## 1. What it does

A visitor rings from their phone (QR at the door) or presses the door button. The controller
sounds a buzzer, shows status on an LED, and fires a relay that drives the electric lock. On the
breadboard build the lock is replaced by a resistor and LED on the relay contacts so the
actuation is visible on the bench.

Four functional blocks:

1. **Button input.** Tactile pushbutton with a 10k pull-up to 3V3. Active low.
2. **Relay output.** GPIO drives the relay module IN pin. Bench: COM on the 5V rail, NO feeds
   330R into an LED to ground. Real door: COM on +12V, NO to the lock (see §5).
3. **Buzzer driver.** GPIO through 1k into the base of an NPN. Emitter to ground, collector to the
   buzzer, buzzer other side to the 5V rail, flyback diode across it. Low-side switch.
4. **Status LED.** GPIO through 330R into an LED to ground, driven directly.

---

## 2. Bill of materials

What was actually ordered (`Component List.xlsx` / `Interphone_Shopping_List_v2.pdf`, $32.51,
BEC + Electroslab):

| Ref | Component | Qty |
|---|---|---|
| M1 | **ESP32 DevKit V1 (30-pin, WROOM-32)** | 1 |
| Part1 | KY-019 5V relay module | 2 (1 spare) |
| J1 | Active buzzer 5V | 2 |
| D1 | 1N4007 rectifier diode | 10 |
| Q1 | NPN transistor 2SC2061 | 2 |
| S1 | Tactile pushbutton 12×12 | 5 |
| LED1, LED2 | Red LED 5mm | 5 |
| R1, R2 | 330R | 2 |
| R3 | 10k | 1 |
| R4 | 1k | 1 |
| — | 12V solenoid door lock 55×28×30 | 1 |
| — | 12V / 1A wall adapter + 2× barrel jack | 1 |
| — | Breadboard 830, jumper wire, Micro-USB cable | — |

The ESP32-S3 (original design) was out of stock; the DevKit V1 is now the primary board.

---

## 3. Power rails

| Rail | Source | Feeds |
|---|---|---|
| 3V3 | Board 3V3 pin | R3 pull-up |
| 5V | Board VIN pin (USB) | Relay coil VCC, relay COM (bench only), buzzer, D1 cathode |
| 12V | Wall adapter | **Lock only**, via the relay contacts. Never tied to the ESP32 rails except GND. |
| GND | Board GND pins + adapter minus | Everything |

5V rail budget: ~70–80 mA relay coil + ~30 mA buzzer. Coil inrush during a Wi-Fi burst is the
likely cause of any brownout reset. Mitigation: 1000 µF bulk cap on the rail, 100 nF near the relay
and buzzer, and a wall adapter rather than a laptop USB port. On the DevKit V1, VIN sits around
4.6–4.7 V on USB after the protection diode — marginal but usually enough for the KY-019.

---

## 4. Pin mapping (matches `firmware/src/pins.h`)

| Function | DevKit V1 (primary) | ESP32-S3 (alternate) |
|---|---|---|
| Relay IN | GPIO5 | GPIO5 |
| Status LED | GPIO4 | GPIO6 |
| Buzzer (NPN base) | GPIO18 | GPIO18 |
| Button (active low) | GPIO19 | GPIO21 |

DevKit V1 constraints: avoid GPIO6–11 (flash), GPIO0/2/12/15 (strapping); GPIO34–39 input only.
S3 notes: GPIO43/44 untouched so UART0 and flashing stay intact. Arduino settings for S3 N16R8
clones: board = ESP32S3 Dev Module, flash 16MB, PSRAM = OPI.

Fritzing: `interphone 3.fzz` (2026-08-28) is the sketch with the DevKit V1 part;
`Interphone Project two.fzz` + `_netlist.xml` are the S3 version.

---

## 5. Real lock wiring (when the demo moves off the bench)

```
12V adapter +  ──── relay COM
relay NO       ──── lock +
lock −         ──── 12V adapter −  ──── ESP32 GND (common ground only)
1N4007 across the lock: cathode (band) to lock +, anode to lock −
```
- **The flyback diode across the solenoid is mandatory.** The shopping list has ten 1N4007s;
  the original brief only put one on the buzzer. Without it the coil kick arcs the relay contacts
  and can reset the ESP32.
- The 12V supply never touches the ESP32 5V/3V3 rails. Relay contacts are the isolation.
- A 12V solenoid lock draws ~0.5–1 A while energised; the 1 A adapter is at its limit. Keep
  `UNLOCK_MS` at 3 s or less (firmware default) and don't hold it.
- Relay COM on the logic 5V rail is a bench convenience only. Do not carry it to the final build.

---

## 6. Bring-up checklist (hardware arrival)

- [ ] Meter the DevKit V1 header: VIN, 3V3, all GND pins, before wiring anything.
- [ ] `pio run -e esp32devkit -t upload`, open the serial monitor, confirm the banner and `-> IDLE`.
- [ ] Press the button: ring pattern, LED blink, relay click, LED1 3 s.
- [ ] Type `u` in the serial monitor: same without the button.
- [ ] Confirm the KY-019 triggers from the 3.3 V GPIO. If not, it's the module threshold, not wiring.
- [ ] Confirm the buzzer is active (it should be; passive needs `tone()` — see `buzzer.h`).
- [ ] Put Wi-Fi + device token in `firmware/secrets.ini`, watch `[net] backend online`, unlock from the app.
- [ ] Watch for resets when the relay fires during Wi-Fi traffic → add the bulk cap.
- [ ] Only then wire the 12V lock per §5.

---

## 7. Procurement notes

Electroslab (Lebanon, WhatsApp) — DevKit V1 $9 in stock; S3 N16R8 clone $12 out of stock.
BEC — everything else. Cables: DevKit V1 is Micro-B, data cable not charge-only.

## 8. Optional expansion

- Door camera: needs an ESP32-S3 with camera or a separate cam. The product design instead uses
  the visitor's own phone camera via WebRTC (PLAN.md Phase 4), so no door camera is required.
- NFC / keypad / second door: fit the schema (`devices` per building) without redesign.
