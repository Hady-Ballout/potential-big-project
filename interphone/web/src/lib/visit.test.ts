import { describe, expect, it } from "vitest";
import {
  RING_TIMEOUT_MS, ageLabel, effectiveStatus, isActive, isDeviceOnline, isStale, isTerminal, statusLabel,
  type VisitStatus,
} from "./visit";

const T0 = Date.parse("2026-09-05T10:00:00.000Z");
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();
const ALL: VisitStatus[] = ["ringing", "answered", "unlocked", "denied", "expired", "cancelled"];

describe("isStale", () => {
  it("is fresh just under the timeout", () => expect(isStale(iso(0), T0 + RING_TIMEOUT_MS - 100)).toBe(false));
  it("is stale just over the timeout", () => expect(isStale(iso(0), T0 + RING_TIMEOUT_MS + 100)).toBe(true));
  it("treats unparsable dates as stale", () => expect(isStale("garbage", T0)).toBe(true));
});

describe("effectiveStatus", () => {
  it("expires an old ringing visit", () =>
    expect(effectiveStatus({ status: "ringing", created_at: iso(0) }, T0 + 61_000)).toBe("expired"));
  it("keeps a fresh ringing visit", () =>
    expect(effectiveStatus({ status: "ringing", created_at: iso(0) }, T0 + 10_000)).toBe("ringing"));
  it("never changes non-ringing statuses", () => {
    for (const s of ALL.filter((x) => x !== "ringing")) {
      expect(effectiveStatus({ status: s, created_at: iso(0) }, T0 + 999_999)).toBe(s);
    }
  });
});

describe("isTerminal / isActive", () => {
  it("partition the enum", () => {
    for (const s of ALL) expect(isTerminal(s)).toBe(!isActive(s));
    expect(ALL.filter(isActive)).toEqual(["ringing", "answered"]);
  });
});

describe("isDeviceOnline", () => {
  it("false for null", () => expect(isDeviceOnline(null, T0)).toBe(false));
  it("true when seen 5 s ago", () => expect(isDeviceOnline(iso(-5_000), T0)).toBe(true));
  it("false when seen 20 s ago", () => expect(isDeviceOnline(iso(-20_000), T0)).toBe(false));
});

describe("statusLabel", () => {
  it("covers every status for both audiences", () => {
    for (const s of ALL) {
      expect(statusLabel(s, "visitor").title.length).toBeGreaterThan(0);
      expect(statusLabel(s, "resident").title.length).toBeGreaterThan(0);
    }
    expect(statusLabel("unlocked", "visitor").title).toBe("Door is open");
    expect(statusLabel("expired", "visitor").title).toBe("Nobody answered");
  });
});

describe("ageLabel", () => {
  it("formats seconds and minutes", () => {
    expect(ageLabel(iso(0), T0 + 1_000)).toBe("just now");
    expect(ageLabel(iso(0), T0 + 12_000)).toBe("12 s ago");
    expect(ageLabel(iso(0), T0 + 190_000)).toBe("3 min ago");
  });
});
