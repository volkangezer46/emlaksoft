import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * KURULUM, METİN VE VERİ (sadeleştirme planı paket B7: C27, C28, C29, C31) — kabul ölçütleri.
 *
 *  C27  Kurulum sihirbazı: "Adım x / 4" görünür; sihirbaz açıkken görünür menü satırı 0 (odak modu).
 *  C28  İçe aktarma: üç büyük hedef kartı ekranın üstünde (y < 400); KPI/açıklama kartı yok; "Geri" geldiği listeye döner.
 *  C29  Yardım: görünen tur kartı 1 (rolün turu); destek kartı ilk ekranda.
 *  C31  Pazarlama ve kayıt: üst menüde en çok 15 bağlantı; hero tek cümle; kayıtta "Sonraki adım: 4 kısa soru" ve
 *       "Kaç kişisiniz?" sorusu.
 *
 * Salt okunur (hiçbir kayıt yazılmaz; kayıt formu gönderilmez). Koşum: `APP_URL=https://… npx playwright test --project=setup-content`.
 * Oturumlu kısım /giris'teki "Ofis sahibi" DEMO kartıyla açılır; kart hedefte yoksa o testler ATLANIR (sahte geçiş yok).
 */

const DESKTOP = { width: 1366, height: 800 };
const PHONE = { width: 390, height: 844 };

async function ownerLogin(browser: Browser, viewport: { width: number; height: number }): Promise<Page | null> {
  const ctx = await browser.newContext({ viewport, ...(viewport.width < 500 ? { hasTouch: true, isMobile: true } : {}) });
  const page = await ctx.newPage();
  await page.goto("/giris");
  const card = page.getByRole("button", { name: /^Ofis sahibi/ });
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
  // Ürün turu ölçümün üstüne binmesin.
  await page.evaluate(() => window.localStorage.setItem("emlaksoft:tour-done", "1"));
  return page;
}

/** Görünür menü satırı: masaüstü yan menüsü ve mobil alt çubuktaki görünür bağlantı/düğmeler. */
async function visibleNavRows(page: Page): Promise<number> {
  const rows = page.locator('aside.shell-aside a[href], nav[aria-label="Mobil hızlı gezinme"] a[href], nav[aria-label="Mobil hızlı gezinme"] button');
  let n = 0;
  for (const el of await rows.all()) if (await el.isVisible()) n += 1;
  return n;
}

