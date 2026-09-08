# web — visitor page + resident app

Vite + React + TypeScript. One app, two entry points:

| Route | Who | What |
|---|---|---|
| `/d/:slug` | visitor (from the QR sticker) | building name, door online dot, apartment grid, optional note, **Ring**, then live status: ringing → door is open / not let in / nobody answered |
| `/app` | resident | email + password login, apartment label, door online dot, big **UNLOCK** button, a "Visitor at the door" card with Unlock / Deny when someone rings, optional **Enable notifications** (Web Push), log out |
| `/app/visit/:id` | push notification deep link | redirects to `/app` |

Kept deliberately minimal. Not built yet: video/audio call, visit history, magic-link login, admin screens, offline caching.

## Run locally

Needs the local Supabase stack running (see the root README): `npx supabase start`, then
`npx supabase functions serve --env-file supabase/.env` in its own terminal.

```
cd web
npm install
cp .env.example .env.local      # then fill in VITE_SUPABASE_ANON_KEY from `npx supabase status`
npm run dev                     # http://localhost:5173
```

Demo logins from `supabase/seed.sql`: `demo@interphone.local` / `demo1234` (apartment 1A),
`neighbour@interphone.local` / `demo1234` (apartment 2A). Visitor page: http://localhost:5173/d/demo-building

Scripts: `npm run dev`, `npm run build` (typecheck + bundle to `dist/`), `npm run typecheck`, `npm test` (vitest, pure helpers in `src/lib`).

## Testing from a phone on the same Wi-Fi

1. `npm run dev -- --host` and note the `http://192.168.x.y:5173` address Vite prints.
2. In `.env.local` set `VITE_SUPABASE_URL=http://192.168.x.y:54321` (the phone cannot reach `127.0.0.1`). Restart `npm run dev`. The laptop browser uses the same URL.
3. Allow node.exe and Docker through Windows Firewall when prompted (ports 5173 and 54321).
4. Generate the sticker: `node ../tools/make-qr/index.mjs demo-building http://192.168.x.y:5173` and scan it.

Over plain `http://` on a LAN IP the browser refuses service workers, so push notifications and
"install app" only work on the laptop at `http://localhost:5173` until the app is deployed over HTTPS.
The visitor page needs neither and works fine on the phone.

## Push notifications

1. `npx web-push generate-vapid-keys` once. Put the keys in `supabase/.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).
2. Put the same public key in `web/.env.local` as `VITE_VAPID_PUBLIC_KEY`. Without it the button is hidden.
3. Restart `supabase functions serve --env-file supabase/.env` and `npm run dev`.
4. On `http://localhost:5173/app` click **Enable notifications**. A row appears in `push_subscriptions`. Ringing the apartment now shows a browser notification; clicking it opens the app.

During development Chrome caches `public/sw.js`; tick "Update on reload" in DevTools → Application → Service Workers.

## Layout

```
src/main.tsx               React root + router
src/App.tsx                routes
src/pages/VisitorPage.tsx  /d/:slug state machine (loading → pick → ringing → done)
src/pages/ResidentPage.tsx /app session gate → LoginForm | Dashboard
src/components/            LoginForm, Dashboard
src/lib/api.ts             typed calls to the ring / respond edge functions
src/lib/supabase.ts        env + supabase-js client
src/lib/push.ts            service worker registration + push subscription
src/lib/visit.ts           pure helpers (stale/expired logic, labels), unit-tested
public/sw.js               service worker: show push notification, focus app on click
public/manifest.webmanifest, public/icon.svg   PWA install metadata
```
