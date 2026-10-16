import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * SADE MOD — ORTAK KİT KABUL ÖLÇÜTLERİ (sadeleştirme planı; bu dosyanın sahibi B2, diğer paketler kendi senaryolarını
 * ayrı spec dosyasına yazar). 360 / 390 px dokunmatik telefon ve 1366 px masaüstü.
 *
 *  C02/C05  Sade modda `/app/musteriler` içinde `.kpi-flow` 0; "Sade görünüm" kapatılınca görünür. Tam modda 390 px'te
 *           görünen KPI kartı ≤2, her kartın etiketi görünür ve sayı metni kesilmeden okunur.
 *  C06      360 px dokunmatik: `/app`, `/app/gorevler`, `/app/randevular` görünür düğmelerinde yüksekliği 40 px'ten küçük
 *           öğe 0 (onay kutusu / anahtar rolleri hariç).
 *  2.5      Başlık eylemleri: liste başlığında en çok 1 dolu (birincil) düğme.
 *  2.1      Görünüm değiştirici sade modda "…" menüsünde (`nav[aria-label=Görünüm]` 0, "Kanban" metni 0).
 *  2.1/C15  Sade modda görünür seçim kutusu 0; "Seç" dokunuşundan sonra görünür.
 *  ilke 5   Mobilde düğme etiketi "…" ile kesilmez (text-overflow taşması 0).
 *  2.7      Form sayfası: alt gezinme gizli, altta tek "Kaydet" (kesilmez), İptal "Daha fazla" içinde.
 *  2.1      Küçük gri yardım metni (`.helper-text`) sade modda 0.
 *
 * Salt okunur (hiçbir kayıt yazılmaz; "Sade görünüm" tercihi yalnız bu tarayıcı bağlamının çerezidir).
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

/** Kullanıcı menüsünden "Sade görünüm"ü kapatır (yalnız bu bağlamın çerezi; sunucuda kayıt yok). */
async function setFullMode(page: Page) {
  await page.getByRole("button", { name: /Kullanıcı menüsü/ }).first().click();
  const item = page.getByRole("menuitemcheckbox", { name: /Sade görünüm/ });
  await expect(item).toBeVisible();
  if ((await item.getAttribute("aria-checked")) === "true") await item.click();
  await page.keyboard.press("Escape");
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
  test.describe(`sade mod kiti — ${persona}`, () => {
    test("C02/C05: sade modda /app/musteriler'de KPI şeridi yok; tam modda görünür", async ({ browser }) => {
      const page = await demoLogin(browser, persona, PHONE_390);
      test.skip(!page, `/giris'te "${persona}" demo kartı yok`);
      await open(page!, "/app/musteriler");
      await expect(page!.locator(".kpi-flow")).toHaveCount(0);
      await setFullMode(page!);
      await open(page!, "/app/musteriler");
      await expect(page!.locator(".kpi-flow").first()).toBeVisible();
      await page!.context().close();
    });

    test("C05: tam mod 390 px — en çok 2 KPI, etiket görünür, sayı kesilmez", async ({ browser }) => {
      const page = await demoLogin(browser, persona, PHONE_390);
      test.skip(!page, `/giris'te "${persona}" demo kartı yok`);
      await setFullMode(page!);
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

    test("başlıkta tek dolu düğme; görünüm değiştirici '…' menüsünde; 'Kanban' yok", async ({ browser }) => {
      const page = await demoLogin(browser, persona, DESKTOP);
      test.skip(!page, `/giris'te "${persona}" demo kartı yok`);
      for (const path of ["/app/musteriler", "/app/portfoyler", "/app/gorevler"]) {
        await open(page!, path);
        const primaries = await page!
          .locator("main :is(header, .lp-hero) .btn-primary")
          .evaluateAll((els) => els.filter((e) => (e as HTMLElement).getBoundingClientRect().width > 0).length);
        expect(primaries, `${path}: başlıktaki dolu düğme`).toBeLessThanOrEqual(1);
        await expect(page!.locator('main nav[aria-label="Görünüm"]'), path).toHaveCount(0);
        expect(await page!.locator("main").innerText(), path).not.toContain("Kanban");
      }
      await page!.context().close();
    });

    test("seçim kutuları 'Seç' moduna kadar gizli; yardım metni yok", async ({ browser }) => {
      const page = await demoLogin(browser, persona, PHONE);
      test.skip(!page, `/giris'te "${persona}" demo kartı yok`);
      await open(page!, "/app/musteriler");
      const visibleBoxes = () =>
        page!.locator('main input[type="checkbox"]').evaluateAll((els) => els.filter((e) => (e as HTMLElement).getBoundingClientRect().width > 0).length);
      expect(await visibleBoxes()).toBe(0);
      await expect(page!.locator(".helper-text")).toHaveCount(0);
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
