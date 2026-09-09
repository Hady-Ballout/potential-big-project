import { copy } from "./copy";
// Pure helpers shared by the visitor page and the resident app.

export type VisitStatus = "ringing" | "answered" | "unlocked" | "denied" | "expired" | "cancelled";

/** Mirrors RING_TIMEOUT_SECONDS in supabase/functions/_shared/http.ts */
export const RING_TIMEOUT_MS = 60_000;
/** Mirrors the "door online" window used by the ring and respond functions */
export const DEVICE_ONLINE_MS = 15_000;

export function isStale(createdAt: string, now: number = Date.now(), timeoutMs: number = RING_TIMEOUT_MS): boolean {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return true;
  return now - created > timeoutMs;
}

export function isTerminal(status: VisitStatus): boolean {
  return status === "unlocked" || status === "denied" || status === "expired" || status === "cancelled";
}

export function isActive(status: VisitStatus): boolean {
  return status === "ringing" || status === "answered";
}

/**
 * The database only marks a visit expired when the visitor polls it, so the resident app
 * must treat an old "ringing" row as expired itself.
 */
export function effectiveStatus(v: { status: VisitStatus; created_at: string }, now: number = Date.now()): VisitStatus {
  if (v.status === "ringing" && isStale(v.created_at, now)) return "expired";
  return v.status;
}

export function isDeviceOnline(lastSeenAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!lastSeenAt) return false;
  const seen = Date.parse(lastSeenAt);
  if (Number.isNaN(seen)) return false;
  return now - seen < DEVICE_ONLINE_MS;
}

export function statusLabel(status: VisitStatus, who: "visitor" | "resident"): { title: string; detail: string } {
  if (who === "visitor") return copy.outcomes[status];
  if (status === "unlocked") return { title: copy.resident.sent, detail: copy.resident.sentDetail };
  if (status === "denied") return { title: copy.resident.declined, detail: copy.resident.declineDetail };
  if (isActive(status)) return { title: copy.resident.incoming, detail: copy.resident.incomingDetail };
  return copy.outcomes[status];
}

/** "just now", "12 s ago", "3 min ago" */
export function ageLabel(createdAt: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(createdAt)) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  return `${Math.floor(s / 60)} min ago`;
}
