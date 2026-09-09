import { useRef, useState } from "react";
import { Link } from "react-router";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { ApiError, respond } from "../lib/api";
import { ageLabel, effectiveStatus, isActive, isDeviceOnline, statusLabel } from "../lib/visit";
import { useApartment, useEntrance } from "../lib/useResidentData";
import { copy } from "../lib/copy";
import NotificationSettings from "./NotificationSettings";
import { Button, ConnectionStatus, Feedback, Icon, Loading, Page, StatePanel } from "./ui";

type Flash = { tone: "success" | "error" | "warn"; title?: string; text: string };
export default function Dashboard({ session, visitId }: { session: Session; visitId?: string }) {
  const { apartment, error, retry } = useApartment(session.user.id);
  const { snapshot, failures, now, refresh } = useEntrance(apartment, visitId);
  const [busy, setBusy] = useState<"unlock" | "deny" | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [completed, setCompleted] = useState<{ id: string; status: "unlocked" | "denied" } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const lock = useRef(false);
  const stale = !!snapshot && (failures > 0 || now - snapshot.fetchedAt > 12_000);
  const online = snapshot && !stale ? isDeviceOnline(snapshot.lastSeen, now) : null;
  const rawVisit = snapshot?.visit;
  const status = rawVisit ? rawVisit.id === completed?.id ? completed.status : effectiveStatus(rawVisit, stale ? snapshot!.fetchedAt : now) : null;
  const activeVisit = rawVisit && status && isActive(status) ? rawVisit : null;
  const c = copy.resident;

  async function act(action: "unlock" | "deny", id?: string) {
    if (!apartment || lock.current || stale || !snapshot || (action === "unlock" && online !== true)) return;
    lock.current = true;
    setBusy(action);
    setFlash(null);
    try {
      const r = await respond(session.access_token, id ? { action, visit_id: id } : { action, apartment_id: apartment.id });
      if (id) setCompleted({ id, status: action === "deny" ? "denied" : "unlocked" });
      setFlash(action === "deny" ? { tone: "success", title: c.declined, text: c.declineDetail }
        : r.door_online === false ? { tone: "warn", title: c.sent, text: c.queuedOffline }
        : { tone: "success", title: c.sent, text: c.sentDetail });
    } catch (e) {
      console.error("Resident action failed", e);
      const err = e as ApiError;
      setFlash({ tone: "error", text: err.status === 409 ? c.conflict : err.status === 401 ? c.sessionExpired
        : err.status === 403 ? c.denied : err.status === 0 ? c.actionUnknown : c.actionFailed });
    } finally { lock.current = false; setBusy(null); refresh(); }
  }
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try { const { error } = await supabase.auth.signOut(); if (error) throw error; }
    catch (e) { console.error("Sign-out failed", e); setFlash({ tone: "error", text: c.signOutFailed }); }
    finally { setSigningOut(false); }
  }
  const account = <div className="account-row"><div><strong>{c.account}</strong><p className="subtle">{c.accountDetail}</p></div><Button variant="quiet" disabled={signingOut || !!busy} onClick={() => void signOut()}>{copy.signOut}</Button></div>;
  const feedback = flash && <Feedback tone={flash.tone} title={flash.title}>{flash.text}</Feedback>;
  const unlock = (id?: string) => <Button className="full-width" variant="primary" disabled={!!busy || online !== true || stale} onClick={() => void act("unlock", id)}><Icon name="door" />{busy === "unlock" ? c.unlocking : c.unlock}</Button>;

  if (error || apartment === undefined || apartment === null) return <Page context={c.eyebrow}>
    {error ? <StatePanel title={c.loadFailed} detail={c.loadDetail}><Button onClick={retry}>{copy.retry}</Button></StatePanel>
      : apartment === undefined ? <Loading /> : <StatePanel title={c.unassigned} detail={c.unassignedDetail} icon="door" />}
    {feedback}{account}
  </Page>;

  return <Page wide context={c.eyebrow}>
    <div className="page-heading resident-heading"><div><p className="eyebrow">{c.eyebrow}</p><h1>{c.title}</h1><p className="subtle">{c.detail}</p></div>
      <div className="home-address"><strong>{copy.apartment(apartment.label)}</strong><p className="subtle">{apartment.building.name}</p></div>
    </div>
    <div className="resident-grid"><div className="stack">
      {feedback}
      {stale && <Feedback tone="warn">{failures >= 2 ? copy.reconnecting : copy.stale}</Feedback>}
      {!snapshot ? failures > 0 ? <StatePanel title={c.activityFailed} detail={c.activityDetail}><Button onClick={refresh}>{copy.retry}</Button></StatePanel>
        : <Loading title={c.activityLoading} detail={c.activityLoadingDetail} />
        : activeVisit ? <section className="panel incoming-panel" aria-labelledby="incoming-title">
          <div className="incoming-heading"><div className="state-symbol"><Icon name="bell" /></div><span className="subtle">{ageLabel(activeVisit.created_at, now)}</span></div>
          <div className="panel-header"><h2 id="incoming-title">{c.incoming}</h2><p className="subtle">{c.incomingDetail}</p></div>
          <div className="visitor-message">{activeVisit.visitor_note ? <q>{activeVisit.visitor_note}</q> : <p className="subtle">{c.noMessage}</p>}</div>
          <div className="actions">{unlock(activeVisit.id)}<Button variant="quiet" disabled={!!busy || stale} onClick={() => void act("deny", activeVisit.id)}>{busy === "deny" ? c.declining : c.decline}</Button></div>
        </section>
        : visitId ? <StatePanel title={rawVisit ? c.ended : c.unavailable} detail={rawVisit && status ? statusLabel(status, "resident").detail : c.unavailableDetail} icon={status === "unlocked" ? "check" : "clock"}>
          <Link className="button button-secondary" to="/app">{c.returnHome}</Link>
        </StatePanel>
        : <StatePanel title={c.waiting} detail={c.waitingDetail} icon="door">{unlock()}<p className="subtle form-help">{c.unlockHelp}</p></StatePanel>}
      <span className="sr-only" role="status">{activeVisit ? c.incoming : snapshot ? visitId ? c.ended : c.waiting : c.activityLoading}</span>
    </div><aside className="stack">
      <section className="panel side-panel"><h2><Icon name="door" />{copy.entrance}</h2><ConnectionStatus online={online} />
        <p className="subtle">{online === null ? copy.status.unknownDetail : online ? copy.status.onlineDetail : copy.status.offlineDetail}</p>
      </section>
      <NotificationSettings userId={session.user.id} />
      {account}
    </aside></div>
  </Page>;
}
