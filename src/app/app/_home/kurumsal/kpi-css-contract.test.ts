import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * F7 / M4 / M6 / M3 — KPI kartı CSS sözleşmesi (home.css; /admin ops-kit aynı KpiCard + home.css'i kullanır).
 *  - 104 px sağ boşluk YALNIZ mini grafikli kartta; açıklama 2 satır sıkıştırma (tek satır "…" değil).
 *  - ≤ 320 px kartta mini grafik meta satırının altına iner (360 px telefonda "Bu ay ciro" açıklaması görünür).
 *  - Kartın tamamı değer bağlantısının dokunma alanı (gerilmiş bağlantı; kart ≥ 124 px → ≥ 44 × 44).
 *  - Telefonda sayfa içi Zeka kutusu görünürken yüzen düğme gizlenir (zeka-fab.css'e dokunulmaz).
 */
const css = readFileSync(resolve(process.cwd(), "src/app/app/_home/kurumsal/home.css"), "utf8");
const views = readFileSync(resolve(process.cwd(), "src/app/app/_home/kurumsal/views.tsx"), "utf8");
const ops = readFileSync(resolve(process.cwd(), "src/app/admin/_components/ops-kit.tsx"), "utf8");
const ask = readFileSync(resolve(process.cwd(), "src/app/app/_home/kurumsal/hero-arama.tsx"), "utf8");
/** Son tanım kazanır: dosyada bir seçicinin EN SON kural gövdesi. */
const lastRule = (selector: string) => {
  const re = new RegExp(`(^|[}\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g");
  let m: RegExpExecArray | null;
  let body: string | null = null;
  while ((m = re.exec(css))) body = m[2]!;
  return body;
};

describe("KPI açıklaması (F7 / M4)", () => {
  it("sağ boşluk yalnız mini grafikli kartta", () => {
    expect(lastRule(".kh-kpi .kh-kpi-meta")).toContain("max-width: none");
    expect(css).toMatch(/\.kh-kpi:has\(\.kh-kpi-spark\) \.kh-kpi-meta \{ max-width: calc\(100% - 104px\); \}/);
  });

  it("açıklama 2 satıra kadar (kesme yok)", () => {
    const cap = lastRule(".kh-kpi-cap")!;
    expect(cap).toContain("-webkit-line-clamp: 2");
    expect(cap).toContain("white-space: normal");
  });

  it("≤ 320 px kartta mini grafik meta satırının altına iner", () => {
    const i = css.indexOf("@container kh-kpi (max-width: 320px)");
    expect(i).toBeGreaterThan(-1);
    const body = css.slice(i, i + 500);
    expect(body).toMatch(/\.kh-kpi-spark \{ position: static; grid-column: 1 \/ -1; grid-row: 3/);
    expect(body).toContain("max-width: none");
  });

  it("/admin ops kartları aynı KpiCard'ı kullanır (ayrı biçim yok)", () => {
    expect(ops).toContain("<KpiCard");
    expect(ops).not.toMatch(/kh-kpi-meta|kh-kpi-cap/);
  });
});

describe("KPI dokunma hedefi (M6)", () => {
  it("değer bağlantısı kartın tamamına gerilir; ⋯ menüsü üstte kalır", () => {
    expect(lastRule(".kh-kpi-value::after")).toMatch(/position: absolute; inset: 0/);
    expect(lastRule(".kh-kpi-menu")).toContain("z-index: 2");
    expect(css).toMatch(/\.kh-card \{\s*position: relative/);
    expect(views).toMatch(/<Link href=\{href\} className="kh-kpi-value focus-ring"/);
  });
});

describe("Telefonda Zeka düğmesi (M3)", () => {
  it("sayfa içi kutu görünürken <html data-zeka-inline-visible> + gizleme kuralı", () => {
    expect(ask).toContain('INLINE_VISIBLE_ATTR = "data-zeka-inline-visible"');
    expect(ask).toContain("new IntersectionObserver(");
    expect(ask).toContain("root.removeAttribute(INLINE_VISIBLE_ATTR)");
    expect(css).toMatch(/html\[data-zeka-inline-visible\] \.zk-fab/);
    expect(css).toMatch(/@media \(max-width: 1023\.98px\) \{\s*html\[data-zeka-inline-visible\]/);
  });
});
