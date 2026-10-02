import { test as setup, expect } from "@playwright/test";

/**
 * Bir kez login olur ve oturumu (cookie + localStorage) e2e/.auth/user.json'a
 * yazar; chromium projesi bu dosyayı storageState olarak kullanır.
 *
 * Test kullanıcısı `npx tsx scripts/e2e-user.ts` ile hazırlanır (idempotent).
 * Kimlik bilgileri yalnız ortam değişkenlerinden gelir; repoda paylaşılan bir
 * varsayılan parola yoktur.
 */
const authFile = "e2e/.auth/user.json";
const EMAIL = process.env.E2E_USER_EMAIL?.trim() ?? "";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "";

setup("authenticate", async ({ page }) => {
  if (process.env.E2E_MUTATION_ALLOWED !== "true" || !EMAIL || PASSWORD.length < 16) {
    throw new Error(
      "Authenticated E2E requires E2E_MUTATION_ALLOWED=true plus explicit E2E_USER_EMAIL/E2E_USER_PASSWORD (min 16 chars).",
    );
  }
  await page.goto("/giris");
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: /Giriş yap/ }).click();
  await page.waitForURL("**/app", { timeout: 30_000 });
  await expect(page.locator('[data-tour="kpi"]')).toBeVisible({ timeout: 30_000 });

  // Ürün turu bir daha hiç açılmasın — storageState localStorage'ı da taşır,
  // bu bayrak tüm oturumlu testlere miras kalır (bkz. src/app/app/product-tour.tsx).
  await page.evaluate(() => window.localStorage.setItem("emlaksoft:tour-done", "1"));

  await page.context().storageState({ path: authFile });
});
