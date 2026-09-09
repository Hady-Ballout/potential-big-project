import { useEffect, useState } from "react";
import { useParams } from "react-router";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { pushSupported } from "../lib/push";
import { copy } from "../lib/copy";
import LoginForm from "../components/LoginForm";
import Dashboard from "../components/Dashboard";
import { Button, Loading, Page, StatePanel } from "../components/ui";

export default function ResidentPage() {
  const { visitId } = useParams();
  const [session, setSession] = useState<Session | null>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stopped = false;
    let authChanged = false;
    setError(false);
    void supabase.auth.getSession().then(({ data, error }) => {
      if (stopped || authChanged) return;
      if (error) { console.error("Session lookup failed", error); setError(true); }
      else setSession(data.session);
    }).catch(e => { if (!stopped && !authChanged) { console.error("Session lookup failed", e); setError(true); } });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!stopped) { authChanged = true; setError(false); setSession(s); }
    });
    if (pushSupported()) void navigator.serviceWorker.register("/sw.js").catch(e => console.error("Service worker registration failed", e));
    return () => { stopped = true; sub.subscription.unsubscribe(); };
  }, [attempt]);
  if (error) return <Page><StatePanel title={copy.resident.loadFailed} detail={copy.network}><Button onClick={() => setAttempt(a => a + 1)}>{copy.retry}</Button></StatePanel></Page>;
  if (session === undefined) return <Page><Loading /></Page>;
  if (!session) return <LoginForm />;
  return <Dashboard key={`${session.user.id}:${visitId ?? "home"}`} session={session} visitId={visitId} />;
}
