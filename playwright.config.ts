import { defineConfig, devices } from "@playwright/test";

/**
 * EmlakSoft E2E test configuration.
 *
 * - Testler `e2e/` klasöründe yaşar (vitest birim testlerinden ayrı).
 * - `npm run dev` otomatik ayağa kaldırılır; zaten çalışan bir dev server
 *   varsa yeniden kullanılır (reuseExistingServer).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Lokal E2E dev server'a (derleme anında rota derleyen) karşı koşuyor —
  // ilk isabet hidrasyon yarışları tek tekrarla telafi edilir.
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // 1) Bir kez login olup oturumu diske yazar (bkz. e2e/auth.setup.ts).
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // 2) Public smoke — auth GEREKTIRMEZ, storageState kullanmaz.
    {
      name: "public",
      testMatch: /public-smoke\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // 3) Oturumlu akışlar — setup'ın yazdığı storageState ile çalışır.
    {
      name: "chromium",
      testIgnore: /public-smoke\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
