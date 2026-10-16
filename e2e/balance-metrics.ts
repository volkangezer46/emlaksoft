import type { Page } from "@playwright/test";

/**
 * DENGELİ GÖRÜNÜM ölçüsü (sahip kararı 2026-10-16: "önceki hali çok karışıktı, bu da çok boş"). İlk ekrandaki
 * (görünür alan, kaydırmadan) içerik yoğunluğu:
 *
 *  - `info`: bilgi taşıyan öğe — KPI kartı (`.pm-card`), tablo/liste satırı, kart başlığı (h2/h3), tanım (dt),
 *    `article`; en az 3 karakter metin. İç içe satırda yalnız dıştaki sayılır.
 *  - `chrome`: sayfa ÇERÇEVESİNİN etkileşimli öğeleri (başlık eylemleri, sekme, filtre, katlama düğmeleri…); veri
 *    satırlarının kendi eylemleri (tablo satırı, liste öğesi, kart) ve tıklanabilir KPI kartları (bilgi öğesidir)
 *    sayılmaz — satır sayısı veriye bağlıdır.
 *  - `kpi`: görünür KPI kartı sayısı.
 *
 * Hedefler (kabul): masaüstü 1366x768 `info` ≥ 8 ve `chrome` ≤ 25; telefon 390x844 `info` ≥ 5 ve `chrome` ≤ 15.
 * Kapalı `<details>` içeriği görünmez sayılır; masaüstünde başlığı gizli açık bölüm (`data-fold-phone`) görünür sayılır.
 */
export type Density = { info: number; chrome: number; kpi: number };

export const DENSITY_TARGET = {
  desktop: { minInfo: 8, maxChrome: 25 },
  phone: { minInfo: 5, maxChrome: 15 },
} as const;

export async function firstScreenDensity(page: Page): Promise<Density> {
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.evaluate(() => {
    const H = window.innerHeight;
    const W = window.innerWidth;
    const folded = (el: Element) => {
      for (let d = el.closest("details:not([open])"); d; d = d.parentElement?.closest("details:not([open])") ?? null) {
        const summary = d.querySelector(":scope > summary");
        if (summary && el.closest("summary") === summary) continue;
        if (!summary || getComputedStyle(summary).display !== "none") return true;
      }
      return false;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05 && !el.closest("[hidden]") && !folded(el);
    };
    const main = document.querySelector("#main-content") ?? document.querySelector("main") ?? document.body;
    const ROW = "tbody tr, [role=row], li, article, [data-program-satir], .pm-card";
    const controls = [...main.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="tab"]')].filter(visible);
    const chrome = controls.filter((el) => !el.closest(ROW)).length;
    const infoEls = [...main.querySelectorAll(".pm-card, tbody tr, [role=row], li, article, h2, h3, dt")]
      .filter(visible)
      .filter((el) => ((el as HTMLElement).innerText || "").trim().length > 2);
    const outer = infoEls.filter((el) => !infoEls.some((o) => o !== el && o.contains(el) && o.matches(".pm-card, tbody tr, [role=row], li, article, dt")));
    const kpi = [...main.querySelectorAll(".pm-card")].filter(visible).length;
    return { info: outer.length, chrome, kpi };
  });
}
