import { createClient } from "@supabase/supabase-js";

function required(name: "VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY"): string {
  const v = import.meta.env[name] as string | undefined;
  if (!v) throw new Error(`${name} is missing. Copy web/.env.example to web/.env.local and fill it in.`);
  return v;
}

export const SUPABASE_URL = required("VITE_SUPABASE_URL").replace(/\/$/, "");
export const SUPABASE_ANON_KEY = required("VITE_SUPABASE_ANON_KEY");
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
export const VAPID_PUBLIC_KEY: string | undefined =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) || undefined;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const visitorSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storageKey: "interphone-visitor-auth" },
});

/** Establishes an invisible, durable identity used to authorize a visitor's private call. */
export async function visitorSession() {
  const { data: current } = await visitorSupabase.auth.getSession();
  if (current.session) return current.session;
  const { data, error } = await visitorSupabase.auth.signInAnonymously();
  if (error || !data.session) throw error ?? new Error("Could not start a visitor session");
  return data.session;
}
