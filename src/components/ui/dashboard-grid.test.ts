import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fillRowSpans, kpiFlowCols } from "./dashboard-grid";

describe("fillRowSpans (DashboardGrid: satır sonunda boş hücre yok)", () => {
  it("tam satırlara dokunmaz", () => {
    expect(fillRowSpans([7, 5], 12)).toEqual([7, 5]);
    expect(fillRowSpans([4, 4, 4], 12)).toEqual([4, 4, 4]);
    expect(fillRowSpans([12, 6, 6], 12)).toEqual([12, 6, 6]);
  });

  it("eksik son satırın son öğesi satırı tamamlar", () => {
    expect(fillRowSpans([7], 12)).toEqual([12]);
    expect(fillRowSpans([3, 3, 3], 6)).toEqual([3, 3, 6]);
    expect(fillRowSpans([4, 4, 4, 4], 12)).toEqual([4, 4, 4, 12]);
  });

  it("sığmayan öğe yeni satıra geçer, kapanan satır genişletilir (CSS otomatik yerleşimiyle aynı)", () => {
    expect(fillRowSpans([7, 7], 12)).toEqual([12, 12]);
    expect(fillRowSpans([5, 4, 7], 12)).toEqual([5, 7, 12]);
  });

  it("kolon sayısını aşan span sıkıştırılır", () => {
    expect(fillRowSpans([12, 12], 6)).toEqual([6, 6]);
  });

  it("her çıktıda her satırın toplamı kolon sayısına eşit", () => {
    const cases: [number[], number][] = [
      [[3, 4, 5, 6, 7, 8], 12],
      [[1, 2, 3, 4, 5, 6], 6],
      [[5, 5, 5, 5, 5], 12],
    ];
    for (const [spans, cols] of cases) {
      const out = fillRowSpans(spans, cols);
      let used = 0;
      for (const n of out) {
        expect(used + n).toBeLessThanOrEqual(cols);
        used = used + n === cols ? 0 : used + n;
      }
      expect(used).toBe(0);
    }
  });
});

describe("KpiGrid (tek KPI ızgarası)", () => {
  it("satır başına kart sayısı: mobilde 2, geniş ekranda tek satır (5→5, 6→6), 7+ → 4", () => {
    expect(kpiFlowCols(1)).toBe("[--kpi-cols:1]");
    expect(kpiFlowCols(2)).toBe("[--kpi-cols:2]");
    expect(kpiFlowCols(5)).toContain("xl:[--kpi-cols:5]");
    expect(kpiFlowCols(6)).toContain("xl:[--kpi-cols:6]");
    expect(kpiFlowCols(7)).toContain("md:[--kpi-cols:4]");
    for (const n of [3, 4, 5, 6, 7, 8]) expect(kpiFlowCols(n).startsWith("[--kpi-cols:2]")).toBe(true);
  });

  it("esnek ızgara CSS'i son satırı doldurur (flex-grow) ve tek boşluk token'ı kullanır", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/premium.css"), "utf8");
    expect(css).toMatch(/\.kpi-flow \{[^}]*flex-wrap: wrap;[^}]*gap: var\(--kpi-gap\)/);
    expect(css).toMatch(/\.kpi-flow > \* \{[^}]*flex: 1 1 calc\(/);
  });

  it("ui/kpi-card KpiGrid'i yeniden dışa aktarır (ikinci uygulama yok)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/ui/kpi-card.tsx"), "utf8");
    expect(src).toContain('export { KpiGrid } from "./dashboard-grid"');
    expect(src).not.toMatch(/export function KpiGrid\(/);
  });
});
