// Public endpoint used by the visitor page (no login).
//   GET  /ring?building=<slug>            -> { building, apartments[] }
//   GET  /ring?visit=<id>                 -> { id, status }            (visitor polls this while waiting)
//   POST /ring { building, apartment_id, note? } -> { visit_id, status }
import { adminClient, clientIp, error, json, preflight, RING_TIMEOUT_SECONDS, userFromRequest } from "../_shared/http.ts";
import { pushToProfiles } from "../_shared/push.ts";

const RINGS_PER_IP_PER_MINUTE = 6;

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  const admin = adminClient();
  const url = new URL(req.url);

  if (req.method === "GET") {
    const visitId = url.searchParams.get("visit");
    if (visitId) {
      const me = await userFromRequest(req);
      if (!me) return error("visitor session required", 401);
      const { data: grant } = await admin.from("call_participants").select("visit_id")
        .eq("visit_id", visitId).eq("participant_id", me.user.id).maybeSingle();
      if (!grant) return error("visit not found", 404);
      await expireStaleVisit(admin, visitId);
      const { data, error: e } = await admin.from("visits").select("id, status, created_at").eq("id", visitId).single();
      if (e || !data) return error("visit not found", 404);
      return json(data);
    }
    const slug = url.searchParams.get("building");
    if (!slug) return error("building or visit parameter required");
    const { data: building } = await admin.from("buildings").select("id, slug, name").eq("slug", slug).single();
    if (!building) return error("building not found", 404);
    const { data: apartments } = await admin
      .from("apartments").select("id, label").eq("building_id", building.id).order("sort_order");
    const { data: device } = await admin
      .from("devices").select("last_seen_at").eq("building_id", building.id).order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
    const online = !!device?.last_seen_at && Date.now() - new Date(device.last_seen_at).getTime() < 15_000;
    return json({ building, apartments: apartments ?? [], door_online: online });
  }

  if (req.method !== "POST") return error("method not allowed", 405);
  const me = await userFromRequest(req);
  if (!me) return error("visitor session required", 401);

  let body: { building?: string; apartment_id?: string; note?: string; visit_id?: string; action?: string };
  try { body = await req.json(); } catch { return error("invalid json"); }
  if (body.action === "cancel" && body.visit_id) {
    const { data: grant } = await admin.from("call_participants").select("visit_id")
      .eq("visit_id", body.visit_id).eq("participant_id", me.user.id).eq("role", "visitor").maybeSingle();
    if (!grant) return error("visit not found", 404);
    const { data: cancelled } = await admin.from("visits")
      .update({ status: "cancelled", ended_at: new Date().toISOString() }).eq("id", body.visit_id)
      .in("status", ["ringing", "answered"]).select("id").maybeSingle();
    if (!cancelled) return error("call is no longer active", 409);
    return json({ ok: true, status: "cancelled" });
  }
  if (!body.building || !body.apartment_id) return error("building and apartment_id required");
  const note = (body.note ?? "").toString().slice(0, 140);
  const ip = clientIp(req);

  // rate limit per IP
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin.from("ring_log").select("*", { count: "exact", head: true }).eq("ip", ip).gte("created_at", since);
  if ((count ?? 0) >= RINGS_PER_IP_PER_MINUTE) return error("too many rings, try again in a minute", 429);

  const { data: apt } = await admin
    .from("apartments").select("id, label, building_id, buildings!inner(slug, name)")
    .eq("id", body.apartment_id).eq("buildings.slug", body.building).single();
  if (!apt) return error("apartment not found", 404);

  // Release abandoned ringing rows before checking the one-active-call invariant.
  await admin.from("visits").update({ status: "expired", ended_at: new Date().toISOString() })
    .eq("apartment_id", apt.id).eq("status", "ringing")
    .lt("created_at", new Date(Date.now() - RING_TIMEOUT_SECONDS * 1000).toISOString());

  // one ringing visit per apartment at a time: reuse it
  const { data: existing } = await admin
    .from("visits").select("id, status, created_at, call_participants!inner(participant_id)").eq("apartment_id", apt.id).eq("status", "ringing")
    .eq("call_participants.participant_id", me.user.id)
    .gte("created_at", new Date(Date.now() - RING_TIMEOUT_SECONDS * 1000).toISOString())
    .maybeSingle();
  if (existing) return json({ visit_id: existing.id, status: existing.status, reused: true });

  const { data: busy } = await admin.from("visits").select("id").eq("apartment_id", apt.id)
    .in("status", ["ringing", "answered"])
    .limit(1).maybeSingle();
  if (busy) return error("apartment is already receiving a call", 409);

  const { data: visit, error: insErr } = await admin
    .from("visits").insert({ apartment_id: apt.id, visitor_note: note || null, visitor_ip: ip })
    .select("id, status").single();
  if (insErr?.code === "23505") return error("apartment is already receiving a call", 409);
  if (insErr || !visit) return error("could not create visit", 500);
  const { error: grantErr } = await admin.from("call_participants")
    .insert({ visit_id: visit.id, participant_id: me.user.id, role: "visitor" });
  if (grantErr) {
    await admin.from("visits").delete().eq("id", visit.id);
    return error("could not authorize call", 500);
  }
  await admin.from("ring_log").insert({ ip });

  const { data: members } = await admin.from("apartment_members").select("profile_id").eq("apartment_id", apt.id);
  const push = await pushToProfiles(admin, (members ?? []).map((m) => m.profile_id), {
    title: `Visitor at the door — apartment ${apt.label}`,
    body: note ? `"${note}"` : "Someone is ringing. Open to see who it is.",
    url: `/app/visit/${visit.id}`,
    visit_id: visit.id,
    tag: `visit-${visit.id}`,
  });

  return json({ visit_id: visit.id, status: visit.status, push });
});

async function expireStaleVisit(admin: ReturnType<typeof adminClient>, visitId: string) {
  const cutoff = new Date(Date.now() - RING_TIMEOUT_SECONDS * 1000).toISOString();
  await admin.from("visits").update({ status: "expired", ended_at: new Date().toISOString() })
    .eq("id", visitId).eq("status", "ringing").lt("created_at", cutoff);
}
