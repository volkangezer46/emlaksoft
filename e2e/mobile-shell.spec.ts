import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * MOBİL KABUK (sadeleştirme planı C01/C03) — 360 px dokunmatik telefonda alt çubuk gerçekten çalışıyor mu?
 *
 *  1. "+ Yeni" dokunuşu 500 ms içinde `[role=dialog]` açar ve en az 4 eylem içerir (eski hata: dokunma örtüsü click'i
 *     yutuyordu, düğme hiçbir şey yapmıyordu).
 *  2. "Menü" dokunuşu çekmeceyi açar ve en az 4 menü bağlantısı görünür.
 *  3. Alt çubuk en çok 5 yuvadır (sahip kararı: Bugün · Müşteriler · + Yeni · Portföy · Menü; her rolde aynı sıra);
 *     her yuva dokunmatikte ≥ 44 px.
 *
 * Salt okunur (hiçbir kayıt yazılmaz). Koşum: `APP_URL=https://… npx playwright test --project=mobile-shell`.
 * Oturum /giris'teki DEMO kartlarıyla açılır; kartlar hedefte yoksa test ATLANIR (raporda görünür, sahte geçiş yok).
 */
test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

const PERSONAS = ["Danışman", "Ofis sahibi"] as const;

async function demoLogin(browser: Browser, persona: string): Promise<Page | null> {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto("/giris");
  const card = page.getByRole("button", { name: new RegExp(`^${persona}`) });
  // Kart ilk boyamada gelmeyebilir (soğuk /giris): anlık isVisible() testi yanlışlıkla ATLATIYORDU.
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
  // Ürün turu kabuğun üstüne binmesin.
  await page.evaluate(() => window.localStorage.setItem("emlaksoft:tour-done", "1"));
  await page.goto("/app");
  // Boşta önceden yüklenen çekmece/sayfa parçaları insin (ölçüm ilk ağ turunu değil dokunma tepkisini ölçsün).
  await page.waitForLoadState("networkidle").catch(() => undefined);
  return page;
}

const bottomNav = (page: Page) => page.locator('nav[aria-label="Mobil hızlı gezinme"]');

for (const persona of PERSONAS) {
  test.describe(`mobil kabuk — ${persona} (360 px, dokunmatik)`, () => {
    test("+ Yeni dokunuşu eylem sayfasını açar (>= 4 eylem)", async ({ browser }) => {
      const page = await demoLogin(browser, persona);
      test.skip(!page, `/giris'te "${persona}" demo kartı yok`);
      const nav = bottomNav(page!);
      await expect(nav).toBeVisible();
      await nav.getByRole("button", { name: "Hızlı ekle menüsü" }).tap();
      const dialog = page!.locator('[role="dialog"]').filter({ hasText: "Ne eklemek istiyorsunuz?" });
      await expect(dialog).toBeVisible({ timeout: 500 });
      expect(await dialog.locator("a[href]").count()).toBeGreaterThanOrEqual(4);
      await page!.context().close();
    });

    test("Menü dokunuşu çekmeceyi açar (>= 4 bağlantı)", async ({ browser }) => {
      const page = await demoLogin(browser, persona);
      test.skip(!page, `/giris'te "${persona}" demo kartı yok`);
      await bottomNav(page!).getByRole("button", { name: /^Menü/ }).tap();
      const drawer = page!.locator('#app-mobile-navigation[role="dialog"]');
      await expect(drawer).toBeVisible({ timeout: 1500 });
      expect(await drawer.locator("a[data-nav-link]").count()).toBeGreaterThanOrEqual(4);
      await page!.context().close();
    });

    test("alt çubuk en çok 5 yuva; Menü yuvası var", async ({ browser }) => {
      const page = await demoLogin(browser, persona);
      test.skip(!page, `/giris'te "${persona}" demo kartı yok`);
      const slots = bottomNav(page!).locator(":scope > div > a, :scope > div > button");
      expect(await slots.count()).toBeLessThanOrEqual(5);
      // Sahip kararı: telefon alt çubuğu Bugün · Müşteriler · + Yeni · Portföy · Menü (Randevular Menü çekmecesinde).
      const labels = (await slots.allInnerTexts()).map((t) => t.replace(/\d+/g, " ").replace(/\s+/g, " ").trim());
      expect(labels).toEqual(["Bugün", "Müşteriler", "Yeni", "Portföy", "Menü"]);
      for (const box of await slots.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
        expect(box).toBeGreaterThanOrEqual(44);
      }
      // Üst çubukta hamburger yok (plan 2.3): alttaki Menü aynı işi yapar.
      await expect(page!.getByRole("button", { name: "Panel menüsünü aç" })).toHaveCount(0);
      await page!.context().close();
    });
  });
}
