import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { segmentPhoneVisible } from "@/components/ui/segment-tabs";

/** WP3 liste tasarım sistemi sözleşmesi: tek başlık, tek araç çubuğu, tek KPI, hizalı sekmeler. */
const read = (f: string) => readFileSync(f, "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mts)$/.test(n)) out.push(p);
  }
  return out;
}
const SRC = walk("src");

describe("WP3 tek bileşen kuralı", () => {
  it("FilterBar silindi ve hiçbir dosya onu içe aktarmıyor", () => {
    expect(existsSync("src/components/ui/filter-bar.tsx")).toBe(false);
    expect(SRC.filter((f) => /from ["']@\/components\/ui\/filter-bar["']/.test(read(f)))).toEqual([]);
  });

  it("ListHero kaldırıldı (PageHeader variant=\"card\")", () => {
    expect(SRC.filter((f) => !f.endsWith(".test.ts") && /<ListHero\b|\bListHeroProps\b/.test(read(f)))).toEqual([]);
  });

  it("ilan kontrolün kopya KpiStrip'i yok; ortak list-kit şeridi kullanılır", () => {
    expect(read("src/components/listing-control/dashboard-sections.tsx")).not.toMatch(/export function KpiStrip/);
    expect(read("src/app/app/ilan-kontrol/page.tsx")).toMatch(/<KpiStrip items=\{controlKpiItems/);
  });

  it("ince KPI şeridinde mini çubuklar gizlenmez", () => {
    const css = read("src/app/list-page.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/\.lk-kpi-thin :is\([^)]*\.pm-chart/);
    expect(css).toMatch(/\.lk-kpi-thin \.pm-chart \{ grid-column: 3;/);
  });

  it("SegmentTabs içerik kenarına hizalı (negatif kenar boşluğu yok), alt çizgili", () => {
    const code = read("src/components/ui/segment-tabs.tsx");
    expect(code).not.toMatch(/-mx-\d/);
    expect(code).toContain("border-b-2");
  });

  it("SegmentTabs telefonda en çok 3 sekme, etkin sekme hep görünür", () => {
    expect([...segmentPhoneVisible(["a", "b"], "a")]).toEqual([0, 1]);
    expect([...segmentPhoneVisible(["a", "b", "c", "d", "e"], "a")]).toEqual([0, 1, 2]);
    expect([...segmentPhoneVisible(["a", "b", "c", "d", "e"], "e")].sort()).toEqual([0, 1, 4]);
  });

  it("hub sekme şeridinde 'Tümü +N' kaydırılan şeridin dışında (dar ekranda kesilmez)", () => {
    const code = read("src/components/ui/morph-tab-parts.tsx");
    const ulEnd = code.indexOf("</ul>");
    expect(code.indexOf("<MorphNavMore", ulEnd)).toBeGreaterThan(ulEnd);
  });

  it("tablolar 1024 px altında karta döner (tablet dahil)", () => {
    expect(read("src/app/list-page.css")).toMatch(/@media \(max-width: 1023\.98px\) \{\s*\/\*[\s\S]*?\*\/\s*\.tbl-stack > div/);
  });

  it("kapalı filtre alt sayfası çizilmez", () => {
    expect(read("src/app/list-page.css")).toContain(".lk-filter:not([open]) > .lk-sheet { display: none;");
  });

  it("KPI kartı = süzgeç: liste sayfaları etkin kartı işaretler", () => {
    for (const f of [
      "src/app/app/gorevler/page.tsx",
      "src/app/app/randevular/page.tsx",
      "src/app/app/musteriler/page.tsx",
      "src/app/app/anlasmalar/page.tsx",
      "src/app/app/kiralama/page.tsx",
      "src/app/app/kampanyalar/page.tsx",
      "src/app/app/portfoyler/page.tsx",
      "src/app/app/talepler/demands-view.tsx",
      "src/app/app/onaylar/page.tsx",
      "src/app/app/gelen-kutusu/inbox-view.tsx",
      "src/app/app/ekip/_tabs/advisors-tab.tsx",
    ]) {
      expect(read(f), f).toMatch(/\bactive: /);
    }
    // Görevler: zaman çipleri KPI kartlarıyla tekrar edilmez.
    expect(read("src/app/app/gorevler/page.tsx")).not.toMatch(/label="Görev zamanı"/);
  });
});
