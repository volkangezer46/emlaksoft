import { test, expect, type Browser, type Page } from "@playwright/test";
import { DENSITY_TARGET, firstScreenDensity } from "./balance-metrics";

/**
 * TEK GÖRÜNÜM — ORTAK KİT KABUL ÖLÇÜTLERİ (sahip kararı 2026-10-16: "Sade / Dengeli görünüm" anahtarı kaldırıldı;
 * herkes aynı ayarlı yerleşimi görür) (sadeleştirme planı; bu dosyanın sahibi B2, diğer paketler kendi senaryolarını
 * ayrı spec dosyasına yazar). 360 / 390 px dokunmatik telefon ve 1366 px masaüstü.
 *
 *  DENGE    KPI şeridi GÖRÜNÜR: 390 px'te 1-2 kart, 1366 px'te en çok 6; her kartın
 *           etiketi görünür ve sayı kesilmez. İlk ekran yoğunluğu (balance-metrics): masaüstü ≥8 bilgi öğesi ve ≤25
 *           çerçeve denetimi, telefon ≥5 bilgi öğesi ve ≤15 çerçeve denetimi.
 *  C06      360 px dokunmatik: `/app`, `/app/gorevler`, `/app/randevular` görünür düğmelerinde yüksekliği 40 px'ten küçük
 *           öğe 0 (onay kutusu / anahtar rolleri hariç).
 *  2.5      Başlık eylemleri: liste başlığında en çok 1 dolu (birincil) düğme; masaüstünde en çok 2 görünür ikincil.
 *  2.1      Görünüm değiştirici telefonda "…" menüsünde (görünür `nav[aria-label=Görünüm]` 0), masaüstünde satır içi;
 *           "Kanban" metni 0.
 *  2.1/C15  Görünür seçim kutusu 0; "Seç" dokunuşundan sonra görünür.
 *  ilke 5   Mobilde düğme etiketi "…" ile kesilmez (text-overflow taşması 0).
 *  2.7      Form sayfası: alt gezinme gizli, altta tek "Kaydet" (kesilmez), İptal "Daha fazla" içinde.
 *  2.1      Küçük gri yardım metni (`.helper-text`) görünürse kısa (≤ 2 satır); uzun yardım paragrafı katlı.
 *
 * Salt okunur (hiçbir kayıt yazılmaz). Kullanıcı menüsünde görünüm anahtarı YOKTUR (ayrı senaryo denetler).
 * Koşum: `APP_URL=https://… npx playwright test --project=mobile-simple`. Oturum /giris'teki DEMO kartlarıyla açılır;
 * kartlar hedefte yoksa test ATLANIR (raporda görünür, sahte geçiş yok).
 */

type Vp = { width: number; height: number };
const PHONE: Vp = { width: 360, height: 740 };
const PHONE_390: Vp = { width: 390, height: 844 };
const DESKTOP: Vp = { width: 1366, height: 768 };

async function demoLogin(browser: Browser, persona: string, vp: Vp): Promise<Page | null> {
  const touch = vp.width < 1024;
  const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch });
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
  return page;
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

/** Görünür düğmelerden yüksekliği `min` px'ten küçük olanlar (tanı metniyle). */
async function smallButtons(page: Page, min: number): Promise<string[]> {
  return page.evaluate((limit) => {
    const sel = 'main :is(button, [role="button"], a.btn):not([role="checkbox"], [role="switch"], [role="radio"], [role="slider"], [aria-hidden="true"], .sr-only)';
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
      if (r.bottom < 0 || r.top > window.innerHeight * 3) continue;
      if (r.height < limit) out.push(`${Math.round(r.height)}px "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}"`);
    }
    return out;
  }, min);
}

/** Görünür düğme/sekme etiketlerinden "…" ile kesilenler (text-overflow: ellipsis + taşma). */
async function truncatedLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const btn of document.querySelectorAll<HTMLElement>('main :is(button, a.btn, [role="tab"]), .fab-bar button')) {
      const r = btn.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      for (const el of [btn, ...btn.querySelectorAll<HTMLElement>("*")]) {
        const cs = getComputedStyle(el);
        if (cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) {
          out.push((btn.textContent || "").trim().slice(0, 40));
          break;
        }
      }
    }
    return out;
  });
}

const PERSONAS = ["Danışman", "Ofis sahibi"] as const;

