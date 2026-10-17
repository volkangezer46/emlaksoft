import { test, expect, type Browser, type Page } from "@playwright/test";
import { DENSITY_TARGET, firstScreenDensity } from "./balance-metrics";

/**
 * ANA EKRAN (rol bazlı ana sayfa; sahip kararları 2026-10-16/17 — eski "Bugün sadeleştirme" C07/C08/C09 ölçütlerinin
 * güncel hali). Tek görünüm; kahramanda "Ne yapmak istiyorsun?" komut çubuğu (EmlakSoft Zeka) VARDIR; her rolün kendi
 * 5 KPI kartı, durum paneli ve "Dikkat gerektirenler" listesi vardır.
 *
 *  C07 Danışman, 360x740 dokunmatik:
 *    - ilk ekranda (#main-content, y < 740) etkileşimli öğe ≤ 15; komut çubuğu ve "Benim günüm" paneli ilk ekranda,
 *    - KPI satırı tam olarak: Bu ay kazancım · Aktif anlaşmalarım · Bugünkü randevum · Müşterilerim · Geciken görevim;
 *      sıra: kahraman → KPI → Dikkat gerektirenler → Bugünüm; sayfa yatay taşmaz,
 *    - "Bitti" / "Tamamla" düğmeleri ≥ 44 px.
 *  C08 Sahip:
 *    - 1366 px: KPI satırı tam olarak Bu ay ciro · Aktif anlaşma · Yeni talep · Yeni müşteri · Gelen arama ve ilk ekranda;
 *      "Ofis durumu" paneli üstte; üst çubukta TEK "TV modu" düğmesi (/app/pano-tv); komut çubuğu tek,
 *    - 390 px: görünür "TV modu" 0 (kullanıcı menüsü açıkken bile).
 *  C09 Program: "Bugünün programı" satırlarında saat "00:00" yok (tüm gün görevi değil, randevu) ve satır randevuya gider.
 *  DENGE ana ekranda KPI satırı "Dikkat gerektirenler" ve "Senden bekleyenler" üstünde; Para ("Bu ay komisyon") ve
 *    "Satış performansı" açık; telefonda KPI'lar tek satırlık yatay kayan şerit; ilk ekran yoğunluğu balance-metrics
 *    hedeflerinde (boş alan yok).
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

const OWNER_KPIS = ["Bu ay ciro", "Aktif anlaşma", "Yeni talep", "Yeni müşteri", "Gelen arama"];
const ADVISOR_KPIS = ["Bu ay kazancım", "Aktif anlaşmalarım", "Bugünkü randevum", "Müşterilerim", "Geciken görevim"];

type KpiBox = { title: string; top: number; bottom: number; left: number; right: number; titleCut: boolean; valueCut: boolean };

/** Ana ekran KPI satırı (`Göstergeleriniz` listesi): başlık, sayfa koordinatı, kesik etiket (… olmadan) / kesik değer. */
async function homeKpis(page: Page): Promise<KpiBox[]> {
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[aria-label="Göstergeleriniz"] [role="listitem"]')].map((c) => {
      const r = c.getBoundingClientRect();
      const t = c.querySelector<HTMLElement>(".kh-kpi-title");
      const v = c.querySelector<HTMLElement>(".kh-kpi-value");
      return {
        title: (t?.textContent ?? "").trim(),
        top: r.top + window.scrollY,
        bottom: r.bottom + window.scrollY,
        left: r.left,
        right: r.right,
        titleCut: !!t && t.scrollWidth > t.clientWidth + 1 && getComputedStyle(t).textOverflow !== "ellipsis",
        valueCut: !!v && v.scrollWidth > v.clientWidth + 1,
      };
    }),
  );
}

async function pageTop(page: Page, locator: ReturnType<Page["locator"]>): Promise<number> {
  const box = await locator.boundingBox();
  const sy = await page.evaluate(() => window.scrollY);
  return (box?.y ?? Number.POSITIVE_INFINITY) + sy;
}

const commandBar = (page: Page) => page.getByPlaceholder(/^Ne yapmak istiyorsun\?/).filter({ visible: true });
const tvButton = (page: Page) => page.getByRole("link", { name: /TV modu/ });
const visibleTvCount = (page: Page) =>
  page.locator('a[href="/app/pano-tv"], :text-is("TV modu")').evaluateAll((els) =>
    els.filter((e) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
    }).length,
  );

