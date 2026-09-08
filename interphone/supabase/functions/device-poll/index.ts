// Called by the door controller every POLL_INTERVAL_MS (firmware/src/net_client.cpp) and by
// tools/virtual-device. Authenticated by the x-device-token header (sha256 compared to device_tokens.token_hash).
//   POST /device-poll { fw, state, ack: [command ids executed] }
//   -> { commands: [{ id, action, visit_id }], server_time }
import { adminClient, error, json, preflight, sha256Hex } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return error("method not allowed", 405);

  const token = req.headers.get("x-device-token");
  if (!token) return error("missing x-device-token", 401);
  const admin = adminClient();
  const { data: tok } = await admin.from("device_tokens").select("device_id").eq("token_hash", await sha256Hex(token)).maybeSingle();
  if (!tok) return error("unknown device", 401);
  const device = { id: tok.device_id };

  let body: { fw?: string; state?: string; ack?: string[] } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const now = new Date().toISOString();

  await admin.from("devices").update({
    last_seen_at: now,
    fw_version: body.fw ?? null,
    last_state: body.state ?? null,
  }).eq("id", device.id);

  if (Array.isArray(body.ack) && body.ack.length) {
    await admin.from("door_commands").update({ acked_at: now })
      .eq("device_id", device.id).in("id", body.ack.slice(0, 16)).is("acked_at", null);
  }

  const { data: pending } = await admin.from("door_commands")
    .select("id, action, visit_id").eq("device_id", device.id)
    .is("delivered_at", null).gt("expires_at", now)
    .order("created_at").limit(8);

  if (pending && pending.length) {
    await admin.from("door_commands").update({ delivered_at: now }).in("id", pending.map((c) => c.id));
  }

  return json({ commands: pending ?? [], server_time: now });
});
