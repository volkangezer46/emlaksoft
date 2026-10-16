import { test, expect, type Browser, type Page } from "@playwright/test";
import { DENSITY_TARGET, firstScreenDensity } from "./balance-metrics";

/**
 * PORTFÖY, RANDEVU VE GÖREV (sadeleştirme planı B5: C16–C20) — plan.md'deki ölçülebilir kabul ölçütleri.
 *
 *  C16 Portföy formu   · `input[capture]` ≥ 1 (Fotoğraf çek), `commission_rate` boş değil (ofis varsayılanı), birincil
 *                        düğme etiketi "…" ile kesilmiyor; zorunlu alan ≤ 5.
 *  C17 Randevu formu   · varsayılan saat 09–19 arasında tam saat; "Ofis görüşmesi" türünde Portföy alanı görünmüyor;
 *                        kaydet etiketi kısa ve kesilmiyor.
 *  C18 Randevular      · 360 px: dengeli ilk ekran — çerçeve denetimi ≤ 15, bilgi öğesi ≥ 5, toplam etkileşimli ≤ 26 (KPI ve tür
 *                        çipleri görünür); ay takvimi gün hücresi 0 (gün listesi varsayılan).
 *  C19 Görevler        · görünür görev satırı < 50; "Kanban" metni geçmiyor; görünen "Bitti" ≥ 44 px.
 *  C20 Portföy detayı  · 390 px: yetki belgesi uyarısı (varsa) < 48 px; görünür "WhatsApp" eylemi 1 kez.
 *
 * Salt okunur (hiçbir kayıt yazılmaz, kaydet düğmesine basılmaz). Koşum:
 *   APP_URL=https://… npx playwright test --project=portfoy-randevu-gorev
 * Oturum /giris'teki "Danışman" DEMO kartıyla açılır; kart hedefte yoksa test ATLANIR (sahte geçiş yok). Tek görünüm
 * (anahtar yok). Veriye bağlı ölçütler (kayıt yoksa) koşulludur.
 */

const PHONE_360 = { width: 360, height: 740 } as const;
const PHONE_390 = { width: 390, height: 844 } as const;

async function advisorLogin(browser: Browser, viewport: { width: number; height: number }): Promise<Page | null> {
  const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto("/giris");
  const card = page.getByRole("button", { name: /^Danışman/ });
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

/** İlk ekranda (görüntü alanı içinde) görünür etkileşimli öğe sayısı. */
async function interactiveAboveFold(page: Page): Promise<number> {
  return page.evaluate(() => {
    const h = window.innerHeight;
    const els = document.querySelectorAll<HTMLElement>("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button]");
    let n = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom <= 0 || r.top >= h) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || el.closest("[hidden], [inert], [aria-hidden=true]")) continue;
      // Kapalı <details> içeriği (ör. "Filtreler" alt sayfası) görünmez; Chromium yine de kutu ölçüsü döndürür.
      let folded = false;
      for (let d = el.closest("details:not([open])"); d && !folded; d = d.parentElement?.closest("details:not([open])") ?? null) {
        folded = !d.querySelector(":scope > summary")?.contains(el);
      }
      if (folded) continue;
      n++;
    }
    return n;
  });
}

