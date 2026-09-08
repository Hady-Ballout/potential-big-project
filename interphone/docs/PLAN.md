# Interphone software plan — build everything before the hardware arrives

## Context

The hardware for the ESP32 door-entry controller is ordered but not here yet (DevKit V1, KY-019 relay, 12V solenoid lock, buzzer, LEDs — see `Component List.xlsx`). The goal is to start the software now and have as much as possible working, tested and demoable by the time the parts arrive, so hardware bring-up becomes a short checklist rather than the start of development.

Scope confirmed with Hady: **everything from the moment the visitor scans the QR code** —

1. Visitor scans a QR sticker at the building door → a web page opens on their phone.
2. Visitor picks the apartment they're visiting → the resident gets a push notification.
3. Resident opens the app, **sees and hears the visitor (video + audio)**, and taps Unlock.
4. The ESP32 at the door pulses the relay → the 12V lock opens; buzzer + LED give feedback at the door.

Decisions: PlatformIO in VS Code for firmware, Wokwi in the browser for simulation, Supabase for the backend, an installable web app (PWA) with push notifications for residents. Purpose: portfolio / startup prototype, so it should look and behave like a product, and the architecture should have a credible path to a real multi-building deployment.

Key design choice for video/audio: **the visitor's own phone is the intercom panel.** They already scanned the QR with it, so a browser-to-browser WebRTC call (visitor page ↔ resident PWA) gives video + audio with zero extra hardware. The DevKit V1 has no camera or mic, and an ESP32-CAM would give worse video for more work. A door-mounted camera can be a later product phase.

---

## Architecture

```
 Visitor phone                 Supabase (cloud)                 Resident phone
 ┌──────────────┐    HTTPS     ┌─────────────────────┐   push    ┌──────────────┐
 │ /d/{building}│─────────────▶│ Edge fn: ring       │──────────▶│ Resident PWA │
 │ pick apt,    │              │ Postgres + RLS      │  realtime │ incoming call│
 │ ring, camera │◀════════════▶│ Realtime (signaling)│◀═════════▶│ video+audio  │
 └──────────────┘   WebRTC     │ Edge fn: unlock     │           │ [Unlock]     │
        ▲ (P2P via STUN/TURN)  │ Edge fn: device-poll│           └──────────────┘
        └──────────────────────│ door_commands table │
                               └─────────┬───────────┘
                                         │ HTTPS poll (1 s), device token
                               ┌─────────▼───────────┐
                               │ ESP32 DevKit V1     │  GPIO5 relay → 12V lock
                               │ firmware            │  GPIO18 buzzer, GPIO4 LED
                               │ (Wokwi until real)  │  GPIO19 button (exit/test)
                               └─────────────────────┘
```

ESP32 ↔ backend uses **short polling over HTTPS** first (1 s interval, ≤1 s unlock latency). Reasons: trivial firmware, works in Wokwi's simulated Wi-Fi, no websocket/Phoenix protocol on the microcontroller. Upgrading to Supabase Realtime or MQTT later is a contained change inside `net_client`.

Multi-apartment from day one: one ESP32 per building door, many apartments per building, many residents per apartment. The visitor page is per building (`/d/{building_slug}`), which is what the QR encodes.

---

## Repository layout (new monorepo `interphone/` inside "Potential Big Project")

