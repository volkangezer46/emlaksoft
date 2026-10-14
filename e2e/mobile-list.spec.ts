import { test, expect, type Page } from "@playwright/test";

/**
 * Mobil liste sözleşmesi (YD6) — 390×844 telefonda gerçek piksel ölçümü (oturumlu `chromium` projesi).
 *
 *  1. Müşteriler ve portföyler listesinde ilk ekranda (alt gezinme çubuğunun üstünde) en az 4 kart satırı TAM görünür.
 *  2. İlk ekrandaki ve açılan filtre alt sayfasındaki her etkileşimli öğe ≥44×44 px (onay kutusunda saran label ölçülür).
 *
 * Statik karşılığı (tarayıcısız, her koşuda): src/components/ui/list-kit/mobile-list-contract.test.ts.
 * Test hesabının listesinde 4'ten az kayıt varsa satır ölçümü atlanır (sahte geçiş yok, atlama raporda görünür).
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

const PAGES = [
  { path: "/app/musteriler", name: "müşteriler" },
  { path: "/app/portfoyler", name: "portföyler" },
] as const;

/** Görünür alanın kullanılabilir alt sınırı: sabit mobil alt çubuğun üst kenarı (yoksa pencere yüksekliği). */
async function usableBottom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Mobil hızlı gezinme"]');
    const top = nav ? nav.getBoundingClientRect().top : window.innerHeight;
    return Math.min(top, window.innerHeight);
  });
}

type Small = { tag: string; text: string; w: number; h: number };

/** Kapsam içindeki görünür etkileşimli öğelerden 44 px altında kalanlar (yalnız `inViewport` alanı kesişenler). */
async function smallTargets(page: Page, scopeSelector: string, inViewport: boolean): Promise<Small[]> {
  return page.evaluate(
    ({ scopeSelector, inViewport }) => {
      const scope = document.querySelector(scopeSelector);
      if (!scope) return [{ tag: "scope", text: scopeSelector, w: 0, h: 0 }];
      const nav = document.querySelector('nav[aria-label="Mobil hızlı gezinme"]');
      const bottom = nav ? nav.getBoundingClientRect().top : window.innerHeight;
      const out: { tag: string; text: string; w: number; h: number }[] = [];
      const els = scope.querySelectorAll<HTMLElement>(
        'a[href], button, summary, select, textarea, input:not([type="hidden"]), [role="button"], [tabindex]:not([tabindex="-1"])',
      );
      for (const el of els) {
        let target: HTMLElement = el;
        if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) target = el.closest("label") ?? el;
        const r = target.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) continue; // gizli / sr-only
        const style = getComputedStyle(target);
        if (style.visibility === "hidden" || style.display === "none") continue;
        if (inViewport && (r.bottom <= 0 || r.top >= bottom || r.right <= 0 || r.left >= window.innerWidth)) continue;
        // Yatay kaydırma şeridinde kısmen görünen öğe kendi tam boyuyla ölçülür (rect zaten tam boy).
        if (r.width < 43.5 || r.height < 43.5) {
          out.push({ tag: target.tagName.toLowerCase(), text: (target.getAttribute("aria-label") ?? target.textContent ?? "").trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
        }
      }
      return out;
    },
    { scopeSelector, inViewport },
  );
}

async function openList(page: Page, path: string) {
  await page.goto(path);
  await expect(page).not.toHaveURL(/\/giris/);
  await expect(page.locator("main .lp")).toBeVisible({ timeout: 30_000 });
  // Akışla gelen KPI/çip blokları yerleşsin (CLS ölçümü yanıltmasın).
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

for (const { path, name } of PAGES) {
  test.describe(`mobil liste — ${name} (390×844)`, () => {
    test("ilk ekranda en az 4 satır tam görünür", async ({ page }) => {
      await openList(page, path);
      const rows = page.locator("main .tbl-stack tbody tr");
      const total = await rows.count();
      test.skip(total < 4, `Test hesabında ${name} listesinde ${total} kayıt var; 4 satır ölçümü için en az 4 kayıt gerekir.`);
      const limit = await usableBottom(page);
      const visible = await rows.evaluateAll(
        (els, lim) => els.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.height > 0 && r.bottom <= lim + 0.5;
        }).length,
        limit,
      );
      expect(visible, `${name}: alt çubuğun üstünde tam görünen satır sayısı`).toBeGreaterThanOrEqual(4);
      // Sayfa yatay taşmaz.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });

    test("ilk ekrandaki etkileşimli öğeler ≥44 px", async ({ page }) => {
      await openList(page, path);
      expect(await smallTargets(page, "main .lp", true)).toEqual([]);
    });

    test("filtreler tek alt sayfada; alt sayfadaki öğeler ≥44 px ve kapat düğmesiyle kapanır", async ({ page }) => {
      await openList(page, path);
      const summary = page.locator("main .lk-filter > summary");
      await summary.click();
      const sheet = page.locator("main .lk-filter[open] > .lk-sheet");
      await expect(sheet).toBeVisible();
      const box = await sheet.boundingBox();
      expect(box, "alt sayfa görünür").not.toBeNull();
      // Alt sayfa ekranın altına yapışık (sabit yaprak), tam genişlik.
      expect(Math.round(box!.y + box!.height)).toBeGreaterThanOrEqual(843);
      expect(Math.round(box!.width)).toBe(390);
      expect(await smallTargets(page, "main .lk-filter[open] > .lk-sheet", false)).toEqual([]);
      await page.getByRole("button", { name: "Filtreleri kapat" }).click();
      await expect(page.locator("main .lk-filter[open]")).toHaveCount(0);
    });
  });
}
