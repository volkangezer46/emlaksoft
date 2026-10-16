import { defineConfig, devices } from "@playwright/test";
import { assertMutationE2ETarget } from "./scripts/e2e/mutation-guard";

const remoteBaseUrl = process.env.APP_URL?.trim().replace(/\/$/, "") || null;
const authenticatedE2EEnabled = process.env.E2E_MUTATION_ALLOWED === "true";
// SK1/B178: mutasyonlu (oturumlu) projeler canlı hosta ya da canlı Supabase'e bağlı yerel sunucuya karşı BAŞLAMAZ.
// Gece işi izole, geçici Supabase'e karşı koşar (.github/workflows/nightly.yml). Public smoke etkilenmez.
assertMutationE2ETarget(process.env);

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
    baseURL: remoteBaseUrl ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // 1) Bir kez login olup oturumu diske yazar (bkz. e2e/auth.setup.ts).
    {
      name: "setup",
      testMatch: authenticatedE2EEnabled ? /auth\.setup\.ts/ : /$^/,
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
      testMatch: authenticatedE2EEnabled ? /.*\.spec\.ts/ : /$^/,
      testIgnore: /public-smoke\.spec\.ts|mobile-sweep\.spec\.ts|mobile-shell\.spec\.ts|mobile-simple\.spec\.ts|bugun-sade\.spec\.ts|sahip-isleri\.spec\.ts|setup-content\.spec\.ts|musteri-akislari\.spec\.ts|portfoy-randevu-gorev\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
    // 4) Mobil düzen süpürmesi (MP12): salt-okunur, kendi demo girişini yapar (E2E_MOBILE_SWEEP=1; kartlar yoksa atlar).
    {
      name: "mobile-sweep",
      testMatch: process.env.E2E_MOBILE_SWEEP === "1" ? /mobile-sweep\.spec\.ts/ : /$^/,
      use: { ...devices["Pixel 7"] },
    },
    // 5) Mobil kabuk (sadeleştirme C01/C03): salt-okunur, kendi demo girişini yapar; yalnız APP_URL verilince koşar
    //    (kartlar yoksa atlar).
    {
      name: "mobile-shell",
      testMatch: remoteBaseUrl ? /mobile-shell\.spec\.ts/ : /$^/,
      use: { ...devices["Pixel 7"] },
    },
    // 6) Sade mod ortak kit kabul ölçütleri (sadeleştirme C05/C06, 2.1/2.5/2.7): salt-okunur, her test kendi demo
    //    girişini ve görünüm alanını kurar; yalnız APP_URL verilince koşar (kartlar yoksa atlar).
    {
      name: "mobile-simple",
      testMatch: remoteBaseUrl ? /mobile-simple\.spec\.ts/ : /$^/,
      use: { ...devices["Desktop Chrome"] },
    },
    // 7) Bugün ekranı sadeleştirme (C07/C08/C09): salt-okunur, kendi demo girişini ve görüntü alanını kurar; yalnız APP_URL ile.
    {
      name: "bugun-sade",
      testMatch: remoteBaseUrl ? /bugun-sade\.spec\.ts/ : /$^/,
      use: { ...devices["Desktop Chrome"] },
    },
    // 6) Sahip işleri (sadeleştirme B6, C21–C26): salt-okunur, "Ofis sahibi" demo kartıyla girer; yalnız APP_URL ile.
    {
      name: "sahip-isleri",
      testMatch: remoteBaseUrl ? /sahip-isleri\.spec\.ts/ : /$^/,
      use: { ...devices["Desktop Chrome"] },
    },
    // 6) Kurulum, içe aktarma, yardım, pazarlama ve kayıt (sadeleştirme B7: C27–C29, C31): salt-okunur; kendi demo
    //    girişini yapar, yalnız APP_URL verilince koşar (kartlar yoksa oturumlu testler atlanır).
    {
      name: "setup-content",
      testMatch: remoteBaseUrl ? /setup-content\.spec\.ts/ : /$^/,
      use: { ...devices["Desktop Chrome"] },
    },
    // Danışman müşteri akışları (sadeleştirme B4, C11–C15): danışman demo kartıyla 360 px; yalnız APP_URL ile. Arama sonucu
    //    kaydı (C12 "1 kayıt") yalnız E2E_MUTATION_ALLOWED=true iken yazılır, aksi halde salt okunurdur.
    {
      name: "musteri-akislari",
      testMatch: remoteBaseUrl ? /musteri-akislari\.spec\.ts/ : /$^/,
      use: { ...devices["Desktop Chrome"] },
    },
    // 8) Portföy, randevu ve görev (sadeleştirme B5, C16–C20): salt-okunur; "Danışman" demo kartıyla girer, kendi
    //    telefon görüntü alanını kurar; yalnız APP_URL verilince koşar (kart yoksa atlanır).
    {
      name: "portfoy-randevu-gorev",
      testMatch: remoteBaseUrl ? /portfoy-randevu-gorev\.spec\.ts/ : /$^/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: remoteBaseUrl
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
