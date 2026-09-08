import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, VAPID_PUBLIC_KEY } from "../lib/supabase";
import { ApiError, respond } from "../lib/api";
import { enablePush, isPushEnabled, pushSupported } from "../lib/push";
import { ageLabel, effectiveStatus, isActive, isDeviceOnline, type VisitStatus } from "../lib/visit";

const REFRESH_MS = 5000;

interface Apartment { id: string; label: string; building_id: string; building: { slug: string; name: string } }
interface ActiveVisit { id: string; status: VisitStatus; visitor_note: string | null; created_at: string }
type Flash = { kind: "ok" | "error" | "warn"; text: string } | null;

export default function Dashboard({ session }: { session: Session }) {
  const [apartment, setApartment] = useState<Apartment | null | undefined>(undefined);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [visit, setVisit] = useState<ActiveVisit | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [pushState, setPushState] = useState<"hidden" | "off" | "on">("hidden");
  const [, setTick] = useState(0); // re-render for age labels

  // Which apartment does this resident belong to? (RLS: only own membership rows are visible.)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("apartment_members")
        .select("apartment_id, apartments(id, label, building_id, buildings(slug, name))")
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data?.apartments) { setApartment(null); return; }
      // supabase-js types nested relations loosely; normalise here.
      const a = data.apartments as unknown as { id: string; label: string; building_id: string; buildings: { slug: string; name: string } };
      setApartment({ id: a.id, label: a.label, building_id: a.building_id, building: a.buildings });
    })();
    return () => { cancelled = true; };
  }, [session.user.id]);

  const refresh = useCallback(async () => {
    if (!apartment) return;
    const [dev, vis] = await Promise.all([
      supabase.from("devices").select("last_seen_at").eq("building_id", apartment.building_id)
        .order("last_seen_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
      supabase.from("visits").select("id, status, visitor_note, created_at").eq("apartment_id", apartment.id)
        .in("status", ["ringing", "answered"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setLastSeen(dev.data?.last_seen_at ?? null);
    const v = vis.data as ActiveVisit | null;
    setVisit(v && isActive(effectiveStatus(v)) ? v : null);
    setTick((t) => t + 1);
  }, [apartment]);

  // Poll + realtime.
  useEffect(() => {
    if (!apartment) return;
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    const channel = supabase
      .channel(`visits:${apartment.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "visits", filter: `apartment_id=eq.${apartment.id}` }, () => void refresh())
      .subscribe();
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [apartment, refresh]);

  // Push button state.
  useEffect(() => {
    if (!VAPID_PUBLIC_KEY || !pushSupported()) { setPushState("hidden"); return; }
    void isPushEnabled().then((on) => setPushState(on ? "on" : "off"));
  }, []);

  async function act(action: "unlock" | "deny", visitId?: string) {
    if (!apartment) return;
    setBusy(true);
    setFlash(null);
    try {
      const r = await respond(session.access_token, visitId ? { action, visit_id: visitId } : { action, apartment_id: apartment.id });
      if (action === "unlock") {
        if (r.door_online === false) setFlash({ kind: "warn", text: "Unlock sent, but the door controller is offline. It will be dropped after 30 s." });
        else setFlash({ kind: "ok", text: "Door unlocked" });
      } else {
        setFlash({ kind: "ok", text: "Visitor denied" });
      }
    } catch (e) {
      const err = e as ApiError;
      setFlash({ kind: "error", text: err.status === 409 ? `Too late: ${err.message}` : err.message });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  async function onEnablePush() {
    if (!VAPID_PUBLIC_KEY) return;
    const r = await enablePush(session.user.id, VAPID_PUBLIC_KEY);
    if (r.ok) { setPushState("on"); setFlash({ kind: "ok", text: "Notifications enabled on this device" }); }
    else if (r.reason === "denied") setFlash({ kind: "error", text: "Notifications are blocked in the browser settings." });
    else setFlash({ kind: "error", text: r.message ?? "Could not enable notifications" });
  }

  if (apartment === undefined) {
    return <div className="page"><div className="status"><h2 className="pulse">Loading...</h2></div></div>;
  }
  if (apartment === null) {
    return (
      <div className="page">
        <div className="header"><h1>Interphone</h1><button className="btn link" onClick={() => void supabase.auth.signOut()}>Log out</button></div>
        <div className="card"><p>Your account is not assigned to an apartment yet. Ask the building admin.</p></div>
      </div>
    );
  }

  const online = isDeviceOnline(lastSeen);
  return (
    <div className="page">
      <div className="header">
        <div>
          <h1>Apartment {apartment.label}</h1>
          <span className="subtle">
            {apartment.building.name} &middot; <span className={`dot ${online ? "online" : "offline"}`} />
            {online ? "Door online" : "Door offline"}
          </span>
        </div>
        <button className="btn link" onClick={() => void supabase.auth.signOut()}>Log out</button>
      </div>

      {visit && (
        <div className="card">
          <h2>Visitor at the door</h2>
          <p style={{ margin: "4px 0 12px" }}>
            {visit.visitor_note ? <q>{visit.visitor_note}</q> : <span className="subtle">No message</span>}
            <span className="subtle"> &middot; {ageLabel(visit.created_at)}</span>
          </p>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={() => void act("unlock", visit.id)}>Unlock</button>
            <button className="btn danger" disabled={busy} onClick={() => void act("deny", visit.id)}>Deny</button>
          </div>
        </div>
      )}

      {flash && <div className={`flash ${flash.kind === "ok" ? "" : flash.kind}`}>{flash.text}</div>}

      <button className="btn unlock" disabled={busy} onClick={() => void act("unlock")}>
        {busy ? "..." : "UNLOCK"}
      </button>
      <p className="subtle" style={{ textAlign: "center" }}>Opens the building door for a few seconds.</p>

      {pushState !== "hidden" && (
        <button className="btn" disabled={pushState === "on"} onClick={() => void onEnablePush()}>
          {pushState === "on" ? "Notifications on" : "Enable notifications"}
        </button>
      )}
    </div>
  );
}