for (const vp of [DESKTOP, PHONE]) {
  test.describe(`kurulum ve içe aktarma — ${vp.width} px`, () => {
    test("C27: sihirbaz odak modunda, 'Adım x / 4' görünür, menü satırı 0", async ({ browser }) => {
      const page = await ownerLogin(browser, vp);
      test.skip(!page, "/giris'te Ofis sahibi demo kartı yok");
      await page!.goto("/app/baslangic?adim=office");
      await expect(page!.getByTestId("kurulum-adim")).toHaveText(/^Adım [1-4] \/ 4$/);
      expect(await visibleNavRows(page!)).toBe(0);
      await expect(page!.getByRole("link", { name: "Kurulumdan çık" })).toBeVisible();
      // Odak modu yalnız sihirbazda: çıkınca menü geri gelir.
      await page!.goto("/app");
      expect(await visibleNavRows(page!)).toBeGreaterThan(0);
      await page!.context().close();
    });

    test("C28: üç hedef kartı y < 400, KPI kartı yok, Geri geldiği listeye döner", async ({ browser }) => {
      const page = await ownerLogin(browser, vp);
      test.skip(!page, "/giris'te Ofis sahibi demo kartı yok");
      await page!.goto("/app/ice-aktarma");
      await page!.waitForLoadState("networkidle").catch(() => undefined);
      const cards = page!.getByTestId("ice-aktarma-hedefler").locator("[data-import-target]");
      await expect(cards).toHaveCount(3);
      // Konum yoklanarak okunur: ilk yüklemedeki sessiz tazeleme (ClientCacheSync / router.refresh) düğümü bir an
      // ayırabilir; tek seferlik boundingBox() o anda null döner (eski kararsızlık).
      const topY = (i: number) => async () => (await cards.nth(i).boundingBox())?.y ?? Number.POSITIVE_INFINITY;
      for (let i = 0; i < 3; i++) {
        await expect(cards.nth(i)).toBeVisible();
        if (vp.width >= 640) await expect.poll(topY(i)).toBeLessThan(400);
      }
      // Telefonda kartlar alt alta: en az ilk kart y < 400.
      await expect.poll(topY(0)).toBeLessThan(400);
      await expect(page!.getByText("Kayıtlı müşteri", { exact: true })).toHaveCount(0);
      await expect(page!.getByText("Son 30 günde müşteri", { exact: true })).toHaveCount(0);
      await expect(page!.getByRole("link", { name: "Ayarlara dön" })).toHaveCount(0);

      // ?geri= ile gelinen yere döner.
      await page!.goto("/app/ice-aktarma?hedef=portfoyler&geri=%2Fapp%2Fportfoyler");
      await expect(page!.getByTestId("ice-aktarma-geri")).toHaveAttribute("href", "/app/portfoyler");
      await expect(page!.locator('[data-import-target="properties"][aria-pressed="true"]')).toHaveCount(1);
      // Listeden gelindiğinde (Referer) o listeye döner.
      await page!.goto("/app/musteriler");
      await page!.goto("/app/ice-aktarma", { referer: new URL("/app/musteriler", page!.url()).toString() });
      await expect(page!.getByTestId("ice-aktarma-geri")).toHaveAttribute("href", "/app/musteriler");
      await page!.context().close();
    });

    test("C29: yardımda görünen tur kartı 1, destek kartı ilk ekranda", async ({ browser }) => {
      const page = await ownerLogin(browser, vp);
      test.skip(!page, "/giris'te Ofis sahibi demo kartı yok");
      await page!.goto("/app/yardim");
      const support = page!.getByTestId("destek-karti");
      await expect(support).toBeVisible();
      const box = (await support.boundingBox())!;
      expect(box.y).toBeLessThan(vp.height);
      let visibleTourCards = 0;
      for (const el of await page!.locator("[data-tour-card]").all()) if (await el.isVisible()) visibleTourCards += 1;
      expect(visibleTourCards).toBe(1);
      await page!.context().close();
    });
  });
}

test.describe("pazarlama ve kayıt (oturumsuz)", () => {
  test.use({ viewport: DESKTOP });

  test("C31: üst menüde en çok 15 bağlantı, hero tek cümle", async ({ page }) => {
    await page.goto("/");
    const triggers = page.locator('header [aria-controls^="mega-"]');
    const ids = await triggers.evaluateAll((els) => els.map((e) => e.getAttribute("aria-controls") ?? ""));
    const hrefs = new Set<string>();
    for (const id of ids) {
      await page.locator(`header [aria-controls="${id}"]`).first().click();
      const panel = page.locator(`#${id}`);
      await expect(panel.locator(".mk-mega-col a").first()).toBeVisible();
      for (const href of await panel.locator(".mk-mega-col a").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))) hrefs.add(href);
      await page.keyboard.press("Escape");
    }
    expect(ids.length).toBeGreaterThan(0);
    expect(hrefs.size).toBeLessThanOrEqual(15);
    const lead = (await page.locator(".mk-hero-lead").first().innerText()).trim();
    expect(lead.match(/[.!?](\s|$)/g)?.length ?? 0).toBe(1);
  });

  test("C31: kayıt sayfasında sonraki adım ve ekip büyüklüğü sorusu", async ({ page }) => {
    await page.goto("/kayit");
    test.skip(!(await page.locator("form").first().isVisible().catch(() => false)), "kayıt kapalı");
    await expect(page.getByTestId("kayit-sonraki-adim")).toHaveText(/Sonraki adım: 4 kısa soru/);
    const group = page.getByRole("group", { name: /Kaç kişisiniz/ });
    await expect(group).toBeVisible();
    await expect(group.locator('input[type="radio"][name="ekip"]')).toHaveCount(3);
  });
});
