import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * EMLAKSOFT ZEKA — ana ekran komut çubuğu ("Ne yapmak istiyorsun?") kabul ölçütleri.
 *  - "Ofis sahibi" demo kartıyla girilir; komut çubuğuna 3 sorgu yazılır (veri sorusu, gezinme, nasıl yapılır).
 *  - Her sorguda yanıt paneli açılır, yanıt metni + kart/eylem görünür, "Yerel zeka" / "GPT" rozeti vardır.
 *  - 1366 ve 390 px'de yatay kaydırma YOK (belge genişliği görüntü alanını aşmaz); 390 px'de panel alt çekmecedir.
 *  - Yüzen "Zeka'ya sor" düğmesi /app ve /admin'de görünür; tıklayınca sohbet penceresi açılır, sayfaya
 *    uygun başlangıç soruları vardır, bir başlangıç sorusu ve bir devam sorusu yanıtlanır; Ctrl+J açar, Esc kapatır.
 *  - Public ana sayfa STATİK HTML'dir (Next betiği yok, hidrasyon yok): yüzen düğme `/sor?from=/` bağlantısı, kahraman
 *    soru kutusu `/sor?q=…` GET formudur. İkisi de /sor tam sayfa sohbetine gider ve orada yanıt görünür.
 * Salt okunur: Zeka hiçbir kayıt yazmaz, test hiçbir eylem düğmesine basmaz (yalnız sorgu günlüğü yazılır).
 * Koşum: APP_URL=https://… npx playwright test --project=zeka  (kart yoksa test ATLANIR; sahte geçiş yok).
 */

const VIEWPORTS = [
  { name: "1366", width: 1366, height: 768, mobile: false },
  { name: "390", width: 390, height: 844, mobile: true },
] as const;

const QUERIES = ["bu ay kaç satış yaptık", "portföyler", "müşteri nasıl eklenir"] as const;

async function ownerLogin(browser: Browser, viewport: { width: number; height: number }, mobile: boolean): Promise<Page | null> {
  return demoLogin(browser, viewport, mobile, /^Ofis sahibi/, /\/app(\/|$|\?)/, "/app");
}

