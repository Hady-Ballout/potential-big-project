import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockBuilding, signIn, visitId } from "./fixtures";

test("visitor selects an apartment, sends once, and gets honest approval", async ({ page }) => {
  const state = await mockBuilding(page, { ringDelay: 700 });
  await page.goto("/d/cedar-house");
  await expect(page.getByRole("button", { name: "Ring an apartment" })).toBeDisabled();
  await page.getByRole("radio", { name: "Apartment 1A" }).check();
  await page.getByLabel("Message to the resident").fill("Delivery");
  await page.getByRole("button", { name: "Ring apartment 1A" }).dblclick();
  await expect(page.getByRole("heading", { name: "Waiting for a response" })).toBeVisible();
  expect(state.rings).toBe(1);
  await expect(page.getByText("Cedar House")).toBeVisible();
  state.visitorStatus = "unlocked";
  await expect(page.getByRole("heading", { name: "Entry approved" })).toBeVisible();
  await expect(page.getByText("Door is open", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

for (const [status, title] of [["denied", "Entry declined"], ["expired", "No response this time"], ["cancelled", "Request cancelled"]]) {
  test(`visitor ${status} gives a clear next step`, async ({ page }) => {
    const state = await mockBuilding(page);
    await page.goto("/d/cedar-house");
    await page.getByRole("radio", { name: "Apartment 1A" }).check();
    await page.getByRole("button", { name: "Ring apartment 1A" }).click();
    await expect(page.getByRole("heading", { name: "Waiting for a response" })).toBeVisible();
    state.visitorStatus = status;
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Apartment 1A" })).toBeChecked();
    expect(state.rings).toBe(1); // Returning to selection does not send another request.
  });
}

test("visitor failures preserve selection and hide backend messages", async ({ page }) => {
  await mockBuilding(page, { failRing: 429 });
  await page.goto("/d/cedar-house");
  await page.getByRole("radio", { name: "Apartment 1A" }).check();
  await page.getByRole("button", { name: "Ring apartment 1A" }).click();
  await expect(page.getByRole("alert")).toContainText("wait a minute");
  await expect(page.getByRole("radio", { name: "Apartment 1A" })).toBeChecked();
  await expect(page.getByText("internal technical ring error")).toHaveCount(0);
});

test("visitor waiting recovers after polling failures", async ({ page }) => {
  const state = await mockBuilding(page);
  await page.goto("/d/cedar-house");
  await page.getByRole("radio", { name: "Apartment 1A" }).check();
  await page.getByRole("button", { name: "Ring apartment 1A" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for a response" })).toBeVisible();
  state.failRefresh = true;
  await expect(page.getByText(/Reconnecting…/)).toBeVisible({ timeout: 7000 });
  await expect(page.getByRole("heading", { name: "No response this time" })).toHaveCount(0);
  state.failRefresh = false;
  await expect(page.getByText(/Reconnecting…/)).toHaveCount(0);
});

test("offline controller still permits ringing, but disables resident unlocking", async ({ page }) => {
  await mockBuilding(page, { online: false, active: true });
  await page.goto("/d/cedar-house");
  await page.getByRole("radio", { name: "Apartment 1A" }).check();
  await expect(page.getByRole("button", { name: "Ring apartment 1A" })).toBeEnabled();
  await signIn(page);
  await expect(page.getByText("Controller offline", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlock entrance" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Decline", exact: true })).toBeEnabled();
});

test("incoming visitor has one unlock control and no false hardware confirmation", async ({ page }) => {
  const state = await mockBuilding(page, { active: true, actionDelay: 700 });
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Visitor at the entrance" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlock entrance" })).toHaveCount(1);
  await page.getByRole("button", { name: "Unlock entrance" }).dblclick();
  await expect(page.getByText("Unlock request sent", { exact: true })).toBeVisible();
  expect(state.actions).toBe(1);
  await expect(page.getByText(/Physical opening is not confirmed/)).toBeVisible();
  await expect(page.getByText("Door unlocked", { exact: true })).toHaveCount(0);
});

test("controller going offline during submission gets an unconfirmed warning", async ({ page }) => {
  await mockBuilding(page, { actionOffline: true });
  await signIn(page);
  await page.getByRole("button", { name: "Unlock entrance" }).click();
  await expect(page.getByText(/Delivery is unconfirmed/)).toBeVisible();
});

test("failed resident refresh retains the visitor and recovers", async ({ page }) => {
  const state = await mockBuilding(page, { active: true });
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Visitor at the entrance" })).toBeVisible();
  state.failRefresh = true;
  await expect(page.getByText(/Connection interrupted/)).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole("heading", { name: "Visitor at the entrance" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlock entrance" })).toBeDisabled();
  await expect(page.getByText("Controller offline", { exact: true })).toHaveCount(0);
  state.failRefresh = false;
  await expect(page.getByRole("button", { name: "Unlock entrance" })).toBeEnabled({ timeout: 8000 });
});

test("expired notification stays on its own visit after login", async ({ page }) => {
  const state = await mockBuilding(page, { active: true, createdAt: new Date(Date.now() - 90_000).toISOString() });
  await signIn(page, `/app/visit/${visitId}`);
  await expect(page).toHaveURL(new RegExp(`/app/visit/${visitId}$`));
  await expect(page.getByRole("heading", { name: "This visit has ended" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlock entrance" })).toHaveCount(0);
  expect(state.visitQueries.every(query => query.includes(`id=eq.${visitId}`))).toBe(true);
  await expect(page.getByRole("link", { name: "Back to your entrance" })).toBeVisible();
});

test("a notification outside the apartment is unavailable", async ({ page }) => {
  await mockBuilding(page, { missingVisit: true, active: true });
  await signIn(page, `/app/visit/${visitId}`);
  await expect(page.getByRole("heading", { name: "Visit unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlock entrance" })).toHaveCount(0);
});

test("membership failure does not claim the resident is unassigned", async ({ page }) => {
  const state = await mockBuilding(page, { failMembership: true });
  await signIn(page);
  await expect(page.getByRole("heading", { name: "We couldn’t load your home" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your home isn’t linked yet" })).toHaveCount(0);
  state.failMembership = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No visitors waiting" })).toBeVisible();
});

test("empty, missing entrance and unassigned account states", async ({ page }) => {
  const state = await mockBuilding(page, { noApartments: true });
  await page.goto("/d/cedar-house");
  await expect(page.getByRole("heading", { name: "No apartments available" })).toBeVisible();
  state.failBuilding = 404;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Entrance not found" })).toBeVisible();
  state.unassigned = true;
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Your home isn’t linked yet" })).toBeVisible();
});

test("password visibility and keyboard apartment selection", async ({ page }) => {
  await mockBuilding(page);
  await page.goto("/app");
  await page.getByLabel("Password", { exact: true }).fill("example");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await page.goto("/d/cedar-house");
  await page.getByRole("radio", { name: "Apartment 1A" }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Apartment 2A" })).toBeChecked();
});

test("notifications explain blocked permissions", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Notification, "permission", { get: () => "denied" }));
  await mockBuilding(page);
  await signIn(page);
  await expect(page.getByText("Notifications are blocked", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();
});

test("notification setup and unsupported browsers have useful guidance", async ({ page }) => {
  await mockBuilding(page);
  await signIn(page);
  await expect(page.getByText("Notifications aren’t set up yet", { exact: true })).toBeVisible();
  await page.addInitScript(() => { Reflect.deleteProperty(window, "PushManager"); });
  await page.reload();
  await expect(page.getByText("Notifications unavailable here", { exact: true })).toBeVisible();
});

test("a failed initial refresh does not show an empty entrance", async ({ page }) => {
  const state = await mockBuilding(page, { failRefresh: true });
  await signIn(page);
  await expect(page.getByRole("heading", { name: "We couldn’t check for visitors" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No visitors waiting" })).toHaveCount(0);
  await expect(page.getByText("Controller offline", { exact: true })).toHaveCount(0);
  state.failRefresh = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "No visitors waiting" })).toBeVisible();
});

test("visitor selection survives a failed background connection check", async ({ page }) => {
  const state = await mockBuilding(page);
  await page.goto("/d/cedar-house");
  await page.getByRole("radio", { name: "Apartment 1A" }).check();
  await page.getByLabel("Message to the resident").fill("I am at the entrance");
  state.failBuilding = 503;
  await expect(page.getByText(/Connection interrupted/)).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole("radio", { name: "Apartment 1A" })).toBeChecked();
  await expect(page.getByLabel("Message to the resident")).toHaveValue("I am at the entrance");
  await expect(page.getByText("Controller connected", { exact: true })).toHaveCount(0);
  state.failBuilding = 0;
  await expect(page.getByText("Controller connected", { exact: true })).toBeVisible({ timeout: 8000 });
});

test("decline errors are recoverable without exposing technical messages", async ({ page }) => {
  const state = await mockBuilding(page, { active: true, failAction: 500 });
  await signIn(page);
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("We couldn’t send your response");
  await expect(page.getByText("internal action error")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Visitor at the entrance" })).toBeVisible();
  state.failAction = 0;
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(page.getByText("Entry declined", { exact: true })).toBeVisible();
});

test("sign-in shows a useful credential error", async ({ page }) => {
  await mockBuilding(page);
  await page.route("**/auth/v1/token**", route => route.fulfill({ status: 400, contentType: "application/json", headers: { "x-supabase-api-version": "2024-01-01", "access-control-expose-headers": "x-supabase-api-version" }, body: JSON.stringify({ code: "invalid_credentials", msg: "Invalid login credentials" }) }));
  await signIn(page);
  await expect(page.getByRole("alert")).toContainText("The email or password doesn’t match");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
});

test("loading has its own accessible status before entrance data arrives", async ({ page }) => {
  await mockBuilding(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/functions/v1/ring?building=**", async route => { await gate; await route.fallback(); });
  await page.goto("/d/cedar-house");
  await expect(page.getByRole("status")).toContainText("Getting things ready");
  release();
  await expect(page.getByRole("heading", { name: "Who are you visiting?" })).toBeVisible();
});

for (const width of [360, 390, 768, 1440]) {
  test(`rendered layouts and accessibility at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    await mockBuilding(page, { active: true });
    for (const route of ["/app", "/d/cedar-house"]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator("button, .apartment-label").evaluateAll(elements => elements.every(element => {
        const rect = element.getBoundingClientRect(); return rect.width >= 44 && rect.height >= 44;
      }))).toBe(true);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`${route.includes("/d/") ? "visitor" : "login"}-${width}.png`), fullPage: true });
    }
    await signIn(page);
    await expect(page.getByRole("heading", { name: "Visitor at the entrance" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator("button").evaluateAll(elements => elements.every(element => {
      const rect = element.getBoundingClientRect(); return rect.width >= 44 && rect.height >= 44;
    }))).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`resident-${width}.png`), fullPage: true });
  });
}

test("long names reflow at a 200-percent desktop-zoom equivalent", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 450 }); // 1440x900 at 200% browser zoom gives this CSS viewport.
  await mockBuilding(page, { name: "Cedar House — The Courtyard Residences and East Entrance", apartmentLabel: "Penthouse North 1201", active: true });
  await page.goto("/d/cedar-house");
  await expect(page.getByRole("radio", { name: "Apartment Penthouse North 1201" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Visitor at the entrance" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
