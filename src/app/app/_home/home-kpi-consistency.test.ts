import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * F3 — danışman ana ekranı kendi içinde çelişmez: "Müşterilerim" toplamı ve "Bu ay N yeni" AYNI kapsamlı kümeden
 * (home_kpi_snapshot ya da eski yolda aynı `custCount` kurucusu); "Geciken görevim" kahraman / Dikkat / alt çubuk rozetiyle
 * AYNI gecikmiş sorgusundan (`loadOverdueTasks` → `overdueTasksCountQuery`). Kaynak sözleşmesi (yükleyiciler sunucu-only).
 */
const src = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const block = (text: string, start: string, len = 1200) => {
  const i = text.indexOf(start);
  expect(i, `${start} bulunamadı`).toBeGreaterThan(-1);
  return text.slice(i, i + len);
};

describe("F3 KPI tutarlılığı", () => {
  it("Müşterilerim: toplam ve açıklama tek kümeden (loadKpiData.customers), ayrı head sorgusu yok", () => {
    const role = src("src/app/app/_home/kurumsal/role-data.ts");
    const b = block(role, 'case "musterilerim": {', 900);
    expect(b).toContain("loadKpiData(ctx)");
    expect(b).toContain("c.total");
    expect(b).toContain("c.thisMonth");
    expect(b).not.toContain('from("customers")');
  });

  it("eski yolda da toplam KPI'nın kapsamlı kurucusundan (custCount) okunur", () => {
    const data = src("src/app/app/_home/kurumsal/data.ts");
    const legacy = block(data, "async function loadKpiDataLegacy", 6000);
    expect(legacy).toMatch(/custCount\(\) as unknown as PromiseLike<Counted>/);
    expect(legacy).toContain("total: custTotal.count");
  });

  it("RPC yolu: müşteri toplamı ve bu ay sayısı aynı SQL geçişinden", () => {
    const sql = src("supabase/migrations/20261027020000_home_kpi_snapshot.sql");
    const cust = block(sql, "-- Musteri: TEK gecis", 900);
    expect(cust).toContain("'total', count(*)");
    expect(cust).toContain("'this_month', count(*) filter (where t >= v_month_start)");
    expect(cust).toContain("(not v_mine or c.assigned_to = v_uid)");
  });

  it("Geciken görevim: 'Benim işlerim' kapsamında kahraman/Dikkat ile aynı sorgu (loadOverdueTasks)", () => {
    const data = src("src/app/app/_home/data.ts");
    const b = block(data, "export const loadTaskSummary = cache(", 500);
    expect(b).toContain("ctx.scopeMine ? loadOverdueTasks(ctx)");
    expect(b).toContain("overdue: mineOverdue");
    const att = block(data, "export const loadAttention = cache(", 600);
    expect(att).toContain("loadOverdueTasks(ctx)");
    const role = src("src/app/app/_home/kurumsal/role-data.ts");
    expect(block(role, 'case "geciken-gorev": {', 300)).toContain("loadTaskSummary(ctx)");
  });
});

describe("PERF-6/PERF-7/F8 tek okuma", () => {
  it("ofis satırı istek-içi tek okumadan (getTenantRow); ana ekran yollarında ayrı tenants sorgusu kalmadı", () => {
    for (const f of ["src/lib/app-shell/office-identity.ts", "src/lib/profile-completion-data.ts", "src/app/app/_home/data.ts"]) {
      const t = src(f);
      expect(t, f).toContain("getTenantRow(");
      expect(t, f).not.toMatch(/from\("tenants"\)/);
    }
    expect(src("src/lib/onboarding-state.ts")).not.toMatch(/from\("tenants"\)/);
    expect(src("src/lib/pool/server.ts")).toContain("export async function isPoolEnabledForRequest");
    expect(src("src/lib/cache/request.ts")).toMatch(/export const getTenantRow = cache\(/);
  });

  it("satış danışman listesi / bugün ofiste / en çok katkı profil okumasını ana sorguyla paralel paylaşır", () => {
    const data = src("src/app/app/_home/kurumsal/data.ts");
    expect(block(data, "export const loadSalesPerformance", 1200)).toContain("loadProfiles()");
    expect(block(data, "export const loadTeamToday", 1600)).toMatch(/loadProfiles\(\)\.catch/);
    const top = block(data, "export const loadTopContributor", 1400);
    expect(top).toContain("loadProfiles()");
    expect(top).not.toMatch(/from\("profiles"\)/);
  });

  it("ofis skoru kabuk kartı ve panelde aynı istek-içi değerden (getRequestOfficeScore)", () => {
    expect(src("src/components/app/office-card-slot.tsx")).toContain("getRequestOfficeScore(");
    expect(src("src/app/app/_home/kurumsal/data.ts")).toContain("getRequestOfficeScore(");
    expect(src("src/app/app/_home/kurumsal/data.ts")).not.toContain("getOfficeScoreCached(");
    const blocks = src("src/app/app/_home/kurumsal/blocks.tsx");
    expect(blocks).toContain('label: "Teyit bekleyen"');
    expect(blocks).toContain('value: ok ? "Çalışıyor" : "Uyarı var"');
  });
});