async function demoLogin(browser: Browser, viewport: { width: number; height: number }, mobile: boolean, name: RegExp, url: RegExp, prefix: string): Promise<Page | null> {
  const ctx = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
  const page = await ctx.newPage();
  await page.goto("/giris");
  const card = page.getByRole("button", { name });
  await card.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  if (!(await card.first().isVisible().catch(() => false))) {
    await ctx.close();
    return null;
  }
  await card.first().click();
  await page.waitForURL(url, { timeout: 45_000 }).catch(() => undefined);
  if (!new URL(page.url()).pathname.startsWith(prefix)) {
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

/** Yüzen düğme → sohbet penceresi: başlangıç sorusu + devam sorusu, Esc ile kapanış, Ctrl+J ile yeniden açılış. */
async function exerciseFab(page: Page, surface: "app" | "admin", vp: (typeof VIEWPORTS)[number]) {
  const fab = page.locator(`[data-zeka-fab="${surface}"]`);
  await expect(fab).toBeVisible({ timeout: 20_000 });
  await expect(fab).toHaveAttribute("aria-label", "Zeka'ya sor");
  const fb = await fab.boundingBox();
  expect(fb && fb.x + fb.width <= vp.width + 1 && fb.y + fb.height <= vp.height + 1, "düğme görüntü alanında").toBeTruthy();
  await fab.click();
  const dock = page.locator("[data-zeka-dock]");
  await expect(dock).toBeVisible({ timeout: 15_000 });
  const starters = dock.getByRole("group", { name: "Önerilen sorular" }).getByRole("button");
  expect(await starters.count(), "başlangıç soruları").toBeGreaterThan(0);
  await starters.first().click();
  await expect(dock.locator(".zk-turn .zk-text").first()).toBeVisible({ timeout: 25_000 });
  await expect(dock.locator(".zk-badge")).toHaveText(/Yerel zeka|GPT/);
  const input = dock.locator(".zk-compose-input");
  await input.fill(surface === "app" ? "bunlardan kaçı kiralık?" : "peki yıllık ödemede?");
  await input.press("Enter");
  await expect(dock.locator(".zk-turn .zk-text").nth(1)).toBeVisible({ timeout: 25_000 });
  if (vp.mobile) await expect(dock).toHaveClass(/is-sheet/);
  const box = await dock.boundingBox();
  expect(box && box.x >= -1 && box.x + box.width <= vp.width + 1, "pencere görüntü alanında").toBeTruthy();
  await noHorizontalScroll(page);
  await page.keyboard.press("Escape");
  await expect(dock).toBeHidden();
  await expect(fab).toBeVisible();
  if (!vp.mobile) {
    await page.keyboard.press("Control+j");
    await expect(dock).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(dock).toBeHidden();
  }
}

for (const vp of VIEWPORTS) {
  test(`Zeka yüzen düğme ${vp.name} px: /app/portfoyler sohbet penceresi`, async ({ browser }) => {
    const page = await ownerLogin(browser, vp, vp.mobile);
    test.skip(!page, "Ofis sahibi demo kartı hedefte yok");
    if (!page) return;
    await page.goto("/app/portfoyler");
    await exerciseFab(page, "app", vp);
    await expect(page.locator("[data-zeka-dock]")).toBeHidden();
    await page.context().close();
  });

  test(`Zeka yüzen düğme ${vp.name} px: /admin`, async ({ browser }) => {
    const page = await demoLogin(browser, vp, vp.mobile, /^Süper admin/, /\/admin(\/|$|\?)/, "/admin");
    test.skip(!page, "Süper admin demo kartı hedefte yok");
    if (!page) return;
    await page.goto("/admin");
    await exerciseFab(page, "admin", vp);
    await page.context().close();
  });

  test(`Zeka ${vp.name} px: public ana sayfa yüzen düğme → /sor sohbeti`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.mobile, isMobile: vp.mobile });
    const page = await ctx.newPage();
    await page.goto("/");
    const fab = page.locator('[data-zeka-fab="public"]');
    await expect(fab).toBeVisible({ timeout: 20_000 });
    await expect(fab).toHaveAttribute("aria-label", "Zeka'ya sor");
    await expect(fab).toHaveAttribute("href", /^\/sor\?from=/);
    await fab.click();
    await page.waitForURL(/\/sor\?from=/, { timeout: 20_000 });
    const dock = page.locator("[data-zeka-dock]");
    await expect(dock).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-zeka-fab]'), "/sor'da yüzen düğme yok").toHaveCount(0);
    const starters = dock.getByRole("group", { name: "Önerilen sorular" }).getByRole("link");
    expect(await starters.count(), "başlangıç soruları").toBeGreaterThan(0);
    await starters.first().click();
    await expect(dock.locator(".zk-turn .zk-text").first()).toBeVisible({ timeout: 25_000 });
    await expect(dock.locator(".zk-badge")).toHaveText(/Yerel zeka|GPT/);
    const input = dock.locator(".zk-compose-input");
    await input.fill("peki yıllık ödemede?");
    await input.press("Enter");
    await expect(dock.locator(".zk-turn .zk-text").nth(1)).toBeVisible({ timeout: 25_000 });
    await noHorizontalScroll(page);
    await ctx.close();
  });

  test(`Zeka ${vp.name} px: public ana sayfa kahraman kutusu → /sor?q= yanıt`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.mobile, isMobile: vp.mobile });
    const page = await ctx.newPage();
    await page.goto("/");
    const hero = page.locator('form.zp-hero[action="/sor"]');
    test.skip(!(await hero.isVisible({ timeout: 15_000 }).catch(() => false)), "Kahraman soru kutusu kapalı (public yüzey kapalı)");
    const input = hero.locator('input[name="q"]');
    await input.fill("Deneme süresi kaç gün?");
    await input.press("Enter");
    await page.waitForURL(/\/sor\?q=/, { timeout: 20_000 });
    const dock = page.locator("[data-zeka-dock]");
    await expect(dock.locator(".zk-turn .zk-ask").first()).toHaveText("Deneme süresi kaç gün?", { timeout: 15_000 });
    await expect(dock.locator(".zk-turn .zk-text").first()).toBeVisible({ timeout: 25_000 });
    // Açılış sorusu yalnız bir kez sorulur.
    await expect(dock.locator(".zk-turn")).toHaveCount(1);
    await noHorizontalScroll(page);
    await ctx.close();
  });
}
