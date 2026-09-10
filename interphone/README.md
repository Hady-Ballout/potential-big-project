# Interphone

Cloud-connected door entry for apartment buildings. A visitor scans the QR sticker at the door,
picks an apartment, and the resident sees and hears them on their phone and taps **Unlock**.
An ESP32 at the door pulses a relay that opens a 12 V lock.

Full design: [docs/PLAN.md](docs/PLAN.md). Hardware brief: [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md).

```
visitor phone ──HTTPS──▶ Supabase (Postgres + edge functions + realtime) ◀──push/realtime── resident PWA
                                  ▲ 1 s HTTPS poll, device token
                            ESP32 DevKit V1 firmware (relay, buzzer, LED, button)
```

## What is done (Phase 1 to 3)

| Piece | Where | Status |
|---|---|---|
| Firmware state machine, buzzer patterns, pin maps | `firmware/src` | done, 12 native unit tests pass |
| Wi-Fi + backend polling on a FreeRTOS task | `firmware/src/net_client.cpp` | done, compile-checked; needs the real build (`pio run`) |
| Wokwi breadboard simulation | `firmware/wokwi` | done |
| Database schema, RLS, demo seed | `supabase/migrations`, `supabase/seed.sql` | done, applied + RLS tested on Postgres 16 |
| Edge functions `ring`, `respond`, `device-poll` | `supabase/functions` | done, `deno check` clean |
| Virtual door controller (no hardware) | `tools/virtual-device` | done |
| Visitor page + resident app + push (minimal) | `web/` | done, see `web/README.md` |
| Door sticker QR generator | `tools/make-qr` | done |
| WebRTC video/audio + private signaling | `web/src/lib/webrtc.ts`, `supabase/functions/call-config` | done; needs TURN credentials and two-device field test |

## Quick start

### 1. Firmware on your laptop (no hardware)

```
cd firmware
pio test -e native          # unit tests for the door logic
pio run  -e esp32devkit     # full ESP32 build (needs the PlatformIO ESP32 toolchain, downloads once)
```
Then follow `firmware/wokwi/README.md` to press the button and watch the relay in the browser.

Serial keys while it runs (Wokwi or real board): `u` unlock, `d` deny, `s` status.

### 2. Backend locally

Requires Docker Desktop. The Supabase CLI runs through npx (or `scoop install supabase`).
```
npx supabase start                                    # local Postgres, auth, functions, studio (pulls images once)
npx supabase db reset                                 # applies migrations + seed.sql
npx supabase functions serve --env-file supabase/.env # (copy supabase/.env.example first; VAPID keys optional)
```
Demo data from `seed.sql`: building **demo-building** with apartments 1A–3A,
resident **demo@interphone.local / demo1234** (1A), device token **demo-device-token-change-me**.

### 3. See a cloud unlock reach the door

Terminal A — the door:
```
cd tools/virtual-device
SUPABASE_FUNCTIONS_URL=http://127.0.0.1:54321/functions/v1 DEVICE_TOKEN=demo-device-token-change-me node index.mjs
```
Terminal B — a visitor rings 1A, then the resident unlocks:
```
F=http://127.0.0.1:54321/functions/v1
curl "$F/ring?building=demo-building"                        # apartments + door_online
curl -X POST $F/ring -H 'content-type: application/json' \
     -d '{"building":"demo-building","apartment_id":"00000000-0000-0000-0000-00000000a001","note":"DHL"}'
# -> {"visit_id":"...","status":"ringing"}

# log in as the resident to get a JWT (anon key is printed by `supabase start`)
TOKEN=$(curl -s -X POST http://127.0.0.1:54321/auth/v1/token?grant_type=password \
  -H "apikey: $ANON_KEY" -H 'content-type: application/json' \
  -d '{"email":"demo@interphone.local","password":"demo1234"}' | jq -r .access_token)

curl -X POST $F/respond -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
     -d '{"visit_id":"<visit_id from above>","action":"unlock"}'
```
Within a second terminal A prints `door -> UNLOCKING *** RELAY ON ***`.
To do the same with the simulated ESP32 instead, put your project's functions URL and the device
token in `firmware/secrets.ini` (see `secrets.ini.example`) and run Wokwi in VS Code — the Wokwi
browser editor cannot reach a `localhost` backend, so for the browser use a deployed Supabase project.

### 4. Web app: scan, ring, unlock

```
cd web && npm install && cp .env.example .env.local   # fill VITE_SUPABASE_ANON_KEY from `npx supabase status`
npm run dev                                           # http://localhost:5173
```
Visitor page: http://localhost:5173/d/demo-building. Resident app: http://localhost:5173/app
(demo@interphone.local / demo1234). With the virtual device from step 3 running, tapping **UNLOCK**
prints `RELAY ON` in terminal A. Door sticker: `node tools/make-qr/index.mjs demo-building http://<laptop LAN IP>:5173`.
Details, phone testing and push setup: `web/README.md`.

### 5. Deploy the backend to Supabase cloud

```
supabase link --project-ref <ref>
supabase db push
supabase functions deploy ring respond device-poll call-config
supabase secrets set --env-file supabase/.env
```

## API (edge functions)

| Function | Auth | Purpose |
|---|---|---|
| `GET /ring?building=slug` | none | apartments list + door online flag (visitor page) |
| `GET /ring?visit=id` | none | visit status, visitor polls while waiting |
| `POST /ring` | none, rate-limited | create a visit, push residents |
| `POST /respond` | resident JWT | `answer`, `unlock`, `deny` a visit; `unlock` with `apartment_id` for self-entry |
| `POST /device-poll` | `x-device-token` | door controller heartbeat + pending commands |

## Repository layout

```
firmware/   PlatformIO project (ESP32 DevKit V1 default, ESP32-S3 alternate, native tests)
supabase/   migrations, seed, edge functions, config
web/        visitor page + resident app (Vite + React), see web/README.md
tools/      virtual-device (fake door controller), make-qr (door sticker), docker-pull-host (image pull workaround)
docs/       PLAN.md, PROJECT_CONTEXT.md (hardware)
```
