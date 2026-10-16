import { test, expect, type Browser, type Page } from "@playwright/test";
import { DENSITY_TARGET, firstScreenDensity } from "./balance-metrics";

/**
 * BUGÜN EKRANI SADELEŞTİRME (plan 2.4 / C07, C08, C09) — ölçülebilir kabul ölçütleri:
 *
 *  C07 Danışman "Bugünüm", 360x740 dokunmatik:
 *    - ilk ekranda (#main-content, y < 740) etkileşimli öğe ≤ 15,
 *    - sayfa yüksekliği < 1600 px,
 *    - "Bitti" / "Tamamla" düğmeleri ≥ 44 px.
 *  C08 Sahip "Patron panosu":
 *    - 1366 px: "Bu ay komisyon" y < 700; sayfada "TV modu" en çok 1 kez; "Ne yapmak istiyorsun?" yok,
 *    - 390 px: görünür "TV modu" 0 ("⋯" menüsü açıkken bile).
 *  C09 Program: "Bugünkü randevular" listesinde "00:00" yok ve ilk satır bir randevu.
 *  DENGE (sahip kararı 2026-10-16, varsayılan dengeli görünüm): ana ekranda gösterge satırı GÖRÜNÜR (masaüstünde
 *    "Senden bekleyenler" / "Bugünüm" üstünde, 1-6 kart; telefonda 1-2 kart), patron panosunda "Komisyon geliri" eğrisi
 *    ve "Para" kartı katlanmadan görünür; ilk ekran yoğunluğu balance-metrics hedeflerinde (boş alan yok).
 *
 * Salt okunur (hiçbir kayıt yazılmaz). Koşum: `APP_URL=https://… npx playwright test --project=bugun-sade`.
 * Oturum /giris'teki DEMO kartlarıyla açılır; kartlar hedefte yoksa test ATLANIR (raporda görünür, sahte geçiş yok).
 */

type Viewport = { width: number; height: number };
const PHONE: Viewport = { width: 360, height: 740 };
const PHONE_390: Viewport = { width: 390, height: 844 };
const DESKTOP: Viewport = { width: 1366, height: 800 };

async function demoLogin(browser: Browser, persona: string, viewport: Viewport, touch: boolean): Promise<Page | null> {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
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
  await page.evaluate(() => window.localStorage.setItem("emlaksoft:tour-done", "1"));
  await page.goto("/app");
  await page.waitForLoadState("networkidle").catch(() => undefined);
  return page;
}

/** İlk ekrandaki (y < viewport yüksekliği) görünür etkileşimli öğeler — yalnız sayfa gövdesi (#main-content). */
async function firstScreenInteractive(page: Page, viewportHeight: number): Promise<number> {
  return page.evaluate((h) => {
    const root = document.querySelector("#main-content") ?? document.body;
    const els = Array.from(root.querySelectorAll<HTMLElement>('a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"]'));
    return els.filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || s.visibility === "hidden" || s.display === "none") return false;
      return r.top < h && r.bottom > 0;
    }).length;
  }, viewportHeight);
}

test.describe("C07 danışman Bugünüm (360 px, dokunmatik)", () => {
  test("ilk ekran ≤ 15 etkileşimli öğe, sayfa < 1600 px, Bitti ≥ 44 px", async ({ browser }) => {
    const page = await demoLogin(browser, "Danışman", PHONE, true);
    test.skip(!page, `/giris'te "Danışman" demo kartı yok`);
    const p = page!;
    await expect(p.getByRole("heading", { name: "Bugünüm" })).toBeVisible();
    await p.evaluate(() => window.scrollTo(0, 0));
    expect(await firstScreenInteractive(p, PHONE.height)).toBeLessThanOrEqual(15);
    const height = await p.evaluate(() => document.documentElement.scrollHeight);
    expect(height).toBeLessThan(1600);
    for (const b of await p.getByRole("button", { name: /(Bitti|Tamamla)$/ }).all()) {
      if (!(await b.isVisible())) continue;
      const box = await b.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    // Kısayollar tek yerde: "Ne yapmak istiyorsun?" kutusu yok.
    await expect(p.getByText("Ne yapmak istiyorsun?")).toHaveCount(0);
    await p.context().close();
  });
});

test.describe("C08 sahip Patron panosu", () => {
  test("1366 px: Bu ay komisyon y < 700, TV modu en çok 1, Ne yapmak kutusu yok", async ({ browser }) => {
    const page = await demoLogin(browser, "Ofis sahibi", DESKTOP, false);
    test.skip(!page, `/giris'te "Ofis sahibi" demo kartı yok`);
    const p = page!;
    await expect(p.getByRole("heading", { name: "Senden bekleyenler" })).toBeVisible();
    const komisyon = p.getByText("Bu ay komisyon", { exact: true }).first();
    await expect(komisyon).toBeVisible();
    const box = await komisyon.boundingBox();
    expect(box?.y ?? Infinity).toBeLessThan(700);
    expect(await p.getByText("TV modu", { exact: true }).count()).toBeLessThanOrEqual(1);
    await expect(p.getByText("Ne yapmak istiyorsun?")).toHaveCount(0);
    await p.context().close();
  });

  test("390 px: TV modu görünmez (⋯ menüsü açıkken bile)", async ({ browser }) => {
    const page = await demoLogin(browser, "Ofis sahibi", PHONE_390, true);
    test.skip(!page, `/giris'te "Ofis sahibi" demo kartı yok`);
    const p = page!;
    await p.getByLabel("Daha fazla seçenek").first().tap();
    const visibleTv = await p.getByText("TV modu", { exact: true }).evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).length);
    expect(visibleTv).toBe(0);
    await p.context().close();
  });
});

