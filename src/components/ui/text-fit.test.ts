import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Metin sığma sözleşmesi: kanonik kart bileşenleri uzun metinde taşmaz (kısıt + tam metin `title`),
 * panellerin KPI etiketleri / alt başlıkları kısa kalır. Statik kaynak denetimi (tarayıcı gerekmez).
 */
const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const KPI_LABEL_MAX = 22;
const SUBTITLE_MAX = 60;

describe("kanonik bileşenlerde taşma koruması", () => {
  it("KpiTile: etiket line-clamp + title, değer min-w-0/nowrap, alt metin kısıtlı", () => {
    const tsx = read("src/components/ui/premium/kpi-card.tsx");
    expect(tsx).toMatch(/pm-card-title line-clamp-2" title=\{label\}/);
    const css = read("src/app/premium.css");
    expect(css).toMatch(/\.pm-value \{[^}]*white-space: nowrap[^}]*min-width: 0/);
    expect(css).toMatch(/\.pm-sub \{[^}]*line-clamp: 2/);
    expect(css).toMatch(/\.pm-card-title \{[^}]*min-width/);
  });

  it("kart başlık şeridi (ds-head): başlık ve alt başlık satır kısıtlı", () => {
    const css = read("src/app/premium.css");
    expect(css).toMatch(/\.ds-head \.ds-title, \.ds-head \.ds-sub \{[^}]*min-width: 0[^}]*line-clamp: 2/);
    expect(read("src/components/ui/chart-frame.tsx")).toMatch(/className="ds-title" title=\{title\}/);
    expect(read("src/components/ui/attention-list.tsx")).toMatch(/className="ds-title" title=\{title\}/);
  });

  it("AttentionList satırları truncate + title, rozet nowrap", () => {
    const tsx = read("src/components/ui/attention-list.tsx");
    expect(tsx).toMatch(/truncate[^"]*" title=\{it\.label\}/);
    expect(tsx).toMatch(/truncate[^"]*" title=\{it\.hint\}/);
    expect(tsx).toMatch(/min-w-0 flex-1/);
    expect(read("src/app/premium.css")).toMatch(/\.ds-pill \{[^}]*white-space: nowrap/);
  });

  it("StatusTile ve InsightCard: truncate / line-clamp + title", () => {
    const tile = read("src/components/ui/status-tile.tsx");
    expect(tile).toMatch(/min-w-0 truncate/);
    expect(tile).toMatch(/title=\{value\}/);
    const card = read("src/components/ui/insight-card.tsx");
    expect(card).toMatch(/line-clamp-2[^"]*"[^>]*title=\{title\}/);
    expect(card).toMatch(/line-clamp-3[^"]*" title=\{why\}/);
  });

  it("DashboardHero özeti: en çok 3 satır, uzun sözcük kırılır", () => {
    const css = read("src/app/premium.css");
    expect(css).toMatch(/\.ds-hero-summary \{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/\.ds-hero-summary > p \{[^}]*line-clamp: 3/);
  });
});

describe("panel metinleri kısa", () => {
  it("ana ekran KPI etiketleri tek kaynakta kısa", () => {
    const files = ["src/app/app/_home/home-metrics.ts", "src/app/app/_home/metrik-seridi.tsx"];
    for (const f of files) {
      const src = read(f);
      for (const m of src.matchAll(/\blabel: "([^"$]+)"/g)) {
        expect(m[1]!.length, `${f}: "${m[1]}"`).toBeLessThanOrEqual(KPI_LABEL_MAX);
      }
    }
  });

  it("admin panel KpiCard etiketleri kısa", () => {
    const files = [
      "src/app/admin/page.tsx",
      "src/app/admin/_dashboards/billing-home.tsx",
      "src/app/admin/_dashboards/support-home.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      for (const m of src.matchAll(/<KpiCard\b[^>]*?\blabel="([^"]+)"/g)) {
        expect(m[1]!.length, `${f}: "${m[1]}"`).toBeLessThanOrEqual(KPI_LABEL_MAX);
      }
    }
  });

  it("kart alt başlıkları tek satıra sığar", () => {
    const files = [
      "src/app/admin/page.tsx",
      "src/app/admin/_dashboards/billing-home.tsx",
      "src/app/admin/_dashboards/support-home.tsx",
      "src/app/app/_home/gelir-egrisi.tsx",
      "src/app/app/_home/huni-hedef.tsx",
      "src/app/app/performansim/son-30-gun.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      for (const m of src.matchAll(/\bsubtitle="([^"]+)"/g)) {
        expect(m[1]!.length, `${f}: "${m[1]}"`).toBeLessThanOrEqual(SUBTITLE_MAX);
      }
    }
  });
});
