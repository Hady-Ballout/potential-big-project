import { type Page, type Route } from "@playwright/test";

export const visitId = "00000000-0000-4000-8000-000000000001";
export const apartmentId = "00000000-0000-4000-8000-000000000002";
export type Scenario = {
  online: boolean; visitorStatus: string; active: boolean; note: string;
  visitStatus: string; createdAt: string; failRefresh: boolean; failBuilding: number;
  failRing: number; failAction: number; failMembership: boolean; unassigned: boolean;
  noApartments: boolean; missingVisit: boolean; name: string; apartmentLabel: string;
  actionOffline: boolean; actionDelay: number; ringDelay: number;
  rings: number; actions: number; visitQueries: string[];
};
const user = { id: "00000000-0000-4000-8000-000000000003", aud: "authenticated", role: "authenticated", email: "resident@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
export async function mockBuilding(page: Page, values: Partial<Scenario> = {}) {
  const scenario: Scenario = { online: true, visitorStatus: "ringing", active: false, note: "A delivery for you.", visitStatus: "ringing", createdAt: new Date().toISOString(), failRefresh: false, failBuilding: 0, failRing: 0, failAction: 0, failMembership: false, unassigned: false, noApartments: false, missingVisit: false, name: "Cedar House", apartmentLabel: "1A", actionOffline: false, actionDelay: 0, ringDelay: 0, rings: 0, actions: 0, visitQueries: [], ...values };
  const fulfill = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  // All backend traffic is intercepted. Websocket connections are also closed locally.
  await page.routeWebSocket(/\/realtime\//, socket => socket.close());
  await page.route("http://127.0.0.1:54329/**", async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (url.pathname.includes("/auth/v1/token")) {
      const payload = Buffer.from(JSON.stringify({ sub: user.id, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
      return fulfill(route, { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test`, token_type: "bearer", refresh_token: "test-refresh", expires_in: 3600, user });
    }
    if (url.pathname.includes("/auth/v1/user")) return fulfill(route, user);
    if (url.pathname.includes("/auth/v1/logout")) return fulfill(route, {});
    if (url.pathname.endsWith("/ring")) {
      if (req.method() === "POST") {
        scenario.rings++;
        if (scenario.ringDelay) await new Promise(r => setTimeout(r, scenario.ringDelay));
        if (scenario.failRing) return fulfill(route, { error: "internal technical ring error" }, scenario.failRing);
        return fulfill(route, { visit_id: visitId, status: scenario.visitorStatus });
      }
      if (url.searchParams.has("visit")) {
        if (scenario.failRefresh) return fulfill(route, { error: "internal refresh error" }, 503);
        return fulfill(route, { id: visitId, status: scenario.visitorStatus, created_at: scenario.createdAt });
      }
      if (scenario.failBuilding) return fulfill(route, { error: "internal building error" }, scenario.failBuilding);
      return fulfill(route, { building: { id: "building", slug: "cedar-house", name: scenario.name }, door_online: scenario.online, apartments: scenario.noApartments ? [] : [{ id: apartmentId, label: scenario.apartmentLabel }, { id: "apt2", label: "2A" }, { id: "apt3", label: "3A" }] });
    }
    if (url.pathname.endsWith("/respond")) {
      scenario.actions++;
      if (scenario.actionDelay) await new Promise(r => setTimeout(r, scenario.actionDelay));
      if (scenario.failAction) return fulfill(route, { error: "internal action error" }, scenario.failAction);
      const body = req.postDataJSON();
      scenario.visitStatus = body.action === "deny" ? "denied" : "unlocked";
      scenario.visitorStatus = scenario.visitStatus;
      scenario.active = false;
      return fulfill(route, { ok: true, status: scenario.visitStatus, command_id: "test-command", door_online: !scenario.actionOffline });
    }
    if (url.pathname.endsWith("/apartment_members")) {
      if (scenario.failMembership) return fulfill(route, { message: "internal membership error" }, 503);
      return fulfill(route, scenario.unassigned ? null : { apartment_id: apartmentId, apartments: { id: apartmentId, label: scenario.apartmentLabel, building_id: "building", buildings: { slug: "cedar-house", name: scenario.name } } });
    }
    if (url.pathname.endsWith("/devices")) {
      if (scenario.failRefresh) return fulfill(route, { message: "internal refresh error" }, 503);
      return fulfill(route, { last_seen_at: scenario.online ? new Date().toISOString() : null });
    }
    if (url.pathname.endsWith("/visits")) {
      scenario.visitQueries.push(url.search);
      if (scenario.failRefresh) return fulfill(route, { message: "internal refresh error" }, 503);
      return fulfill(route, scenario.missingVisit || (!url.searchParams.has("id") && !scenario.active) ? null : { id: visitId, status: scenario.visitStatus, visitor_note: scenario.note, created_at: scenario.createdAt });
    }
    if (url.pathname.endsWith("/push_subscriptions")) return fulfill(route, null);
    return fulfill(route, { error: "Unmocked test endpoint" }, 500);
  });
  return scenario;
}

export async function signIn(page: Page, path = "/app") {
  await page.goto(path);
  await page.getByLabel("Email address").fill("resident@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
