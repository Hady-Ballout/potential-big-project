// Pure helpers shared by the visitor page and the resident app. No imports, unit-tested.

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
  if (who === "visitor") {
    switch (status) {
      case "ringing": return { title: "Ringing...", detail: "Waiting for the resident to answer." };
      case "answered": return { title: "Resident is answering", detail: "Hold on a moment." };
      case "unlocked": return { title: "Door is open", detail: "Push the door now. It locks again in a few seconds." };
      case "denied": return { title: "Not let in", detail: "The resident did not open the door." };
      case "expired": return { title: "Nobody answered", detail: "You can try again or ring another apartment." };
      case "cancelled": return { title: "Cancelled", detail: "This ring was cancelled." };
    }
  }
  switch (status) {
    case "ringing": return { title: "Visitor at the door", detail: "Someone is ringing your apartment." };
    case "answered": return { title: "Visitor at the door", detail: "You are answering this visit." };
    case "unlocked": return { title: "Door unlocked", detail: "The door was opened." };
    case "denied": return { title: "Visitor denied", detail: "You did not open the door." };
    case "expired": return { title: "Missed visitor", detail: "Nobody answered in time." };
    case "cancelled": return { title: "Cancelled", detail: "The visitor cancelled." };
  }
}

/** "just now", "12 s ago", "3 min ago" */
export function ageLabel(createdAt: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(createdAt)) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  return `${Math.floor(s / 60)} min ago`;
}
