// Returns private signaling and ephemeral ICE configuration to an authorized call participant.
import { adminClient, error, json, preflight, userFromRequest } from "../_shared/http.ts";

const STUN: RTCIceServer = { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] };

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return error("method not allowed", 405);
  const me = await userFromRequest(req);
  if (!me) return error("login required", 401);

  let visitId = "";
  try { visitId = String((await req.json()).visit_id ?? ""); } catch { return error("invalid json"); }
  if (!/^[0-9a-f-]{36}$/i.test(visitId)) return error("valid visit_id required");

  const admin = adminClient();
  const { data: visit } = await admin.from("visits")
    .select("id, apartment_id, status, answered_by").eq("id", visitId).maybeSingle();
  if (!visit || !["ringing", "answered"].includes(visit.status)) return error("call is no longer available", 409);

  const { data: participant } = await admin.from("call_participants").select("role")
    .eq("visit_id", visitId).eq("participant_id", me.user.id).maybeSingle();
  let role: "visitor" | "resident" | null = participant?.role === "visitor" ? "visitor" : null;
  if (!role && visit.status === "answered" && visit.answered_by === me.user.id) {
    const { data: membership } = await admin.from("apartment_members").select("role")
      .eq("apartment_id", visit.apartment_id).eq("profile_id", me.user.id).maybeSingle();
    if (membership) role = "resident";
  }
  if (!role) return error("not authorized for this call", 403);

  let iceServers: RTCIceServer[] = [STUN];
  let degraded = true;
  const domain = (Deno.env.get("METERED_DOMAIN") ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const apiKey = Deno.env.get("METERED_TURN_API_KEY") ?? "";
  if (domain && apiKey) {
    try {
      const response = await fetch(`https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`);
      if (response.ok) {
        const configured = await response.json();
        if (Array.isArray(configured) && configured.length) {
          iceServers = [STUN, ...configured];
          degraded = false;
        }
      }
    } catch (e) { console.error("TURN lookup failed", e); }
  }

  return json({ topic: `call:${visit.id}`, role, ice_servers: iceServers, degraded });
});
