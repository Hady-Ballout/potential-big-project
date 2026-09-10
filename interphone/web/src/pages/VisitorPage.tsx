import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { ApiError, cancelVisit, getBuilding, getVisitStatus, ring, type BuildingInfo } from "../lib/api";
import { isTerminal, statusLabel, type VisitStatus } from "../lib/visit";
import { copy } from "../lib/copy";
import { Button, ConnectionStatus, Feedback, Field, Icon, Loading, Page, StatePanel } from "../components/ui";
import MediaCall from "../components/MediaCall";
import { mediaDevices, prepareVisitorMedia } from "../lib/webrtc";
import { visitorSession } from "../lib/supabase";

const POLL_MS = 1500;
type Context = { info: BuildingInfo; apartmentId: string; note: string; label: string };
type Phase =
  | { kind: "loading" }
  | { kind: "error"; missing: boolean }
  | { kind: "pick"; info: BuildingInfo; apartmentId?: string; note: string; sending: boolean; error?: string; failures: number; checkedAt: number }
  | ({ kind: "ringing"; visitId: string; reused: boolean; status: VisitStatus; createdAt: string; failures: number } & Context)
  | ({ kind: "done"; status: VisitStatus } & Context)
  | ({ kind: "unavailable" } & Context);

export default function VisitorPage() {
  const { slug = "" } = useParams();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [now, setNow] = useState(Date.now());
  const sending = useRef(false);
  const loadController = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const preview = useRef<HTMLVideoElement>(null);
  const [accessToken, setAccessToken] = useState("");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [devices, setDevices] = useState<{ cameras: MediaDeviceInfo[]; microphones: MediaDeviceInfo[] }>({ cameras: [], microphones: [] });
  const [cameraId, setCameraId] = useState("");
  const [microphoneId, setMicrophoneId] = useState("");

  const load = useCallback(async (apartmentId?: string, note = "") => {
    const current = ++generation.current;
    loadController.current?.abort();
    const ac = new AbortController();
    loadController.current = ac;
    setPhase({ kind: "loading" });
    try {
      const info = await getBuilding(slug, ac.signal);
      if (current !== generation.current) return;
      setPhase({ kind: "pick", info, apartmentId: info.apartments.some(a => a.id === apartmentId) ? apartmentId : undefined, note, sending: false, failures: 0, checkedAt: Date.now() });
    } catch (e) {
      if (ac.signal.aborted || current !== generation.current) return;
      console.error("Entrance lookup failed", e);
      setPhase({ kind: "error", missing: (e as ApiError).status === 404 });
    }
  }, [slug]);

  useEffect(() => {
    void load();
    return () => { ++generation.current; loadController.current?.abort(); };
  }, [load]);

  // Keep the connection badge current while a visitor chooses an apartment, without resetting their form.
  const picking = phase.kind === "pick";
  useEffect(() => {
    if (!picking) return;
    let stopped = false;
    let inFlight = false;
    let ac: AbortController | undefined;
    const refresh = async () => {
      if (inFlight || sending.current) return;
      inFlight = true;
      ac = new AbortController();
      try {
        const info = await getBuilding(slug, ac.signal);
        if (!stopped) setPhase(p => p.kind === "pick" ? { ...p, info, failures: 0, checkedAt: Date.now(), apartmentId: info.apartments.some(a => a.id === p.apartmentId) ? p.apartmentId : undefined } : p);
      } catch (e) {
        if (!stopped) {
          console.error("Entrance connection refresh failed", e);
          setPhase(p => p.kind === "pick" ? { ...p, failures: p.failures + 1 } : p);
        }
      } finally { inFlight = false; }
    };
    const poll = window.setInterval(() => void refresh(), 5000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; ac?.abort(); clearInterval(poll); clearInterval(clock); document.removeEventListener("visibilitychange", visible); };
  }, [picking, slug]);

  const visitId = phase.kind === "ringing" ? phase.visitId : null;
  useEffect(() => {
    if (!visitId) return;
    let stopped = false;
    let inFlight = false;
    let controller: AbortController | undefined;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      controller = new AbortController();
      try {
        if (!accessToken) return;
        const v = await getVisitStatus(accessToken, visitId, controller.signal);
        if (stopped) return;
        setPhase(p => {
          if (p.kind !== "ringing" || p.visitId !== visitId) return p;
          return isTerminal(v.status) ? { ...p, kind: "done", status: v.status }
            : { ...p, status: v.status, createdAt: v.created_at, failures: 0 };
        });
      } catch (e) {
        if (stopped) return;
        console.error("Visit refresh failed", e);
        if ((e as ApiError).status === 404) {
          setPhase(p => p.kind === "ringing" && p.visitId === visitId ? { ...p, kind: "unavailable" } : p);
          return;
        }
        setPhase(p => p.kind === "ringing" && p.visitId === visitId ? { ...p, failures: p.failures + 1 } : p);
      } finally { inFlight = false; }
    };
    const id = window.setInterval(() => void tick(), POLL_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const visible = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", visible);
    void tick();
    return () => { stopped = true; controller?.abort(); clearInterval(id); clearInterval(clock); document.removeEventListener("visibilitychange", visible); };
  }, [visitId, accessToken]);

  useEffect(() => {
    if (preview.current) preview.current.srcObject = localStream;
  }, [localStream, phase.kind]);
  useEffect(() => () => { localStream?.getTracks().forEach(track => track.stop()); }, [localStream]);

  async function prepareMedia(nextCamera = cameraId, nextMicrophone = microphoneId) {
    if (preparing) return;
    setPreparing(true); setMediaError("");
    try {
      localStream?.getTracks().forEach(track => track.stop());
      const stream = await prepareVisitorMedia(nextCamera || undefined, nextMicrophone || undefined);
      setLocalStream(stream);
      const found = await mediaDevices();
      setDevices(found);
      setCameraId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? nextCamera);
      setMicrophoneId(stream.getAudioTracks()[0]?.getSettings().deviceId ?? nextMicrophone);
    } catch (e) {
      console.error("Visitor media permission failed", e);
      setLocalStream(null);
      setMediaError("Camera or microphone is unavailable. You can still ring without media.");
    } finally { setPreparing(false); }
  }

  async function doRing() {
    if (phase.kind !== "pick" || !phase.apartmentId || sending.current) return;
    sending.current = true;
    const current = generation.current;
    const { info, apartmentId, note } = phase;
    setPhase({ ...phase, sending: true, error: undefined });
    try {
      const session = await visitorSession();
      setAccessToken(session.access_token);
      const r = await ring(session.access_token, { building: info.building.slug, apartment_id: apartmentId, note: note.trim() || undefined });
      if (current !== generation.current) return;
      const context = { info, apartmentId, note, label: info.apartments.find(a => a.id === apartmentId)?.label ?? "" };
      if (isTerminal(r.status)) setPhase({ ...context, kind: "done", status: r.status });
      else setPhase({ ...context, kind: "ringing", visitId: r.visit_id, reused: !!r.reused, status: r.status, createdAt: new Date().toISOString(), failures: 0 });
      setNow(Date.now());
    } catch (e) {
      if (current !== generation.current) return;
      console.error("Ring failed", e);
      const err = e as ApiError;
      if (err.status === 404) { void load(); return; }
      setPhase({ ...phase, sending: false, error: err.status === 429 ? copy.visitor.limited : err.status === 409 ? "That apartment is already receiving another call. Please try again shortly." : err.status === 0 ? copy.network : copy.visitor.ringFailed });
    } finally { sending.current = false; }
  }

  async function cancel() {
    if (phase.kind !== "ringing" || !accessToken) return;
    const current = phase;
    try {
      await cancelVisit(accessToken, phase.visitId);
      setPhase({ ...current, kind: "done", status: "cancelled" });
    } catch (e) {
      console.error("Cancel failed", e);
      setPhase(p => p.kind === "ringing" ? { ...p, failures: p.failures + 1 } : p);
    }
  }

  const info = "info" in phase ? phase.info : null;
  const selectedLabel = phase.kind === "pick" ? info?.apartments.find(a => a.id === phase.apartmentId)?.label : "label" in phase ? phase.label : undefined;
  const stale = phase.kind === "pick" && (phase.failures > 0 || now - phase.checkedAt > 12_000);
  return <Page context={copy.visitor.eyebrow}>
    {info && <div className="entrance-context"><p className="eyebrow">{copy.entrance}</p><p className="entrance-name">{info.building.name}</p>
      {phase.kind === "pick" ? <ConnectionStatus online={stale ? null : info.door_online} /> : <p className="subtle">{copy.apartment(selectedLabel ?? "")}</p>}
    </div>}
    {phase.kind === "loading" && <Loading />}
    {phase.kind === "error" && <StatePanel focus title={phase.missing ? copy.visitor.unknown : copy.visitor.loadFailed} detail={phase.missing ? copy.visitor.unknownDetail : copy.network}>
      {!phase.missing && <Button onClick={() => void load()}>{copy.retry}</Button>}
    </StatePanel>}
    {phase.kind === "pick" && <>
      <div className="page-heading"><h1>{copy.visitor.title}</h1><p className="subtle">{copy.visitor.detail}</p></div>
      {phase.info.apartments.length === 0 ? <StatePanel title={copy.visitor.empty} detail={copy.visitor.emptyDetail} /> :
        <form className="panel stack" onSubmit={e => { e.preventDefault(); void doRing(); }} aria-busy={phase.sending}>
          {stale ? <Feedback tone="warn">{phase.failures >= 2 ? copy.reconnecting : copy.stale}</Feedback> : !phase.info.door_online && <Feedback tone="warn">{copy.visitor.offline}</Feedback>}
          <fieldset className="apartment-fieldset" disabled={phase.sending}><legend>{copy.visitor.apartments}</legend><div className="apartment-grid">
            {phase.info.apartments.map(a => <label className="apartment-option" key={a.id}>
              <input type="radio" name="apartment" value={a.id} checked={phase.apartmentId === a.id} onChange={() => setPhase({ ...phase, apartmentId: a.id, error: undefined })} aria-label={copy.apartment(a.label)} />
              <span className="apartment-label">{a.label}<Icon name="check" /></span>
            </label>)}
          </div></fieldset>
          <Field id="visitor-note" label={copy.visitor.message} hint={copy.optional}>
            <textarea id="visitor-note" placeholder={copy.visitor.placeholder} maxLength={140} value={phase.note} onChange={e => setPhase({ ...phase, note: e.target.value })} disabled={phase.sending} aria-describedby="note-count" />
            <span className="character-count" id="note-count">{copy.visitor.count(phase.note.length)}</span>
          </Field>
          <section className="media-setup" aria-labelledby="media-setup-title">
            <div><strong id="media-setup-title">Camera and microphone</strong><p className="subtle">Preview your camera before ringing. The resident will see you only after answering.</p></div>
            {localStream ? <>
              <video ref={preview} className="media-preview" autoPlay muted playsInline aria-label="Your camera preview" />
              <div className="device-selects">
                {devices.cameras.length > 1 && <Field id="visitor-camera" label="Camera"><select id="visitor-camera" value={cameraId} onChange={e => { setCameraId(e.target.value); void prepareMedia(e.target.value, microphoneId); }}>{devices.cameras.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select></Field>}
                {devices.microphones.length > 1 && <Field id="visitor-microphone" label="Microphone"><select id="visitor-microphone" value={microphoneId} onChange={e => { setMicrophoneId(e.target.value); void prepareMedia(cameraId, e.target.value); }}>{devices.microphones.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}</select></Field>}
              </div>
              <Button variant="quiet" onClick={() => { localStream.getTracks().forEach(track => track.stop()); setLocalStream(null); }}>Continue without media</Button>
            </> : <Button onClick={() => void prepareMedia()} disabled={preparing}>{preparing ? "Opening camera…" : "Set up camera and microphone"}</Button>}
            {mediaError && <Feedback tone="warn">{mediaError}</Feedback>}
          </section>
          {phase.error && <Feedback tone="error">{phase.error}</Feedback>}
          <Button type="submit" variant="primary" disabled={!phase.apartmentId || phase.sending}><Icon name="bell" />{phase.sending ? copy.visitor.sending : selectedLabel ? copy.visitor.ringApartment(selectedLabel) : copy.visitor.ring}</Button>
        </form>}
      <p className="subtle form-help">{copy.visitor.footer}</p>
    </>}
    {phase.kind === "ringing" && <StatePanel focus icon="bell" title={phase.status === "answered" ? copy.visitor.answered : copy.visitor.waiting} detail={phase.status === "answered" ? copy.visitor.answeredDetail : copy.visitor.waitingDetail}>
      <span className="elapsed">{copy.visitor.elapsed(Math.max(0, Math.floor((now - Date.parse(phase.createdAt)) / 1000)))}</span>
      {phase.status === "answered" && localStream && accessToken && <MediaCall accessToken={accessToken} visitId={phase.visitId} role="visitor" localStream={localStream} />}
      {phase.status === "answered" && !localStream && <Feedback>Continuing without camera or voice.</Feedback>}
      {phase.reused && <Feedback>{copy.visitor.reused}</Feedback>}
      {phase.failures > 0 && <Feedback tone="warn">{phase.failures >= 2 ? copy.reconnecting : copy.stale}</Feedback>}
      <Button variant="quiet" onClick={() => void cancel()}>Cancel request</Button>
    </StatePanel>}
    {phase.kind === "done" && <StatePanel focus icon={phase.status === "unlocked" ? "check" : phase.status === "expired" ? "clock" : "info"} title={statusLabel(phase.status, "visitor").title} detail={statusLabel(phase.status, "visitor").detail}>
      <div className="stack">{phase.status !== "unlocked" && <Button variant="primary" onClick={() => void load(phase.apartmentId, phase.note)}>{copy.retry}</Button>}
        <Button variant="quiet" onClick={() => void load()}>{phase.status === "unlocked" ? copy.visitor.back : copy.visitor.chooseAnother}</Button>
      </div>
    </StatePanel>}
    {phase.kind === "unavailable" && <StatePanel focus title={copy.visitor.unavailable} detail={copy.visitor.unavailableDetail}><Button onClick={() => void load()}>{copy.visitor.back}</Button></StatePanel>}
  </Page>;
}
