// Web Push to every subscription of the given profiles. Never throws: a push failure must not
// break the ring. Requires VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT secrets
// (`supabase secrets set ...`); generate keys once with `npx web-push generate-vapid-keys`.
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  visit_id?: string;
  tag?: string;
}

export async function pushToProfiles(admin: SupabaseClient, profileIds: string[], payload: PushPayload) {
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
  if (!pub || !priv || profileIds.length === 0) return { sent: 0, skipped: true };
  webpush.setVapidDetails(subject, pub, priv);

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("profile_id", profileIds);

  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60, urgency: "high" },
      );
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await admin.from("push_subscriptions").delete().eq("id", s.id); // subscription is dead
      } else {
        console.error("push failed", s.endpoint, e);
      }
    }
  }
  return { sent, skipped: false };
}