```
interphone/
  README.md
  firmware/                      PlatformIO project
    platformio.ini               envs: esp32devkit (default), esp32s3 (kept), native (tests)
    include/pins.h               #ifdef BOARD_DEVKIT_V1 / BOARD_ESP32_S3 pin maps
    include/config.h             timings, poll interval, Wi-Fi/device creds via build flags
    src/main.cpp                 setup/loop only: wires modules together
    src/door_controller.{h,cpp}  pure logic state machine (no Arduino deps) — unit-tested
    src/buzzer.{h,cpp}           non-blocking pattern player (ring / unlocked / denied / error)
    src/net_client.{h,cpp}       Wi-Fi connect, poll device-poll fn, ack commands, heartbeat
    src/hal.h                    tiny interface (digitalWrite/millis) so logic is mockable
    test/test_door_controller/   Unity tests run on the laptop (pio test -e native)
    wokwi/diagram.json           exact breadboard: DevKit V1, KY-019, buzzer+NPN+diode, LEDs, button
    wokwi/wokwi.toml
  supabase/
    config.toml
    migrations/0001_schema.sql   tables + RLS
    functions/ring/              public: create visit, notify residents
    functions/unlock/            resident-auth: insert door_command
    functions/device-poll/       device-token auth: return pending commands, record heartbeat
    functions/send-push/         Web Push (VAPID) helper used by ring
    seed.sql                     demo building, 3 apartments, 1 device, 1 resident
  web/                           Vite + React + TypeScript PWA (one app, two entry routes)
    src/routes/visitor/          /d/:slug → choose apartment → ringing → call → door opened
    src/routes/resident/         /app → login (magic link) → incoming visit → video → Unlock → history
    src/lib/supabase.ts, webrtc.ts, push.ts
    public/sw.js                 service worker: push + PWA install
  tools/
    virtual-device/              Node script that polls exactly like the firmware and prints UNLOCK
    make-qr/                     generates the door QR PNG for a building slug
```

---

## Data model (Supabase Postgres)

| Table | Key columns | Notes |
|---|---|---|
| `buildings` | id, slug, name | slug is what the QR encodes |
| `apartments` | id, building_id, label ("3B"), sort_order | shown on visitor page |
| `profiles` | id (= auth.users.id), display_name | |
| `apartment_members` | apartment_id, profile_id, role | who can unlock which door |
| `devices` | id, building_id, name, token_hash, last_seen_at | one per door controller |
| `visits` | id, apartment_id, status, visitor_note, created_at, answered_by, ended_at | status: `ringing → answered → unlocked / denied / expired` |
| `door_commands` | id, device_id, visit_id, action ("unlock"), created_at, delivered_at, expires_at | firmware acks by setting delivered_at; expires after 30 s |
| `push_subscriptions` | profile_id, endpoint, keys | Web Push targets |

RLS: residents read/write only visits for apartments they belong to; visitor page uses the `ring` edge function (service role, rate-limited by IP + apartment); devices never touch the DB directly — only `device-poll` with a hashed token.

WebRTC signaling: a Supabase Realtime **Broadcast** channel per visit (`visit:{id}`) carries SDP offers/answers and ICE candidates. STUN: Google public. TURN: Metered.ca free tier (needed for phones on carrier NAT); coturn on a VPS later.

---

## Firmware behaviour (door_controller state machine)

```
IDLE ──button pressed (debounced 30 ms)──▶ LOCAL_RING  (buzzer ring pattern, LED blink; for bench demo also unlocks after 1 s)
IDLE ──unlock command from cloud───────▶ UNLOCKING   (relay HIGH for UNLOCK_MS=3000, buzzer "unlocked" chirp, LED solid)
UNLOCKING ──timer──────────────────────▶ COOLDOWN    (relay LOW, ignore new unlocks for 1 s)
COOLDOWN ──timer───────────────────────▶ IDLE
any ──Wi-Fi lost──────────────────────▶ OFFLINE      (LED slow blink; button still works locally) ──reconnected──▶ IDLE
```

Everything non-blocking (`millis()`-based), no `delay()` in loop. The state machine takes `now_ms` and events as plain C++ so `pio test -e native` runs it on the laptop with no board.

Pin map (`pins.h`), DevKit V1 default per `PROJECT_CONTEXT.md` §4b: relay GPIO5, LED GPIO4, buzzer GPIO18, button GPIO19 (INPUT_PULLUP, active low). S3 map kept behind `#ifdef` so the original design isn't lost.

---

## Phases (each ends with something you can see working)

### Phase 0 — Setup (½ day)
Install VS Code + PlatformIO, Node 20, Supabase CLI; create Supabase project and Wokwi account; `git init` the monorepo. Commit the existing `PROJECT_CONTEXT.md` into `docs/` and update it: DevKit V1 is now primary, S3 is the alternate, `interphone 3.fzz` listed.