for (const persona of PERSONAS) {
  test.describe(`tek görünüm kiti — ${persona}`, () => {
    test("DENGE: /app/musteriler KPI şeridi görünür (telefonda ≤2 kart); kullanıcı menüsünde görünüm anahtarı yok", async ({ browser }) => {
      const page = await demoLogin(browser, persona, PHONE_390);
      test.skip(!page, `/giris'te "${persona}" demo kartı yok`);
      await open(page!, "/app/musteriler");
      await expect(page!.locator(".kpi-flow").first()).toBeVisible();
      const shown = await page!.locator(".kpi-flow .pm-card").evaluateAll((els) => els.filter((e) => (e as HTMLElement).getBoundingClientRect().width > 0).length);
      expect(shown).toBeGreaterThan(0);
      expect(shown).toBeLessThanOrEqual(2);
      // Kalan göstergeler aynı yerde açılır.
      const more = page!.locator(".kpi-cap-toggle").first();
      if (await more.isVisible().catch(() => false)) {
        await more.tap();
        await expect.poll(() => page!.locator(".kpi-flow .pm-card").evaluateAll((els) => els.filter((e) => (e as HTMLElement).getBoundingClientRect().width > 0).length)).toBeGreaterThan(2);
      }
      await page!.getByRole("button", { name: /Kullanıcı menüsü/ }).first().click();
      await expect(page!.getByRole("menuitemcheckbox", { name: /Sade görünüm/ })).toHaveCount(0);
      await expect(page!.getByText(/Tüm özellikleri göster/)).toHaveCount(0);
      await page!.keyboard.press("Escape");
      await page!.context().close();
    });

    test("DENGE: ilk ekran yoğunluğu — 1366 px ≥8 bilgi / ≤25 çerçeve denetimi, 390 px ≥5 / ≤15", async ({ browser }) => {
      for (const [vp, target] of [
        [DESKTOP, DENSITY_TARGET.desktop],
        [PHONE_390, DENSITY_TARGET.phone],
      ] as const) {
        const page = await demoLogin(browser, persona, vp);
        test.skip(!page, `/giris'te "${persona}" demo kartı yok`);
        for (const path of ["/app", "/app/musteriler", "/app/portfoyler", "/app/randevular", "/app/gorevler", "/app/anlasmalar"]) {
          await open(page!, path);
          const d = await firstScreenDensity(page!);
          expect(d.info, `${vp.width}px ${path}: bilgi öğesi`).toBeGreaterThanOrEqual(target.minInfo);
          expect(d.chrome, `${vp.width}px ${path}: çerçeve denetimi`).toBeLessThanOrEqual(target.maxChrome);
        }
        await page!.context().close();
      }
    });

    test("C05: 390 px — en çok 2 KPI, etiket görünür, sayı kesilmez", async ({ browser }) => {
      const page = await demoLogin(browser, persona, PHONE_390);
      test.skip(!page, `/giris'te "${persona}" demo kartı yok`);
      for (const path of ["/app/musteriler", "/app/portfoyler", "/app/gorevler"]) {
        await open(page!, path);
        const cards = await page!.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>(".kpi-compact .pm-card")]
            .filter((c) => c.getBoundingClientRect().width > 0)
            .map((c) => {
              const title = c.querySelector<HTMLElement>(".pm-card-title");
              const value = c.querySelector<HTMLElement>(".pm-value");
              const cr = c.getBoundingClientRect();
              const vr = value?.getBoundingClientRect();
              return {
                label: (title?.textContent ?? "").trim(),
                labelVisible: !!title && title.getBoundingClientRect().height > 0,
                valueCut: !!value && (value.scrollWidth > value.clientWidth + 1 || (vr ? vr.right > cr.right + 0.5 : false)),
              };
            }),
        );
        expect(cards.length, `${path}: görünen KPI`).toBeLessThanOrEqual(2);
        for (const c of cards) {
          expect(c.labelVisible && c.label.length > 0, `${path}: etiket`).toBe(true);
          expect(c.valueCut, `${path}: "${c.label}" sayısı kesik`).toBe(false);
        }
      }
      await page!.context().close();
    });

    test("C06: 360 px dokunmatik — görünür düğmelerde 40 px altı yok", async ({ browser }) => {
      const page = await demoLogin(browser, persona, PHONE);
      test.skip(!page, `/giris'te "${persona}" demo kartı yok`);
      for (const path of ["/app", "/app/gorevler", "/app/randevular"]) {
        await open(page!, path);
        expect(await smallButtons(page!, 40), path).toEqual([]);
      }
      await page!.context().close();
    });

    test("başlıkta tek dolu düğme + en çok 2 ikincil; görünüm değiştirici telefonda '…' menüsünde; 'Kanban' yok", async ({ browser }) => {
      const page = await demoLogin(browser, persona, DESKTOP);
      test.skip(!page, `/giris'te "${persona}" demo kartı yok`);
      for (const path of ["/app/musteriler", "/app/portfoyler", "/app/gorevler"]) {
        await open(page!, path);
        const visibleIn = (sel: string) =>
          page!.locator(sel).evaluateAll((els) => els.filter((e) => (e as HTMLElement).getBoundingClientRect().width > 0).length);
        expect(await visibleIn("main :is(header, .lp-hero) .btn-primary"), `${path}: başlıktaki dolu düğme`).toBeLessThanOrEqual(1);
        expect(await visibleIn("main :is(header, .lp-hero) .ovf-inline > *"), `${path}: satır içi ikincil`).toBeLessThanOrEqual(2);
        expect(await page!.locator("main").innerText(), path).not.toContain("Kanban");
      }
      await page!.context().close();
      const phone = await demoLogin(browser, persona, PHONE_390);
      test.skip(!phone, `/giris'te "${persona}" demo kartı yok`);
      await open(phone!, "/app/gorevler");
      const navs = await phone!
        .locator('main nav[aria-label="Görünüm"]')
        .evaluateAll((els) => els.filter((e) => (e as HTMLElement).getBoundingClientRect().width > 0).length);
      expect(navs, "telefonda satır içi görünüm anahtarı").toBe(0);
      await phone!.context().close();
    });

    test("seçim kutuları 'Seç' moduna kadar gizli; görünen yardım metni kısa", async ({ browser }) => {
      const page = await demoLogin(browser, persona, PHONE);
      test.skip(!page, `/giris'te "${persona}" demo kartı yok`);
      await open(page!, "/app/musteriler");
      const visibleBoxes = () =>
        page!.locator('main input[type="checkbox"]:not(.kpi-cap-input)').evaluateAll((els) => els.filter((e) => (e as HTMLElement).getBoundingClientRect().width > 0).length);
      expect(await visibleBoxes()).toBe(0);
      const tallHelp = await page!
        .locator(".helper-text")
        .evaluateAll((els) => els.filter((e) => (e as HTMLElement).getBoundingClientRect().height > 40).map((e) => (e.textContent ?? "").slice(0, 40)));
      expect(tallHelp).toEqual([]);
      const select = page!.getByRole("button", { name: "Seç", exact: true });
      if (await select.isVisible().catch(() => false)) {
        await select.tap();
        await expect.poll(visibleBoxes).toBeGreaterThan(0);
      }
      await page!.context().close();
    });

    test("ilke 5: mobilde düğme ve sekme etiketleri kesilmez", async ({ browser }) => {
      const page = await demoLogin(browser, persona, PHONE);
      test.skip(!page, `/giris'te "${persona}" demo kartı yok`);
      for (const path of ["/app", "/app/musteriler", "/app/gorevler", "/app/musteriler/yeni", "/app/portfoyler/yeni"]) {
        await open(page!, path);
        expect(await truncatedLabels(page!), path).toEqual([]);
      }
      await page!.context().close();
    });

    test("2.7: form sayfasında alt gezinme gizli, tek 'Kaydet', İptal 'Daha fazla' içinde", async ({ browser }) => {
      const page = await demoLogin(browser, persona, PHONE);
      test.skip(!page, `/giris'te "${persona}" demo kartı yok`);
      for (const path of ["/app/musteriler/yeni", "/app/portfoyler/yeni", "/app/randevular/yeni"]) {
        await open(page!, path);
        const bar = page!.locator('.fab-bar[data-sticky="1"]');
        if ((await bar.count()) === 0) continue; // bu rotada yapışkan form çubuğu yok (ör. adım akışı)
        await expect(page!.locator('nav[aria-label="Mobil hızlı gezinme"]')).toBeHidden();
        const submit = bar.locator('button[type="submit"]').filter({ visible: true });
        await expect(submit).toHaveCount(1);
        const text = (await submit.innerText()).trim();
        expect(text, path).not.toMatch(/eksik|…$/);
        expect(text.split(/\s+/).length, `${path}: "${text}"`).toBeLessThanOrEqual(2);
        const cancel = bar.getByRole("button", { name: /^(İptal|Vazgeç)$/ }).filter({ visible: true });
        await expect(cancel).toHaveCount(0);
        await bar.getByRole("button", { name: "Daha fazla" }).tap();
        await expect(bar.locator("[data-fab-more]").getByText(/^(İptal|Vazgeç)$/)).toBeVisible();
      }
      await page!.context().close();
    });
  });
}
