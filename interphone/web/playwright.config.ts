import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: true,
  workers: 3,
  use: { baseURL: "http://127.0.0.1:5174", browserName: "chromium", channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5174 --strictPort",
    url: "http://127.0.0.1:5174", reuseExistingServer: false,
    // Intentionally fake: browser tests must never send requests to a real building.
    env: { VITE_SUPABASE_URL: "http://127.0.0.1:54329", VITE_SUPABASE_ANON_KEY: "ui-test-anon-key", VITE_VAPID_PUBLIC_KEY: "" },
  },
});
