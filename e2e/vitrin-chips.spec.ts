import { test, expect, devices, type Page } from "@playwright/test";

/**
 * SK8 B146 — vitrin süzgeç çipleri KAYDIRMADAN çalışır (auth gerektirmez, salt-okunur).
 *
 * Kök neden: sayfanın altındaki tembel adalar (talep formu, kayıtlı arama) hidrasyonu bekleyen Suspense sınırıydı;
 * çip tıklaması (aynı rota, yalnız searchParams) geçişi bu sınırların kapısı açılana dek erteliyordu: kaydırmadan
 * "Satılık" 15 sn+ URL'yi değiştirmiyordu. Düzeltme: ilk dokunuş/tuş tüm kapıları açar + parçalar boşta ısıtılır +
 * adalar memo'lu (src/app/vitrin/[slug]/viewport-gate.ts, lazy-islands.tsx).
 *
 * Kabul: URL değişimi ≤300 ms hedef; test eşiği yerel dev/CI gürültüsü için 1.000 ms (gerçek ölçüm konsola yazılır).
 * Koşum: `APP_URL=https://… npx playwright test e2e/vitrin-chips.spec.ts --project=public` (public projesinin
 * testMatch'ine bu dosya eklenmelidir; bkz. playwright.config.ts).
 */
const SLUG = process.env.E2E_VITRIN_SLUG ?? "demo-ofis";
const CHIP_URL_BUDGET_MS = 1_000;

async function clickChipWithoutScroll(page: Page): Promise<number> {
  await page.goto(`/vitrin/${SLUG}`, { waitUntil: "load" });
  // Hidrasyon payı; kaydırma YOK (sayfa en üstte kalır).
  await page.waitForTimeout(1_500);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const chip = page.locator(`a[href="/vitrin/${SLUG}?tx=satilik"]`).first();
  await expect(chip).toBeVisible();
  const t0 = Date.now();
  await chip.click({ noWaitAfter: true });
  await page.waitForFunction(() => new URLSearchParams(location.search).get("tx") === "satilik", null, {
    timeout: 15_000,
    polling: 16,
  });
  return Date.now() - t0;
}

test.describe("Vitrin çipleri (kaydırmadan)", () => {
  test("masaüstü: kaydırmadan Satılık URL'yi hemen değiştirir", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "tr-TR" });
    const page = await ctx.newPage();
    const ms = await clickChipWithoutScroll(page);
    console.log(`[vitrin-chips] masaüstü çip→URL ${ms} ms`);
    expect(ms).toBeLessThan(CHIP_URL_BUDGET_MS);
    await ctx.close();
  });

  test("mobil: kaydırmadan Satılık URL'yi hemen değiştirir", async ({ browser }) => {
    const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "tr-TR" });
    const page = await ctx.newPage();
    const ms = await clickChipWithoutScroll(page);
    console.log(`[vitrin-chips] mobil çip→URL ${ms} ms`);
    expect(ms).toBeLessThan(CHIP_URL_BUDGET_MS);
    await ctx.close();
  });
});