### Phase 1 — Firmware core in Wokwi (1–2 days) ← **"see the relay click today"**
`pins.h`, `door_controller`, `buzzer`, `main.cpp`, `diagram.json`. Press the simulated button → buzzer sounds, LED blinks, relay clicks and its LED lights for 3 s. Native unit tests for debounce, unlock pulse length, cooldown, and re-trigger rejection.

### Phase 2 — Backend + cloud unlock (2 days)
`0001_schema.sql`, RLS, `seed.sql`, edge functions `ring`, `unlock`, `device-poll`. `tools/virtual-device` polls and prints UNLOCK. Then `net_client` in firmware: Wokwi ESP32 joins `Wokwi-GUEST`, polls `device-poll` over HTTPS. Demo: `curl` the `unlock` function → simulated relay fires within a second.

### Phase 3 — Visitor page + resident PWA + push (3–4 days)

_Status (2026-09-05): built in a minimal form — email+password login instead of magic link, no visit history yet, video deferred to Phase 4. See `web/README.md`._
Visitor: `/d/demo-building` → apartment grid → "Ring" → "Waiting for resident…" → status updates via Realtime. Resident: magic-link login, installable PWA, push notification on ring, incoming-visit screen with Unlock / Deny, visit history. `make-qr` produces the sticker PNG. Demo: scan QR on a phone, ring, get push on another phone, tap Unlock, Wokwi relay fires.

### Phase 4 — Video + audio (2–3 days)
`webrtc.ts`: visitor page requests camera+mic on "Ring"; on resident answer, exchange SDP/ICE over the `visit:{id}` Broadcast channel; resident sees/hears visitor (one-way video, two-way audio). Hang-up on unlock/deny/expiry. TURN credentials fetched from an edge function so keys aren't in the client.

### Phase 5 — Product hardening (ongoing)
Device online/offline indicator from `last_seen_at`; visit auto-expire after 60 s; rate-limit `ring`; audit log of unlocks; Wi-Fi provisioning via captive portal (WiFiManager) instead of compiled-in creds; OTA updates; building admin screen to manage apartments/residents.

### When the components arrive — bring-up checklist (not software, but planned now)
- Meter the DevKit V1 header (VIN, all GNDs) before wiring.
- Flash the same firmware with `-e esp32devkit`; only `pins.h` matters.
- Verify KY-019 triggers from 3.3 V GPIO; verify buzzer is active (it is per shopping list).
- **12V lock wiring:** lock supply (12V/1A adapter) is completely separate from ESP32 5V. Relay COM → +12V, NO → lock +, lock − → 12V GND. **Add a 1N4007 flyback diode across the solenoid** (cathode to +12V) — the shopping list has the diodes but `PROJECT_CONTEXT.md` only puts one on the buzzer. The lock is a solenoid and will spike the relay contacts without it.
- Watch for brownout resets on relay inrush + Wi-Fi burst (1000 µF bulk cap, wall adapter not laptop USB).

---

## Verification

- **Firmware logic:** `pio test -e native` — debounce, 3 s unlock pulse, cooldown, offline behaviour.
- **Firmware build:** `pio run -e esp32devkit` compiles clean; upload `.pio/build/esp32devkit/firmware.bin` + `diagram.json` to wokwi.com and drive the button.
- **Backend:** `supabase start` locally, `supabase db reset` applies migrations + seed; `supabase functions serve`; `curl` each function; RLS checked by attempting cross-apartment unlock as a second seeded user (must fail).
- **End-to-end without hardware:** virtual-device running → visitor page on phone → resident PWA on second phone/browser → Unlock → virtual device prints UNLOCK; then the same with Wokwi instead of virtual device.
- **Video:** two phones on different networks (Wi-Fi vs mobile data) to prove TURN works.

## Out of scope for now
Door-mounted camera (ESP32-CAM / S3-CAM), native iOS/Android apps, payments/subscriptions, multi-door per building, NFC/keypad. All fit the schema later without redesign.

## Open questions to settle during Phase 0 (not blocking)
- Physical button at the door: keep as a plain "exit/test" button, or make it a fallback bell that rings *all* apartments? (Plan assumes exit/test.)
- Web framework: plan assumes Vite + React + TypeScript; SvelteKit or Next.js are equally fine if you prefer.
