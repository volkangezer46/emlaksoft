import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * SAHİP İŞLERİ (sadeleştirme planı B6: C21–C26) — plan.md'deki ölçülebilir kabul ölçütleri.
 *
 *  C21 Onaylar     · 390 px: ilk onay satırı y < 500; satırdaki Onayla / Reddet ≥ 44 px.
 *  C22 Bildirimler · 390 px: istatistik kartı yok ("Okunma oranı" geçmiyor); ilk ekranda ≥ 3 bildirim satırı
 *                    (kayıt varsa); "Sizden karar bekleyenler" bölümü listenin önünde.
 *  C23 Anlaşma     · açık anlaşmada "Satışı kapat" (kiralıkta "Anlaşmayı kapat") y < 300; "istatistiksel model" yok;
 *                    Kapanış ikinci sekme.
 *  C24 Finans      · ekleme düğmesi 1; Genel bakış "Alacağımız" = Alacak ve borç "Alacağımız"; kayıt sayfasında
 *                    input[capture] ≥ 1; "ew-category" sızıntısı yok; Komisyon sekmesi "Ödenecek paylar" ile açılır.
 *  C25 Ekibim      · 1366 px: danışman tablosu y < 700; karne h1 "Danışman karnesi".
 *  C26 Raporlar    · "sahte satış hattı" geçmiyor; "En çok kullanılan 5 rapor" görünür. Ayarlar h1 "Ayarlar";
 *                    gelişmiş ayarlar katlı.
 *  DENGE           · (varsayılan dengeli görünüm, sahip kararı 2026-10-16) 1366 px: Rapor merkezi girişi görünür; Ekibim
 *                    "Danışman özeti" satırı açık; Onaylar özeti masaüstünde açık (telefonda katlı); Bildirim filtre çipleri
 *                    görünür (katlı "Filtreler" yok).
 *
 * Salt okunur (hiçbir kayıt yazılmaz, hiçbir düğmeye basılmaz). Koşum:
 *   APP_URL=https://… npx playwright test --project=sahip-isleri
 * Oturum /giris'teki "Ofis sahibi" DEMO kartıyla açılır; kart hedefte yoksa test ATLANIR (sahte geçiş yok).
 * Veriye bağlı ölçütler (satır yoksa) koşulludur: boş durumda yalnız sayfanın doğru yapıda olduğu denetlenir.
 */

const PHONE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1366, height: 768 } as const;

