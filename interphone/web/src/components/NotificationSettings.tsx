import { useCallback, useEffect, useRef, useState } from "react";
import { VAPID_PUBLIC_KEY } from "../lib/supabase";
import { enablePush, isPushEnabled, pushSupported } from "../lib/push";
import { copy } from "../lib/copy";
import { Button, Feedback, Icon } from "./ui";

type PushState = "checking" | "available" | "enabled" | "blocked" | "unsupported" | "unconfigured" | "error";
export default function NotificationSettings({ userId }: { userId: string }) {
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const lock = useRef(false);
  const generation = useRef(0);
  const check = useCallback(async () => {
    const current = ++generation.current;
    if (!pushSupported()) { setState("unsupported"); return; }
    if (Notification.permission === "denied") { setState("blocked"); return; }
    if (!VAPID_PUBLIC_KEY) { setState("unconfigured"); return; }
    try {
      const enabled = await isPushEnabled(userId);
      if (current === generation.current) setState(enabled ? "enabled" : "available");
    } catch (e) {
      console.error("Notification check failed", e);
      if (current === generation.current) setState("error");
    }
  }, [userId]);
  useEffect(() => {
    void check();
    const visible = () => { if (document.visibilityState === "visible" && !lock.current) void check(); };
    document.addEventListener("visibilitychange", visible);
    return () => { ++generation.current; document.removeEventListener("visibilitychange", visible); };
  }, [check]);

  async function enable() {
    if (lock.current || !VAPID_PUBLIC_KEY) return;
    lock.current = true;
    ++generation.current;
    setBusy(true);
    setError(false);
    try {
      const result = await enablePush(userId, VAPID_PUBLIC_KEY);
      if (result.ok) setState("enabled");
      else if (result.reason === "denied") setState(Notification.permission === "denied" ? "blocked" : "available");
      else if (result.reason === "unsupported") setState("unsupported");
      else { console.error("Push subscription failed", result); setError(true); }
    } catch (e) { console.error("Push subscription failed", e); setError(true); }
    finally { lock.current = false; setBusy(false); }
  }
  const c = copy.notifications;
  const text = {
    checking: [c.checking, c.detail], available: [c.available, c.detail],
    enabled: [c.enabled, c.enabledDetail], blocked: [c.blocked, c.blockedDetail],
    unsupported: [c.unsupported, c.unsupportedDetail], unconfigured: [c.unconfigured, c.unconfiguredDetail], error: [c.failed, c.detail],
  }[state];
  return <section className="panel side-panel"><h2><Icon name="bell" />{c.title}</h2>
    <p className="notification-state" role="status">{text[0]}</p><p className="subtle">{text[1]}</p>
    {error && <Feedback tone="error">{c.failed}</Feedback>}
    {state === "available" && <Button className="full-width" onClick={() => void enable()} disabled={busy}>{busy ? c.pending : c.enable}</Button>}
    {(state === "blocked" || state === "error") && <Button onClick={() => void check()}>{c.check}</Button>}
  </section>;
}
