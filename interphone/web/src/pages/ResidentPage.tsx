import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { pushSupported } from "../lib/push";
import LoginForm from "../components/LoginForm";
import Dashboard from "../components/Dashboard";

export default function ResidentPage() {
  // undefined = still loading, null = logged out
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    // Register the service worker early so the PWA manifest / push registration are ready.
    if (pushSupported()) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return <div className="page"><div className="status"><h2 className="pulse">Loading...</h2></div></div>;
  }
  if (!session) return <LoginForm />;
  return <Dashboard session={session} />;
}
