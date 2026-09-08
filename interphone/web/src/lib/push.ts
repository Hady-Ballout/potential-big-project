// Web Push subscription for the resident app. Works only in a secure context (https or localhost).
import { supabase } from "./supabase";
import { urlBase64ToUint8Array } from "./base64";

export { urlBase64ToUint8Array };

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export type EnablePushResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "denied" | "error"; message?: string };

export async function enablePush(profileId: string, vapidPublicKey: string): Promise<EnablePushResult> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, reason: "denied" };
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      }));
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { ok: false, reason: "error", message: "Subscription is missing keys" };
    }
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        profile_id: profileId,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        user_agent: navigator.userAgent,
      },
      { onConflict: "endpoint" },
    );
    if (error) return { ok: false, reason: "error", message: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "error", message: (e as Error).message };
  }
}

export async function isPushEnabled(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!reg) return false;
  return (await reg.pushManager.getSubscription()) != null;
}
