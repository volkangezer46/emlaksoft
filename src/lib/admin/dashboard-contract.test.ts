import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("/admin paneller: süs animasyonu ve ham iskelet borcu", () => {
  const pages = [
    "src/app/admin/page.tsx",
    "src/app/admin/billing/page.tsx",
    "src/app/admin/muhasebe/page.tsx",
    "src/app/admin/raporlar/page.tsx",
  ];

  it("flow-line / glow-halo / conic-spin / chart-draw / bar-live kullanılmaz", () => {
    for (const p of pages) {
      const src = read(p);
      for (const cls of ["flow-line", "glow-halo", "conic-spin", "chart-draw", "bar-live"]) {
        expect(src, `${p} içinde ${cls}`).not.toContain(cls);
      }
    }
  });

  it("yükleme iskeletleri animate-pulse yerine SkeletonCard kullanır", () => {
    for (const p of ["src/app/admin/billing/loading.tsx", "src/app/admin/raporlar/loading.tsx", "src/app/admin/_dashboards/shared.tsx"]) {
      const src = read(p);
      expect(src).not.toContain("animate-pulse");
      expect(src).toContain("SkeletonCard");
    }
  });

  it("billing ve raporlar ortak AreaChart'ı kullanır (el yapımı svg çizgi yok)", () => {
    for (const p of ["src/app/admin/billing/page.tsx", "src/app/admin/raporlar/page.tsx"]) {
      const src = read(p);
      expect(src).toContain("AreaChart");
      expect(src).not.toContain("<polyline");
    }
  });

  it("ana ekran rol bazlı yerleşim ve dikkat kuyruğu saf fonksiyonlarını kullanır", () => {
    const src = read("src/app/admin/page.tsx");
    expect(src).toContain("platformHomeSections");
    expect(src).toContain("buildAttentionQueue");
    expect(src).toContain("buildChurnRows");
    // Platform insight okuyucusu yokken sahte içgörü üretilmez; yer işaretçisi bırakılır.
    expect(src).toContain("ATTENTION_INSIGHT_SLOT");
  });
});