async function ownerLogin(browser: Browser, viewport: { width: number; height: number }, mobile: boolean): Promise<Page | null> {
  const ctx = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
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
  await page.evaluate(() => window.localStorage.setItem("emlaksoft:tour-done", "1"));
  return page;
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

async function topOf(page: Page, selector: string): Promise<number | null> {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return null;
  const box = await el.boundingBox();
  return box ? box.y : null;
}

/** "1.234,56 ₺" / "₺1.234" → kuruş (karşılaştırma için). */
function moneyOf(text: string): number | null {
  const m = text.match(/(-?[\d.]+(?:,\d+)?)\s*₺|₺\s*(-?[\d.]+(?:,\d+)?)/);
  const raw = m?.[1] ?? m?.[2];
  if (!raw) return null;
  return Math.round(Number(raw.replace(/\./g, "").replace(",", ".")) * 100);
}

async function kpiAmount(page: Page, label: string): Promise<number | null> {
  const link = page.getByRole("link", { name: new RegExp(label) }).first();
  if ((await link.count()) === 0) return null;
  return moneyOf((await link.textContent()) ?? "");
}

test.describe("sahip işleri — telefon (390 px)", () => {
  test("C21 onaylar: ilk karar satırı ilk ekranda, düğmeler ≥ 44 px", async ({ browser }) => {
    const page = await ownerLogin(browser, PHONE, true);
    test.skip(!page, '/giris\'te "Ofis sahibi" demo kartı yok');
    await open(page!, "/app/onaylar");
    const y = await topOf(page!, '[data-testid="onay-satiri"]');
    if (y === null) {
      await expect(page!.getByText(/Bekleyen onay yok|talep yok/)).toBeVisible();
    } else {
      expect(y).toBeLessThan(500);
      const approve = page!.locator('[data-testid="onay-satiri"]').first().getByRole("button", { name: "Onayla" });
      if ((await approve.count()) > 0) {
        const box = await approve.first().boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
    }
    await page!.context().close();
  });

  test("C22 bildirimler: istatistik kartı yok, ilk ekranda ≥ 3 bildirim", async ({ browser }) => {
    const page = await ownerLogin(browser, PHONE, true);
    test.skip(!page, '/giris\'te "Ofis sahibi" demo kartı yok');
    await open(page!, "/app/bildirimler");
    await expect(page!.getByText("Okunma oranı")).toHaveCount(0);
    await expect(page!.getByRole("heading", { name: "Sizden karar bekleyenler" })).toBeVisible();
    const rows = page!.locator('[data-testid="bildirim-satiri"]');
    const total = await rows.count();
    let above = 0;
    for (let i = 0; i < Math.min(total, 10); i++) {
      const box = await rows.nth(i).boundingBox();
      if (box && box.y + box.height <= PHONE.height) above++;
    }
    expect(above).toBeGreaterThanOrEqual(Math.min(3, total));
    await page!.context().close();
  });
});

test.describe("sahip işleri — masaüstü (1366 px)", () => {
  test("C23 anlaşma detayı: Satışı kapat üstte, teknik olasılık metni yok", async ({ browser }) => {
    const page = await ownerLogin(browser, DESKTOP, false);
    test.skip(!page, '/giris\'te "Ofis sahibi" demo kartı yok');
    await open(page!, "/app/anlasmalar?gorunum=liste&asama=acik");
    const first = page!.locator('a[href^="/app/anlasmalar/"]').filter({ hasNotText: /Yeni/ }).first();
    test.skip((await first.count()) === 0, "açık anlaşma yok");
    const href = await first.getAttribute("href");
    await open(page!, href!.split("?")[0]!);
    const close = page!.getByTestId("satisi-kapat");
    await expect(close).toBeVisible();
    await expect(close).toHaveText(/(Satışı|Anlaşmayı) kapat/);
    expect((await close.boundingBox())!.y).toBeLessThan(300);
    await expect(page!.getByText(/istatistiksel model/)).toHaveCount(0);
    const tabs = page!.getByRole("navigation", { name: "Anlaşma sekmeleri" }).getByRole("link");
    if ((await tabs.count()) >= 2) await expect(tabs.nth(1)).toContainText("Kapanış");
    await page!.context().close();
  });

  test("C24 finans: tek ekleme düğmesi, alacak tek tanım, fiş kamerası, Ödenecek paylar", async ({ browser }) => {
    const page = await ownerLogin(browser, DESKTOP, false);
    test.skip(!page, '/giris\'te "Ofis sahibi" demo kartı yok');
    await open(page!, "/app/finans");
    const addButtons = page!.locator("main").getByRole("link", { name: /^(Yeni kayıt|Gelir ekle|Gider ekle|Gelir\/Gider ekle|Gelir|Gider)$/ });
    await expect(addButtons).toHaveCount(1);
    await expect(page!.getByText(/G \(gelir\)|Mini muhasebe/i)).toHaveCount(0);
    const overview = await kpiAmount(page!, "Alacağımız");
    await open(page!, "/app/finans/cari");
    const cari = await kpiAmount(page!, "Alacağımız");
    if (overview !== null && cari !== null) expect(overview).toBe(cari);

    await open(page!, "/app/finans/kayit?tur=gider");
    expect(await page!.locator("input[capture]").count()).toBeGreaterThanOrEqual(1);
    expect(await page!.locator('[name="ew-category"]').count()).toBe(0);
    await expect(page!.getByText("ew-category")).toHaveCount(0);

    await open(page!, "/app/finans/komisyon");
    const payable = page!.getByTestId("odenecek-paylar");
    await expect(payable).toBeVisible();
    const ledger = page!.getByRole("heading", { name: "Komisyon defteri" });
    if ((await ledger.count()) > 0) {
      expect((await payable.boundingBox())!.y).toBeLessThan((await ledger.boundingBox())!.y);
    }
    await page!.context().close();
  });

  test("C25 ekibim ve karne: tablo ilk ekranda, karne başlığı", async ({ browser }) => {
    const page = await ownerLogin(browser, DESKTOP, false);
    test.skip(!page, '/giris\'te "Ofis sahibi" demo kartı yok');
    await open(page!, "/app/ekip");
    const y = await topOf(page!, "#uyeler table");
    if (y !== null) expect(y).toBeLessThan(700);
    await open(page!, "/app/danisman-kpi");
    await expect(page!.getByRole("heading", { level: 1 })).toHaveText("Danışman karnesi");
    await page!.context().close();
  });

  test("C26 raporlar ve ayarlar: geliştirici notu yok, 5 rapor kısayolu, Ayarlar başlığı", async ({ browser }) => {
    const page = await ownerLogin(browser, DESKTOP, false);
    test.skip(!page, '/giris\'te "Ofis sahibi" demo kartı yok');
    await open(page!, "/app/raporlar");
    await expect(page!.getByText(/sahte satış hattı/)).toHaveCount(0);
    await expect(page!.getByRole("heading", { name: "En çok kullanılan 5 rapor" })).toBeVisible();
    await open(page!, "/app/ayarlar");
    await expect(page!.getByRole("heading", { level: 1 })).toHaveText("Ayarlar");
    const adv = page!.getByTestId("gelismis-ayarlar");
    await expect(adv).toBeVisible();
    expect(await adv.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
    await page!.context().close();
  });

  test("DENGE: rapor merkezi, danışman özeti, onay özeti ve bildirim filtreleri görünür", async ({ browser }) => {
    const page = await ownerLogin(browser, DESKTOP, false);
    test.skip(!page, '/giris\'te "Ofis sahibi" demo kartı yok');
    await open(page!, "/app/raporlar");
    await expect(page!.getByRole("heading", { name: "İstediğiniz raporu seçin, süzün, indirin" })).toBeVisible();
    await open(page!, "/app/ekip");
    const ozet = page!.getByRole("group", { name: "Danışman özeti" }).or(page!.getByLabel("Danışman özeti")).first();
    if ((await ozet.count()) > 0) await expect(ozet).toBeVisible();
    await open(page!, "/app/onaylar");
    const onayOzet = page!.getByTestId("onay-ozet");
    if ((await onayOzet.count()) > 0) {
      // Masaüstünde başlık gizli, içerik açık (data-fold-phone).
      await expect(onayOzet.locator(":scope > summary")).toBeHidden();
    }
    await open(page!, "/app/bildirimler");
    await expect(page!.getByRole("navigation", { name: "Bildirim filtresi" })).toBeVisible();
    await expect(page!.getByTestId("bildirim-filtreler")).toHaveCount(0);
    await page!.context().close();
  });
});
