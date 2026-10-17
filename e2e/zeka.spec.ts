import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * EMLAKSOFT ZEKA — ana ekran komut çubuğu ("Ne yapmak istiyorsun?") kabul ölçütleri.
 *  - "Ofis sahibi" demo kartıyla girilir; komut çubuğuna 3 sorgu yazılır (veri sorusu, gezinme, nasıl yapılır).
 *  - Her sorguda yanıt paneli açılır, yanıt metni + kart/eylem görünür, "Yerel zeka" / "GPT" rozeti vardır.
 *  - 1366 ve 390 px'de yatay kaydırma YOK (belge genişliği görüntü alanını aşmaz); 390 px'de panel alt çekmecedir.
 * Salt okunur: Zeka hiçbir kayıt yazmaz, test hiçbir eylem düğmesine basmaz (yalnız sorgu günlüğü yazılır).
 * Koşum: APP_URL=https://… npx playwright test --project=zeka  (kart yoksa test ATLANIR; sahte geçiş yok).
 */

const VIEWPORTS = [
  { name: "1366", width: 1366, height: 768, mobile: false },
  { name: "390", width: 390, height: 844, mobile: true },
] as const;

const QUERIES = ["bu ay kaç satış yaptık", "portföyler", "müşteri nasıl eklenir"] as const;

async function ownerLogin(browser: Browser, viewport: { width: number; height: number }, mobile: boolean): Promise<Page | null> {
  const ctx = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
  const page = await ctx.newPage();
  await page.goto("/giris");
  const card = page.getByRole("button", { name: /^Ofis sahibi/ });
  await card.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  if (!(await card.first().isVisible().catch(() => false))) {
    await ctx.close();
    return null;
  }
  await card.first().click();
  await page.waitForURL(/\/app(\/|$|\?)/, { timeout: 45_000 }).catch(() => undefined);
  if (!new URL(page.url()).pathname.startsWith("/app")) {
    await ctx.close();
    return null;
  }
  await page.evaluate(() => window.localStorage.setItem("emlaksoft:tour-done", "1"));
  return page;
}

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, "yatay kaydırma olmamalı").toBeLessThanOrEqual(client + 1);
}

for (const vp of VIEWPORTS) {
  test(`Zeka komut çubuğu ${vp.name} px: 3 sorgu, yanıt paneli, yatay kaydırma yok`, async ({ browser }) => {
    const page = await ownerLogin(browser, vp, vp.mobile);
    test.skip(!page, "Ofis sahibi demo kartı hedefte yok");
    if (!page) return;
    await page.goto("/app");
    const input = page.locator("#kh-cmd-input");
    await expect(input).toBeVisible({ timeout: 20_000 });
    await expect(input).toHaveAttribute("role", "combobox");

    for (const q of QUERIES) {
      await input.fill(q);
      await input.press("Enter");
      const panel = page.locator("[data-zeka-panel]");
      await expect(panel).toBeVisible({ timeout: 15_000 });
      await expect(panel).toHaveAttribute("aria-label", "Zeka yanıtı");
      await expect(panel.locator(".zk-text")).toBeVisible({ timeout: 20_000 });
      await expect(panel.locator(".zk-text")).not.toBeEmpty();
      await expect(panel.locator(".zk-badge")).toHaveText(/Yerel zeka|GPT/);
      expect(await panel.locator(".zk-card, .zk-btn").count(), `"${q}" için kart ya da eylem`).toBeGreaterThan(0);
      if (vp.mobile) await expect(panel).toHaveClass(/is-sheet/);
      const box = await panel.boundingBox();
      expect(box && box.x >= -1 && box.x + box.width <= vp.width + 1, "panel görüntü alanında").toBeTruthy();
      await noHorizontalScroll(page);
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
    }
    await page.context().close();
  });
}
