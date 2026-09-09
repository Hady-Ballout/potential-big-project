// Typed wrappers for the edge functions. Shapes match supabase/functions/{ring,respond}/index.ts.
import { FUNCTIONS_URL, SUPABASE_ANON_KEY } from "./supabase";
import type { VisitStatus } from "./visit";

export class ApiError extends Error {
  /** HTTP status; 0 means the request never reached the server */
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export interface BuildingInfo {
  building: { id: string; slug: string; name: string };
  apartments: { id: string; label: string }[];
  door_online: boolean;
}
export interface RingResult {
  visit_id: string;
  status: VisitStatus;
  reused?: boolean;
  push?: { sent: number; skipped: boolean };
}
export interface VisitStatusResult { id: string; status: VisitStatus; created_at: string }
export type RespondAction = "answer" | "unlock" | "deny";
export interface RespondResult { ok: true; status: VisitStatus; command_id?: string; door_online?: boolean }

async function request<T>(path: string, init: RequestInit = {}, accessToken?: string): Promise<T> {
  const headers: Record<string, string> = {
    apikey: SUPABASE_ANON_KEY,
    "content-type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  let res: Response;
  let text: string;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 12_000);
  try {
    res = await fetch(`${FUNCTIONS_URL}${path}`, { ...init, headers, signal: controller.signal });
    text = await res.text();
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new ApiError(0, "Network error. Check your connection.");
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  }
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    const b = body as { error?: string; message?: string; msg?: string } | null;
    const msg = b?.error ?? b?.message ?? b?.msg ?? res.statusText;
    throw new ApiError(res.status, msg || `HTTP ${res.status}`);
  }
  return body as T;
}

export function getBuilding(slug: string, signal?: AbortSignal): Promise<BuildingInfo> {
  return request<BuildingInfo>(`/ring?building=${encodeURIComponent(slug)}`, { signal });
}

export function ring(input: { building: string; apartment_id: string; note?: string }): Promise<RingResult> {
  return request<RingResult>("/ring", { method: "POST", body: JSON.stringify(input) });
}

export function getVisitStatus(visitId: string, signal?: AbortSignal): Promise<VisitStatusResult> {
  return request<VisitStatusResult>(`/ring?visit=${encodeURIComponent(visitId)}`, { signal });
}

export function respond(
  accessToken: string,
  body: { action: RespondAction; visit_id?: string; apartment_id?: string },
): Promise<RespondResult> {
  return request<RespondResult>("/respond", { method: "POST", body: JSON.stringify(body) }, accessToken);
}
