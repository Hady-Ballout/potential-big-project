#!/usr/bin/env node
// Virtual door controller: behaves like firmware/src/net_client.cpp + door_controller, but on your laptop.
// Lets you demo the whole cloud -> door path with no ESP32 and no Wokwi.
//
//   SUPABASE_FUNCTIONS_URL=http://127.0.0.1:54321/functions/v1 DEVICE_TOKEN=demo-device-token-change-me node index.mjs
//
// Prints a line per poll only when something changes. On "unlock" it shows the relay energised for 3 s.

const url = (process.env.SUPABASE_FUNCTIONS_URL ?? "http://127.0.0.1:54321/functions/v1").replace(/\/$/, "");
const token = process.env.DEVICE_TOKEN ?? "demo-device-token-change-me";
const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? 1000);
const UNLOCK_MS = 3000;
const COOLDOWN_MS = 1000;

let state = "IDLE";
let ack = [];
let online = false;
let stateUntil = 0;

const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[${ts()}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setState(s, forMs = 0) {
  state = s;
  stateUntil = forMs ? Date.now() + forMs : 0;
  log(`door -> ${s}` + (s === "UNLOCKING" ? "   *** RELAY ON, lock open ***" : ""));
}

async function tickState() {
  if (stateUntil && Date.now() >= stateUntil) {
    if (state === "UNLOCKING") setState("COOLDOWN", COOLDOWN_MS);
    else if (state === "COOLDOWN") setState("IDLE");
  }
}

async function poll() {
  const res = await fetch(`${url}/device-poll`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-token": token },
    body: JSON.stringify({ fw: "virtual-0.1.0", state, ack }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  ack = [];
  for (const cmd of data.commands ?? []) {
    log(`command ${cmd.action} (${cmd.id})` + (cmd.visit_id ? ` for visit ${cmd.visit_id}` : ""));
    if (cmd.action === "unlock") {
      if (state === "IDLE" || state === "LOCAL_RING") setState("UNLOCKING", UNLOCK_MS);
      else log(`  rejected: door is ${state}`);
    } else if (cmd.action === "deny") {
      log("  buzzer: denied pattern");
    }
    ack.push(cmd.id);
  }
}

log(`virtual device polling ${url}/device-poll every ${POLL_MS} ms (Ctrl+C to stop)`);
for (;;) {
  try {
    await poll();
    if (!online) { online = true; log("backend online"); }
  } catch (e) {
    if (online || !stateUntil) { log(`poll failed: ${e.message}`); }
    online = false;
  }
  await tickState();
  await sleep(POLL_MS);
}
