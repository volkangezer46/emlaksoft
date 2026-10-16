import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * DANIŞMAN MÜŞTERİ AKIŞLARI (sadeleştirme planı B4: C11–C15). Danışman demo kartıyla, sade görünümde (varsayılan),
 * 360 px dokunmatik telefon.
 *
 *  C11  /app/musteriler/yeni: ilk ekranda görünen giriş alanı ≤ 4; gönder düğmesinin etiketi "Kaydet".
 *  C12  Müşteri kartında "Ara"ya dokununca kalıcı şerit: Ulaşıldı / Açmadı / Yarın tekrar / Randevu verildi (4 düğme).
 *       Bir dokunuş sonrası zaman çizelgesine 1 kayıt düşer (YALNIZ E2E_MUTATION_ALLOWED=true; izole test DB'si).
 *  C13  Müşteri kartı 360 px: sayfa yüksekliği < 2000 px; görünür tel: ve WhatsApp bağlantısı en çok 1'er.
 *  C14  "Uygun ilanlar (n)" kartı: "sunum" metni ve birimsiz puan yok; "… WhatsApp'tan gönder" düğmesi var.
 *  C15  /app/musteriler 360 px: görünür seçim kutusu 0, başlıkta tek dolu düğme, arama listesi girişi görünür.
 *
 * Koşum: `APP_URL=https://… npx playwright test --project=musteri-akislari`. Demo kartı yoksa ATLANIR (sahte geçiş yok).
 * Mutasyonlu adım dışında salt okunurdur; tel: bağlantısının gezinmesi test sayfasında engellenir (şerit yine açılır).
 */

type Vp = { width: number; height: number };
const PHONE: Vp = { width: 360, height: 740 };
const PERSONA = "Danışman";
const MUTATION = process.env.E2E_MUTATION_ALLOWED === "true";

async function demoLogin(browser: Browser, vp: Vp): Promise<Page | null> {
  const touch = vp.width < 1024;
  const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  await page.goto("/giris");
  const card = page.getByRole("button", { name: new RegExp(`^${PERSONA}`) });
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

/** Listeden müşteri kartı adresleri (ilk sayfa). */
async function customerHrefs(page: Page): Promise<string[]> {
  await open(page, "/app/musteriler");
  const hrefs = await page
    .locator('main a[href^="/app/musteriler/"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  return [...new Set(hrefs.filter((h) => /^\/app\/musteriler\/[0-9a-f-]{36}$/.test(h)))];
}

/** Görünür (boyutlu, gizli olmayan) öğe sayısı. */
function visibleCount(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluateAll((els) =>
    els.filter((e) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      const cs = getComputedStyle(e as HTMLElement);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && Number(cs.opacity) > 0;
    }).length,
  );
}

/** tel: gezinmesini test sayfasında durdurur (şeridin yakalayıcısı önce, yakalama evresinde çalışır). */
async function blockTel(page: Page) {
  await page.evaluate(() =>
    document.addEventListener("click", (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="tel:"], a[href*="wa.me"]');
      if (a) e.preventDefault();
    }),
  );
}

test.describe("B4 danışman müşteri akışları (360 px, sade görünüm)", () => {
  test("C11: hızlı müşteri kaydı ilk ekranda ≤ 4 giriş alanı, düğme 'Kaydet'", async ({ browser }) => {
    const page = await demoLogin(browser, PHONE);
    test.skip(!page, `/giris'te "${PERSONA}" demo kartı yok`);
    await open(page!, "/app/musteriler/yeni");
    const fields = await page!.locator("main form :is(input:not([type=hidden]), select, textarea)").evaluateAll((els) =>
      els.filter((e) => {
        const r = (e as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top < window.innerHeight;
      }).length,
    );
    expect(fields).toBeLessThanOrEqual(4);
    await expect(page!.getByRole("button", { name: "Kaydet", exact: true }).first()).toBeVisible();
    await page!.context().close();
  });

  test("C15: liste sade (seçim kutusu 0, başlıkta tek dolu düğme, arama listesi girişi)", async ({ browser }) => {
    const page = await demoLogin(browser, PHONE);
    test.skip(!page, `/giris'te "${PERSONA}" demo kartı yok`);
    await open(page!, "/app/musteriler");
    expect(await visibleCount(page!, 'main input[type="checkbox"]')).toBe(0);
    expect(await visibleCount(page!, "main :is(header, .lp-hero) .btn-primary")).toBeLessThanOrEqual(1);
    const hasRows = (await page!.locator('main a[href^="/app/musteriler/"]').count()) > 0;
    if (hasRows) await expect(page!.locator("[data-call-list-entry]")).toBeVisible();
    // "Aynı kişiler" ve "İçe aktar" başlıkta değil, "Diğer" menüsünde.
    expect(await visibleCount(page!, 'main a[href="/app/musteriler/cift-kayit"]')).toBe(0);
    await page!.context().close();
  });

  test("C13 + C12: müşteri kartı kısa; Ara tek; Ara'ya dokununca 4 sonuç düğmesi", async ({ browser }) => {
    const page = await demoLogin(browser, PHONE);
    test.skip(!page, `/giris'te "${PERSONA}" demo kartı yok`);
    const hrefs = await customerHrefs(page!);
    test.skip(hrefs.length === 0, "listede müşteri yok");
    let opened = false;
    for (const href of hrefs.slice(0, 6)) {
      await open(page!, href);
      if ((await visibleCount(page!, 'a[href^="tel:"]')) > 0) {
        opened = true;
        break;
      }
    }
    test.skip(!opened, "telefonlu müşteri bulunamadı");

    const height = await page!.evaluate(() => document.documentElement.scrollHeight);
    expect(height).toBeLessThan(2000);
    expect(await visibleCount(page!, 'a[href^="tel:"]')).toBe(1);
    expect(await visibleCount(page!, 'a[href*="wa.me"]')).toBeLessThanOrEqual(1);

    await blockTel(page!);
    await page!.locator('nav[aria-label="Müşteri hızlı eylemleri"] a[href^="tel:"]').tap();
    const strip = page!.getByRole("region", { name: "Görüşme sonucu" });
    await expect(strip).toBeVisible();
    for (const label of ["Ulaşıldı", "Açmadı", "Yarın tekrar", "Randevu verildi"]) {
      await expect(strip.getByRole("button", { name: label, exact: true })).toBeVisible();
    }

    if (MUTATION) {
      // Bir dokunuş = bir kayıt: benzersiz notla "Açmadı" seçilir, zaman çizelgesinde aynı not görünür.
      const token = `e2e-${Date.now().toString(36)}`;
      await strip.getByRole("button", { name: "Not ekle" }).tap();
      await strip.getByRole("textbox").fill(token);
      await strip.getByRole("button", { name: "Açmadı", exact: true }).tap();
      await expect(strip).toBeHidden({ timeout: 20_000 });
      await page!.reload();
      await expect(page!.locator('section[aria-labelledby="gecmis-baslik"]')).toContainText(token, { timeout: 20_000 });
    }
    await page!.context().close();
  });

  test("C14: 'Uygun ilanlar' kartı sade (sunum yok, puan yok, gönder düğmesi var)", async ({ browser }) => {
    const page = await demoLogin(browser, PHONE);
    test.skip(!page, `/giris'te "${PERSONA}" demo kartı yok`);
    const hrefs = await customerHrefs(page!);
    let found = false;
    for (const href of hrefs.slice(0, 10)) {
      await open(page!, href);
      if (await page!.locator("#uygun-ilanlar").isVisible().catch(() => false)) {
        found = true;
        break;
      }
    }
    test.skip(!found, "uygun ilanı olan müşteri bulunamadı");
    const card = page!.locator("#uygun-ilanlar");
    await expect(card.getByRole("heading", { name: /^Uygun ilanlar \(\d+\)$/ })).toBeVisible();
    // Eylem ve etiketlerde "sunum" yok (durum rozetleri hariç: geçmiş gönderimin kanalını yazar).
    const labels = await card.locator("a, button, h2").allInnerTexts();
    for (const l of labels) expect(l.toLocaleLowerCase("tr-TR")).not.toContain("sunum");
    // Birimsiz puan yok: uyum hapı yalnız "Çok uygun" / "Uygun".
    const pills = await card.locator("label > span.shrink-0").allInnerTexts();
    for (const p of pills) expect(p.trim()).toMatch(/^(Çok uygun|Uygun)$/);
    await expect(card.getByRole("button", { name: /WhatsApp'tan gönder|Göndermek için ilan seçin/ })).toBeVisible();
    // Sayfanın görünen metninde "sunum" geçmez (Ayrıntılar kapalı; geçmiş gönderimin kanal rozeti sayılmaz).
    await page!.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>("#uygun-ilanlar label span.mt-1")) el.style.display = "none";
    });
    const visibleText = (await page!.locator("main").innerText()).toLocaleLowerCase("tr-TR");
    expect(visibleText).not.toMatch(/\bsunum/);
    await page!.context().close();
  });
});
