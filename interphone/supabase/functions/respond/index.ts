// Resident action on a visit (requires a logged-in user who is a member of the visit's apartment).
//   POST /respond { visit_id, action: "answer" | "unlock" | "deny" }
//   "answer" marks the visit answered (call picked up), "unlock" queues a door command, "deny" ends it.
//   POST /respond { action: "unlock", apartment_id } — unlock without a visit (resident lets themselves in).
import { adminClient, error, json, preflight, userFromRequest } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return error("method not allowed", 405);

  const me = await userFromRequest(req);
  if (!me) return error("login required", 401);

  let body: { visit_id?: string; apartment_id?: string; action?: string };
  try { body = await req.json(); } catch { return error("invalid json"); }
  const action = body.action;
  if (!action || !["answer", "unlock", "deny"].includes(action)) return error("action must be answer|unlock|deny");

  const admin = adminClient();

  // Resolve the apartment either from the visit or directly.
  let apartmentId = body.apartment_id ?? null;
  let visit: { id: string; status: string; apartment_id: string } | null = null;
  if (body.visit_id) {
    const { data } = await admin.from("visits").select("id, status, apartment_id").eq("id", body.visit_id).single();
    if (!data) return error("visit not found", 404);
    visit = data;
    apartmentId = data.apartment_id;
  }
  if (!apartmentId) return error("visit_id or apartment_id required");

  // Membership check (done with the service client but against the caller's uid).
  const { data: membership } = await admin
    .from("apartment_members").select("role").eq("apartment_id", apartmentId).eq("profile_id", me.user.id).maybeSingle();
  if (!membership) return error("not a member of this apartment", 403);

  const now = new Date().toISOString();

  if (action === "answer") {
    if (!visit) return error("visit_id required for answer");
    if (visit.status !== "ringing") return error(`visit is ${visit.status}`, 409);
    const { data: claimed, error: claimError } = await admin.from("visits")
      .update({ status: "answered", answered_by: me.user.id, answered_at: now })
      .eq("id", visit.id).eq("status", "ringing").select("id").maybeSingle();
    if (claimError) return error("could not answer visit", 500);
    if (!claimed) return error("visit was answered by another resident", 409);
    const { error: grantError } = await admin.from("call_participants")
      .insert({ visit_id: visit.id, participant_id: me.user.id, role: "resident" });
    if (grantError) {
      await admin.from("visits").update({ status: "ringing", answered_by: null, answered_at: null })
        .eq("id", visit.id).eq("answered_by", me.user.id);
      return error("could not authorize call", 500);
    }
    return json({ ok: true, status: "answered" });
  }

  if (action === "deny") {
    if (!visit) return error("visit_id required for deny");
    if (!["ringing", "answered"].includes(visit.status)) return error(`visit is ${visit.status}`, 409);
    await admin.from("visits").update({ status: "denied", answered_by: me.user.id, answered_at: visit.status === "ringing" ? now : undefined, ended_at: now }).eq("id", visit.id);
    return json({ ok: true, status: "denied" });
  }

  // unlock
  if (visit && !["ringing", "answered"].includes(visit.status)) return error(`visit is ${visit.status}`, 409);
  const { data: apt } = await admin.from("apartments").select("building_id").eq("id", apartmentId).single();
  const { data: device } = await admin
    .from("devices").select("id, last_seen_at").eq("building_id", apt!.building_id)
    .order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
  if (!device) return error("no door controller registered for this building", 409);

  const { data: cmd, error: cmdErr } = await admin.from("door_commands")
    .insert({ device_id: device.id, visit_id: visit?.id ?? null, action: "unlock", created_by: me.user.id })
    .select("id, expires_at").single();
  if (cmdErr || !cmd) return error("could not queue unlock", 500);

  if (visit) {
    await admin.from("visits").update({ status: "unlocked", answered_by: me.user.id, answered_at: visit.status === "ringing" ? now : undefined, ended_at: now }).eq("id", visit.id);
  }
  const online = !!device.last_seen_at && Date.now() - new Date(device.last_seen_at).getTime() < 15_000;
  return json({ ok: true, status: "unlocked", command_id: cmd.id, door_online: online });
});