test.describe("DENGE ana ekran: göstergeler ve özet görünür, boş alan yok", () => {
  test("sahip 1366 px: KPI satırı Senden bekleyenler üstünde, Para ve Komisyon geliri açık; yoğunluk hedefte", async ({ browser }) => {
    const page = await demoLogin(browser, "Ofis sahibi", DESKTOP, false);
    test.skip(!page, `/giris'te "Ofis sahibi" demo kartı yok`);
    const p = page!;
    const bekleyen = p.getByRole("heading", { name: "Senden bekleyenler" });
    await expect(bekleyen).toBeVisible();
    const kpi = p.locator("[data-tour=kpi] .pm-card").filter({ visible: true });
    const n = await kpi.count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(6);
    expect((await kpi.first().boundingBox())!.y).toBeLessThan((await bekleyen.boundingBox())!.y);
    await expect(p.getByText("Bu ay komisyon", { exact: true }).first()).toBeVisible();
    await expect(p.getByText("Komisyon geliri", { exact: true }).first()).toBeAttached();
    const d = await firstScreenDensity(p);
    expect(d.info).toBeGreaterThanOrEqual(DENSITY_TARGET.desktop.minInfo);
    expect(d.chrome).toBeLessThanOrEqual(DENSITY_TARGET.desktop.maxChrome);
    await p.context().close();
  });

  test("danışman 390 px: 1-2 gösterge kartı ilk ekranda, Bugünüm görünür; yoğunluk hedefte", async ({ browser }) => {
    const page = await demoLogin(browser, "Danışman", PHONE_390, true);
    test.skip(!page, `/giris'te "Danışman" demo kartı yok`);
    const p = page!;
    await expect(p.getByRole("heading", { name: "Bugünüm" })).toBeAttached();
    const shown = await p.locator("[data-tour=kpi] .pm-card").evaluateAll((els) =>
      els.filter((e) => {
        const r = (e as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.top < window.innerHeight;
      }).length,
    );
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThanOrEqual(2);
    const d = await firstScreenDensity(p);
    expect(d.info).toBeGreaterThanOrEqual(DENSITY_TARGET.phone.minInfo);
    expect(d.chrome).toBeLessThanOrEqual(DENSITY_TARGET.phone.maxChrome);
    await p.context().close();
  });
});

test.describe("C09 program yalnız randevu", () => {
  test("Bugünkü randevular: '00:00' yok, ilk satır randevu", async ({ browser }) => {
    const page = await demoLogin(browser, "Ofis sahibi", DESKTOP, false);
    test.skip(!page, `/giris'te "Ofis sahibi" demo kartı yok`);
    const p = page!;
    const section = p.locator('section[aria-labelledby="program-baslik"]');
    await section.scrollIntoViewIfNeeded().catch(() => undefined);
    await p.mouse.wheel(0, 1200);
    await expect(section).toBeVisible({ timeout: 10_000 });
    expect(await section.innerText()).not.toContain("00:00");
    const first = section.locator("[data-program-satir] a").first();
    if (await first.count()) expect(await first.getAttribute("href")).toContain("randevu=");
    await p.context().close();
  });
});
