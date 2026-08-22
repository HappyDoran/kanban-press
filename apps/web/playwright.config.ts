import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: "line",
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "corepack pnpm build && corepack pnpm start --hostname 127.0.0.1 --port 3100",
    env: {
      APP_ORIGIN: "http://127.0.0.1:3100",
      COOKIE_ACTIVE_KEY_ID: "e2e",
      COOKIE_KEYS_JSON: JSON.stringify({
        e2e: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      }),
      GITHUB_API_VERSION: "2026-03-10",
      GITHUB_OAUTH_CLIENT_ID: "e2e-client",
      GITHUB_OAUTH_CLIENT_SECRET: "e2e-secret",
      NOTION_API_VERSION: "2026-03-11",
      NOTION_OAUTH_CLIENT_ID: "e2e-client",
      NOTION_OAUTH_CLIENT_SECRET: "e2e-secret",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://127.0.0.1:3100",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { height: 740, width: 320 } },
    },
  ],
});
