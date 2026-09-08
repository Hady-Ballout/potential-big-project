import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { ApiError, getBuilding, getVisitStatus, ring, type BuildingInfo } from "../lib/api";
import { isTerminal, statusLabel, type VisitStatus } from "../lib/visit";

const POLL_MS = 1500;

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string; retry: boolean }
  | { kind: "pick"; info: BuildingInfo; apartmentId?: string; note: string; sending: boolean; error?: string }
  | { kind: "ringing"; visitId: string; reused: boolean; status: "ringing" | "answered"; label: string }
  | { kind: "done"; status: VisitStatus };

export default function VisitorPage() {
  const { slug = "" } = useParams();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const load = useCallback(async (signal?: AbortSignal) => {
    setPhase({ kind: "loading" });
    try {
      const info = await getBuilding(slug, signal);
      setPhase({ kind: "pick", info, note: "", sending: false });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const err = e as ApiError;
      if (err.status === 404) setPhase({ kind: "error", message: "Unknown door. Check the sticker and try again.", retry: false });
      else setPhase({ kind: "error", message: err.message, retry: true });
    }
  }, [slug]);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  // Poll visit status while ringing.
  const visitId = phase.kind === "ringing" ? phase.visitId : null;
  const pollRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!visitId) return;
    let stopped = false;
    const tick = async () => {
      pollRef.current?.abort();
      const ac = new AbortController();
      pollRef.current = ac;
      try {
        const v = await getVisitStatus(visitId, ac.signal);
        if (stopped) return;
        if (isTerminal(v.status)) setPhase({ kind: "done", status: v.status });
        else setPhase((p) => (p.kind === "ringing" ? { ...p, status: v.status as "ringing" | "answered" } : p));
      } catch {
        /* transient: keep polling */
      }
    };
    const id = setInterval(tick, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      pollRef.current?.abort();
    };
  }, [visitId]);

  async function doRing() {
    if (phase.kind !== "pick" || !phase.apartmentId) return;
    const { info, apartmentId, note } = phase;
    setPhase({ ...phase, sending: true, error: undefined });
    try {
      const r = await ring({ building: info.building.slug, apartment_id: apartmentId, note: note.trim() || undefined });
      const label = info.apartments.find((a) => a.id === apartmentId)?.label ?? "";
      setPhase({ kind: "ringing", visitId: r.visit_id, reused: !!r.reused, status: "ringing", label });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 404) { void load(); return; }
      const message = err.status === 429 ? "Too many rings. Please wait a minute and try again." : err.message;
      setPhase({ ...phase, sending: false, error: message });
    }
  }

  if (phase.kind === "loading") {
    return <div className="page"><div className="status"><h2 className="pulse">Loading...</h2></div></div>;
  }

  if (phase.kind === "error") {
    return (
      <div className="page">
        <div className="status bad">
          <h2>Oops</h2>
          <p className="subtle">{phase.message}</p>
          {phase.retry && <button className="btn" onClick={() => void load()}>Retry</button>}
        </div>
      </div>
    );
  }

  if (phase.kind === "ringing") {
    const l = statusLabel(phase.status, "visitor");
    return (
      <div className="page">
        <div className="status">
          <h2 className="pulse">{l.title}</h2>
          <p className="subtle">Apartment {phase.label}. {l.detail}</p>
          {phase.reused && <p className="flash warn">Someone already rang this apartment a moment ago. Waiting for the answer.</p>}
        </div>
      </div>
    );
  }

  if (phase.kind === "done") {
    const l = statusLabel(phase.status, "visitor");
    const ok = phase.status === "unlocked";
    return (
      <div className="page">
        <div className={`status ${ok ? "ok" : "bad"}`}>
          <h2>{l.title}</h2>
          <p className="subtle">{l.detail}</p>
          <button className="btn" onClick={() => void load()}>Ring again</button>
        </div>
      </div>
    );
  }

  const { info } = phase;
  return (
    <div className="page">
      <div className="header">
        <div>
          <h1>{info.building.name}</h1>
          <span className="subtle">
            <span className={`dot ${info.door_online ? "online" : "offline"}`} />
            {info.door_online ? "Door online" : "Door offline"}
          </span>
        </div>
      </div>

      <div className="card">
        <h2>Who are you visiting?</h2>
        {info.apartments.length === 0 && <p className="subtle">No apartments configured for this door.</p>}
        <div className="grid">
          {info.apartments.map((a) => (
            <button
              key={a.id}
              className={`apt ${phase.apartmentId === a.id ? "selected" : ""}`}
              onClick={() => setPhase({ ...phase, apartmentId: a.id, error: undefined })}
              disabled={phase.sending}
            >
              {a.label}
            </button>
          ))}
        </div>
        <textarea
          className="note"
          placeholder="Optional message (e.g. DHL delivery)"
          maxLength={140}
          value={phase.note}
          onChange={(e) => setPhase({ ...phase, note: e.target.value })}
          disabled={phase.sending}
        />
        <div className="subtle" style={{ textAlign: "right" }}>{phase.note.length}/140</div>
        {phase.error && <div className="flash error">{phase.error}</div>}
        <button className="btn primary" disabled={!phase.apartmentId || phase.sending} onClick={() => void doRing()}>
          {phase.sending ? "Ringing..." : "Ring"}
        </button>
      </div>
    </div>
  );
}
