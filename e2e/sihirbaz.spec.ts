import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * SİHİRBAZ (docs/design/SIHIRBAZ_2026-10.md) — salt okunur gezinti: adımlar arasında ilerler/geri döner, doğrulama ve
 * gezinme korumasını görür, "Onayla" düğmesine ASLA basmaz (hiçbir kayıt yazılmaz; taslak yalnız tarayıcıda).
 *   APP_URL=https://… npx playwright test --project=sihirbaz
 * Oturum /giris'teki "Ofis sahibi" DEMO kartıyla açılır; kart yoksa test ATLANIR.
 */

const PHONE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1366, height: 768 } as const;

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

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  // Önceki koşudan kalan taslak varsa temiz başla (yalnız yerel depolama).
  const fresh = page.getByRole("button", { name: "Yeni başla" });
  if (await fresh.isVisible().catch(() => false)) await fresh.click();
}

const stepper = (page: Page) => page.getByRole("navigation", { name: "Sihirbaz adımları" });
const next = (page: Page) => page.getByRole("button", { name: /^İleri/ });

test.describe("sihirbaz", () => {
  test("satış sihirbazı: adımlar, taraf kuralı, geri dönüş (masaüstü)", async ({ browser }) => {
    const page = await ownerLogin(browser, DESKTOP, false);
    test.skip(!page, "demo kartı yok");
    if (!page) return;
    await open(page, "/app/anlasmalar/yeni");
    await expect(stepper(page)).toBeVisible();
    for (const label of ["Müşteri", "Portföy", "Fiyat", "Özet"]) {
      await expect(stepper(page).getByRole("button", { name: new RegExp(label) })).toBeVisible();
    }
    await expect(page.getByRole("heading", { level: 2, name: "Müşteri" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Canlı özet ve hesap" })).toBeVisible();
    await next(page).click();
    await expect(page.getByRole("heading", { level: 2, name: "Portföy" })).toBeVisible();
    // Taraf yokken ileri gidilmez: alan hatası görünür, adım değişmez.
    await next(page).click();
    await expect(page.getByText("Müşteri ya da portföyden en az birini seçin.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Portföy" })).toBeVisible();
    // Özet adımına atlama da korunur.
    await stepper(page).getByRole("button", { name: /Özet ve onay/ }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Portföy" })).toBeVisible();
    await page.getByRole("button", { name: "Geri" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Müşteri" })).toBeVisible();
    await page.context().close();
  });

  test("kiralama sihirbazı: mülk zorunlu; telefonda yapışkan alt çubuk ve yatay taşma yok", async ({ browser }) => {
    const page = await ownerLogin(browser, PHONE, true);
    test.skip(!page, "demo kartı yok");
    if (!page) return;
    await open(page, "/app/kiralama/yeni");
    if (!(await stepper(page).isVisible().catch(() => false))) {
      test.skip(true, "Mülk yönetimi modülü bu ofiste kapalı");
      return;
    }
    await expect(page.getByText(/Adım 1\/\d/)).toBeVisible();
    await next(page).click();
    await expect(page.getByText("Portföy seçin.")).toBeVisible();
    const bar = page.locator(".fab-bar[data-sticky='1']");
    await expect(bar).toBeVisible();
    const box = await bar.boundingBox();
    expect(box && box.y + box.height).toBeGreaterThan(PHONE.height - 100);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.context().close();
  });

  test("kapanış sihirbazı: kazanıldı akışı sekmede açılır (veri varsa)", async ({ browser }) => {
    const page = await ownerLogin(browser, DESKTOP, false);
    test.skip(!page, "demo kartı yok");
    if (!page) return;
    await open(page, "/app/anlasmalar");
    const hrefs = await page.locator("a[href^='/app/anlasmalar/']").evaluateAll((els) =>
      els.map((e) => e.getAttribute("href") ?? "").filter((h) => /^\/app\/anlasmalar\/[0-9a-f-]{36}$/.test(h)),
    );
    test.skip(hrefs.length === 0, "açık anlaşma yok");
    await open(page, `${hrefs[0]}?sekme=kapanis&sonuc=kazanildi`);
    const wizard = stepper(page);
    if (!(await wizard.isVisible().catch(() => false))) {
      // Kapanmış anlaşma: kapanış sonrası görünümü (sihirbaz yok) — yapı doğru.
      await expect(page.getByText(/Komisyon payları|Kayıp kaydedildi|Tebrikler/).first()).toBeVisible();
      return;
    }
    await expect(page.getByRole("heading", { level: 2, name: "Nihai fiyat" })).toBeVisible();
    await expect(wizard.getByRole("button", { name: /Portföy/ })).toBeVisible();
    await page.context().close();
  });
});