test.describe("portföy, randevu ve görev — telefon", () => {
  test("C16 portföy formu: fotoğraf adımı, dolu komisyon, kesiksiz kaydet", async ({ browser }) => {
    const page = await advisorLogin(browser, PHONE_360);
    test.skip(!page, '/giris\'te "Danışman" demo kartı yok');
    await open(page!, "/app/portfoyler/yeni");
    expect(await page!.locator("input[type=file][capture]").count()).toBeGreaterThanOrEqual(1);
    await expect(page!.getByRole("button", { name: "Fotoğraf çek" })).toBeVisible();
    const rate = await page!.locator('input[name="commission_rate"]').inputValue();
    expect(rate.trim()).not.toBe("");
    // Zorunlu alan en çok 5.
    expect(await page!.locator("form [required]").evaluateAll((els) => new Set(els.map((e) => (e as HTMLInputElement).name)).size)).toBeLessThanOrEqual(5);
    // Birincil düğme metni kesilmiyor (… yok, taşma yok).
    const save = page!.getByRole("button", { name: /^Kaydet/ }).filter({ visible: true }).first();
    await expect(save).toBeVisible();
    const clipped = await save.evaluate((el) => el.scrollWidth > el.clientWidth + 1 || /…$/.test((el.textContent ?? "").trim()));
    expect(clipped).toBe(false);
    await page!.context().close();
  });

  test("C17 randevu formu: saat 09–19, görüşmede portföy alanı yok", async ({ browser }) => {
    const page = await advisorLogin(browser, PHONE_360);
    test.skip(!page, '/giris\'te "Danışman" demo kartı yok');
    await open(page!, "/app/randevular/yeni");
    const time = await page!.locator('input[name="time"]').inputValue();
    const [hh, mm] = time.split(":").map(Number);
    expect(hh).toBeGreaterThanOrEqual(9);
    expect(hh).toBeLessThanOrEqual(19);
    expect(mm).toBe(0);
    // Yer gösterme dışı tür: portföy alanı görünmez ("Portföy bağla" ile açılır).
    const office = page!.locator("label").filter({ hasText: /görüşme/i }).first();
    if ((await office.count()) > 0) {
      await office.tap();
      await expect(page!.locator("#appointment-property")).toHaveCount(0);
      await expect(page!.getByRole("button", { name: "Portföy bağla" })).toBeVisible();
    }
    const save = page!.getByRole("button", { name: /^Kaydet/ }).filter({ visible: true }).first();
    await expect(save).toBeVisible();
    expect(await save.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false);
    await page!.context().close();
  });

  test("C18 randevular: gün listesi, takvim hücresi yok; dengeli ilk ekran (KPI + tür çipleri, ≤ 15 çerçeve denetimi)", async ({ browser }) => {
    const page = await advisorLogin(browser, PHONE_360);
    test.skip(!page, '/giris\'te "Danışman" demo kartı yok');
    await open(page!, "/app/randevular");
    await expect(page!.locator("[data-day-agenda]")).toBeVisible();
    await expect(page!.getByRole("heading", { name: /^Bugün/ })).toBeVisible();
    expect(await page!.locator('[role="gridcell"], .appt-cal-day, [data-calendar-day]').filter({ visible: true }).count()).toBe(0);
    // Dengeli görünüm: göstergeler ve tür çipleri görünür; satırların kendi eylemleri hariç çerçeve ≤ 15, bilgi ≥ 5.
    const d = await firstScreenDensity(page!);
    expect(d.chrome).toBeLessThanOrEqual(DENSITY_TARGET.phone.maxChrome);
    expect(d.info).toBeGreaterThanOrEqual(DENSITY_TARGET.phone.minInfo);
    expect(await interactiveAboveFold(page!)).toBeLessThanOrEqual(26);
    await page!.context().close();
  });

  test("C19 görevler: bugün ve gecikmiş odağı, Kanban yok, Bitti ≥ 44 px", async ({ browser }) => {
    const page = await advisorLogin(browser, PHONE_360);
    test.skip(!page, '/giris\'te "Danışman" demo kartı yok');
    await open(page!, "/app/gorevler");
    const body = (await page!.locator("main").innerText()).replace(/\s+/g, " ");
    expect(body).not.toMatch(/Kanban/i);
    expect(await page!.locator("[data-task-card]").filter({ visible: true }).count()).toBeLessThan(50);
    // Seçim kutuları "Seç" moduna kadar gizli.
    expect(await page!.locator('[data-row-select] input[type="checkbox"]').filter({ visible: true }).count()).toBe(0);
    const done = page!.locator("[data-task-done]").filter({ visible: true });
    if ((await done.count()) > 0) {
      const box = await done.first().boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    } else {
      await expect(page!.getByText(/göreviniz yok|görev yok/i).first()).toBeVisible();
    }
    // Pano ve Takvim "Görünüm" menüsünde, ekranda düz bağlantı olarak değil.
    await expect(page!.getByRole("link", { name: "Pano" }).filter({ visible: true })).toHaveCount(0);
    await page!.context().close();
  });

  test("C20 portföy detayı: tek satır yetki şeridi, WhatsApp bir kez", async ({ browser }) => {
    const page = await advisorLogin(browser, PHONE_390);
    test.skip(!page, '/giris\'te "Danışman" demo kartı yok');
    await open(page!, "/app/portfoyler");
    const first = page!.locator('a[href^="/app/portfoyler/"]').filter({ visible: true }).filter({ hasNotText: /Yeni|Sunum|Anahtar|Aynı/ });
    const href = await first.evaluateAll((els) =>
      els.map((e) => e.getAttribute("href") ?? "").find((h) => /^\/app\/portfoyler\/[0-9a-f-]{36}$/.test(h)) ?? null,
    );
    test.skip(!href, "listelenecek portföy yok");
    await open(page!, href!);
    const strip = page!.locator("[data-license-strip]");
    if ((await strip.count()) > 0) {
      const box = await strip.first().boundingBox();
      expect(box?.height ?? 0).toBeLessThan(48);
    }
    // Eski 5 satırlık uyarı metni detayda yok.
    await expect(page!.getByText("denetimde sorun çıkarabilir")).toHaveCount(0);
    const wa = page!.locator("a, button").filter({ hasText: /WhatsApp/ }).filter({ visible: true });
    expect(await wa.count()).toBe(1);
    await page!.context().close();
  });
});