test.describe("C07 danışman ana ekranı (360 px, dokunmatik)", () => {
  test("ilk ekran ≤ 15 etkileşimli öğe, komut çubuğu + Benim günüm, danışman KPI'ları, Bitti ≥ 44 px", async ({ browser }) => {
    const page = await demoLogin(browser, "Danışman", PHONE, true);
    test.skip(!page, `/giris'te "Danışman" demo kartı yok`);
    const p = page!;
    await expect(p.locator("#kh-hero-title")).toBeVisible();
    await p.evaluate(() => window.scrollTo(0, 0));
    expect(await firstScreenInteractive(p, PHONE.height)).toBeLessThanOrEqual(15);
    // Komut çubuğu (EmlakSoft Zeka) tek ve ilk ekranda.
    await expect(commandBar(p)).toHaveCount(1);
    expect((await commandBar(p).boundingBox())!.y).toBeLessThan(PHONE.height);
    // Danışmanın durum paneli "Benim günüm" ilk ekranda başlar.
    const panel = p.locator(".kh-status-title", { hasText: "Benim günüm" });
    await expect(panel).toBeVisible();
    expect((await panel.boundingBox())!.y).toBeLessThan(PHONE.height);
    // Rolün kendi 5 KPI'ı, kesiksiz.
    const kpis = await homeKpis(p);
    expect(kpis.map((k) => k.title)).toEqual(ADVISOR_KPIS);
    for (const k of kpis) {
      expect(k.titleCut, `${k.title}: etiket … olmadan kesik`).toBe(false);
      expect(k.valueCut, `${k.title}: değer kesik`).toBe(false);
    }
    // Sıra: kahraman → KPI → Dikkat gerektirenler → Bugünüm.
    const hero = await pageTop(p, p.locator("#kh-hero-title"));
    const dikkat = await pageTop(p, p.getByRole("heading", { name: "Dikkat gerektirenler" }));
    const bugunum = await pageTop(p, p.getByRole("heading", { name: "Bugünüm" }));
    expect(hero).toBeLessThan(kpis[0]!.top);
    expect(kpis[0]!.bottom).toBeLessThanOrEqual(dikkat);
    expect(dikkat).toBeLessThan(bugunum);
    expect(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    let bitti = 0;
    for (const b of await p.getByRole("button", { name: /(Bitti|Tamamla)$/ }).all()) {
      if (!(await b.isVisible())) continue;
      bitti++;
      const box = await b.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    test.info().annotations.push({ type: "bitti", description: String(bitti) });
    await p.context().close();
  });
});

test.describe("C08 sahip ana ekranı", () => {
  test("1366 px: sahip KPI'ları ilk ekranda, Ofis durumu üstte, üst çubukta tek TV modu, tek komut çubuğu", async ({ browser }) => {
    const page = await demoLogin(browser, "Ofis sahibi", DESKTOP, false);
    test.skip(!page, `/giris'te "Ofis sahibi" demo kartı yok`);
    const p = page!;
    await expect(p.getByRole("heading", { name: "Dikkat gerektirenler" })).toBeVisible();
    const kpis = await homeKpis(p);
    expect(kpis.map((k) => k.title)).toEqual(OWNER_KPIS);
    for (const k of kpis) {
      expect(k.bottom, `${k.title}: ilk ekranda`).toBeLessThan(DESKTOP.height);
      expect(k.titleCut, `${k.title}: etiket … olmadan kesik`).toBe(false);
      expect(k.valueCut, `${k.title}: değer kesik`).toBe(false);
    }
    const panel = p.locator(".kh-status-title", { hasText: "Ofis durumu" });
    await expect(panel).toBeVisible();
    expect((await panel.boundingBox())!.y).toBeLessThan(400);
    // TV modu: masaüstünde üst çubuktaki tek düğme.
    const tv = tvButton(p).filter({ visible: true });
    await expect(tv).toHaveCount(1);
    await expect(tv).toHaveAttribute("href", "/app/pano-tv");
    expect(await tv.evaluate((a) => !!a.closest("header") && !a.closest("main"))).toBe(true);
    expect(await visibleTvCount(p)).toBe(1);
    await expect(commandBar(p)).toHaveCount(1);
    await p.context().close();
  });

  test("390 px: TV modu görünmez (kullanıcı menüsü açıkken bile)", async ({ browser }) => {
    const page = await demoLogin(browser, "Ofis sahibi", PHONE_390, true);
    test.skip(!page, `/giris'te "Ofis sahibi" demo kartı yok`);
    const p = page!;
    await expect(p.locator("#kh-hero-title")).toBeVisible();
    // Düğme DOM'da (yetkili rol) ama telefonda gizli.
    const tvLink = p.locator('header a[href="/app/pano-tv"]');
    await expect(tvLink).toHaveCount(1);
    await expect(tvLink).toBeHidden();
    expect(await visibleTvCount(p)).toBe(0);
    await p.getByRole("button", { name: /Kullanıcı menüsü/ }).first().tap();
    await expect(p.getByRole("menu").first()).toBeVisible();
    expect(await visibleTvCount(p)).toBe(0);
    await p.context().close();
  });
});

test.describe("DENGE ana ekran: göstergeler ve özet görünür, boş alan yok", () => {
  test("sahip 1366 px: KPI satırı Dikkat ve Senden bekleyenler üstünde, Para ve Satış performansı açık; yoğunluk hedefte", async ({ browser }) => {
    const page = await demoLogin(browser, "Ofis sahibi", DESKTOP, false);
    test.skip(!page, `/giris'te "Ofis sahibi" demo kartı yok`);
    const p = page!;
    const bekleyen = p.getByRole("heading", { name: "Senden bekleyenler" });
    await expect(bekleyen).toBeAttached();
    const kpis = await homeKpis(p);
    expect(kpis).toHaveLength(5);
    // Masaüstünde tek satır.
    expect(new Set(kpis.map((k) => Math.round(k.top))).size).toBe(1);
    expect(kpis[0]!.bottom).toBeLessThanOrEqual(await pageTop(p, p.getByRole("heading", { name: "Dikkat gerektirenler" })));
    expect(kpis[0]!.bottom).toBeLessThanOrEqual(await pageTop(p, bekleyen));
    await expect(p.getByText("Bu ay komisyon", { exact: true }).first()).toBeVisible();
    await expect(p.getByRole("heading", { name: "Satış performansı" }).first()).toBeVisible();
    const d = await firstScreenDensity(p);
    expect(d.info).toBeGreaterThanOrEqual(DENSITY_TARGET.desktop.minInfo);
    expect(d.chrome).toBeLessThanOrEqual(DENSITY_TARGET.desktop.maxChrome);
    await p.context().close();
  });

  test("danışman 390 px: KPI'lar tek satırlık yatay şerit, Bugünüm var; yoğunluk hedefte", async ({ browser }) => {
    const page = await demoLogin(browser, "Danışman", PHONE_390, true);
    test.skip(!page, `/giris'te "Danışman" demo kartı yok`);
    const p = page!;
    await expect(p.getByRole("heading", { name: "Bugünüm" })).toBeAttached();
    const kpis = await homeKpis(p);
    expect(kpis.map((k) => k.title)).toEqual(ADVISOR_KPIS);
    expect(new Set(kpis.map((k) => Math.round(k.top))).size, "KPI'lar tek satır").toBe(1);
    // İlk kart ekrana tam sığar; kalanlar şeritte yana kayar, sayfa taşmaz.
    expect(kpis[0]!.left).toBeGreaterThanOrEqual(0);
    expect(kpis[0]!.right).toBeLessThanOrEqual(PHONE_390.width);
    const strip = p.locator('[aria-label="Göstergeleriniz"]');
    expect(await strip.evaluate((e) => e.scrollWidth > e.clientWidth && getComputedStyle(e).overflowX === "auto")).toBe(true);
    expect(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const d = await firstScreenDensity(p);
    expect(d.info).toBeGreaterThanOrEqual(DENSITY_TARGET.phone.minInfo);
    expect(d.chrome).toBeLessThanOrEqual(DENSITY_TARGET.phone.maxChrome);
    await p.context().close();
  });
});

test.describe("C09 program yalnız randevu", () => {
  test("Bugünün programı: '00:00' yok, satırlar randevuya gider", async ({ browser }) => {
    const page = await demoLogin(browser, "Ofis sahibi", DESKTOP, false);
    test.skip(!page, `/giris'te "Ofis sahibi" demo kartı yok`);
    const p = page!;
    const section = p.locator('section[aria-labelledby="kh-tl-title"]');
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible({ timeout: 10_000 });
    await expect(section.locator("#kh-tl-title")).toHaveText(/^Bugün(ün|kü) program/);
    const times = await section.locator(".kh-tl-time").allInnerTexts();
    for (const t of times) {
      expect(t.trim()).toMatch(/^\d{2}:\d{2}$/);
      expect(t.trim()).not.toBe("00:00");
    }
    const links = section.locator(".kh-tl-main");
    expect(await links.count()).toBe(times.length);
    for (const href of await links.evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))) expect(href).toContain("randevu=");
    if (times.length === 0) await expect(section.getByText("Bugün planlı randevu yok")).toBeVisible();
    await p.context().close();
  });
});
