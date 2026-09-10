import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import type { VisitStatus } from "./visit";

export interface Apartment { id: string; label: string; building_id: string; building: { slug: string; name: string } }
export interface Visit { id: string; status: VisitStatus; visitor_note: string | null; created_at: string; answered_by: string | null }
export interface Snapshot { visit: Visit | null; lastSeen: string | null; fetchedAt: number }

export function useApartment(userId: string) {
  const [apartment, setApartment] = useState<Apartment | null>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    const timeout = window.setTimeout(() => ac.abort(), 12_000);
    let stopped = false;
    setApartment(undefined);
    setError(false);
    void (async () => {
      try {
        const { data, error: queryError } = await supabase.from("apartment_members")
          .select("apartment_id, apartments(id, label, building_id, buildings(slug, name))")
          .order("apartment_id").limit(1).abortSignal(ac.signal).maybeSingle().retry(false);
        if (queryError) throw queryError;
        if (stopped) return;
        if (!data?.apartments) { setApartment(null); return; }
        const a = data.apartments as unknown as { id: string; label: string; building_id: string; buildings: { slug: string; name: string } };
        setApartment({ id: a.id, label: a.label, building_id: a.building_id, building: a.buildings });
      } catch (e) {
        if (!stopped) { console.error("Apartment lookup failed", e); setError(true); }
      } finally { clearTimeout(timeout); }
    })();
    return () => { stopped = true; ac.abort(); clearTimeout(timeout); };
  }, [userId, attempt]);
  return { apartment, error, retry: () => setAttempt(a => a + 1) };
}

export function useEntrance(apartment: Apartment | null | undefined, visitId?: string) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failures, setFailures] = useState(0);
  const [now, setNow] = useState(Date.now());
  const requestRefresh = useRef<() => void>(() => undefined);
  const refresh = useCallback(() => requestRefresh.current(), []);
  useEffect(() => {
    if (!apartment) return;
    setSnapshot(null);
    setFailures(0);
    let stopped = false;
    let inFlight = false;
    let rerun = false;
    let ac: AbortController | undefined;
    const tick = async () => {
      if (inFlight) { rerun = true; return; }
      inFlight = true;
      ac = new AbortController();
      const timeout = window.setTimeout(() => ac?.abort(), 12_000);
      try {
        let query = supabase.from("visits").select("id, status, visitor_note, created_at, answered_by").eq("apartment_id", apartment.id);
        query = visitId ? query.eq("id", visitId) : query.in("status", ["ringing", "answered"]).order("created_at", { ascending: false }).limit(1);
        const [dev, vis] = await Promise.all([
          supabase.from("devices").select("last_seen_at").eq("building_id", apartment.building_id)
            .order("last_seen_at", { ascending: false, nullsFirst: false }).limit(1).abortSignal(ac.signal).maybeSingle().retry(false),
          query.abortSignal(ac.signal).maybeSingle().retry(false),
        ]);
        if (dev.error) throw dev.error;
        if (vis.error) throw vis.error;
        if (stopped) return;
        setSnapshot({ visit: vis.data as Visit | null, lastSeen: dev.data?.last_seen_at ?? null, fetchedAt: Date.now() });
        setFailures(0);
        setNow(Date.now());
      } catch (e) {
        if (!stopped) { console.error("Entrance refresh failed", e); setFailures(n => n + 1); }
      } finally {
        clearTimeout(timeout);
        inFlight = false;
        if (rerun && !stopped) { rerun = false; void tick(); }
      }
    };
    // Polling owns retries here; SDK retries would delay stale/error feedback.
    requestRefresh.current = () => void tick();
    void tick();
    const poll = window.setInterval(() => void tick(), 5000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const visible = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", visible);
    const channel = supabase.channel(`visits:${apartment.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "visits", filter: `apartment_id=eq.${apartment.id}` }, () => void tick()).subscribe();
    return () => { stopped = true; requestRefresh.current = () => undefined; ac?.abort(); clearInterval(poll); clearInterval(clock); document.removeEventListener("visibilitychange", visible); void supabase.removeChannel(channel); };
  }, [apartment, visitId]);
  return { snapshot, failures, now, refresh };
}
