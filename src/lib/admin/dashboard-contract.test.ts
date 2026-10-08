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
    for (const p of ["src/app/admin/billing/loading.tsx", "src/app/admin/raporlar/loading.tsx"]) {
      const src = read(p);
      expect(src).not.toContain("animate-pulse");
      expect(src).toContain("SkeletonCard");
    }
    // _dashboards/shared.tsx'teki çağıransız GlassSkeleton/KpiGridSkeleton kopyaları silindi (KPI iskeleti ui/kpi-card).
    expect(read("src/app/admin/_dashboards/shared.tsx")).not.toContain("animate-pulse");
  });

  it("billing ve raporlar canlı AreaTrendChart'ı (tembel kapı) kullanır; statik SVG AreaChart ve el yapımı çizgi yok", () => {
    for (const p of ["src/app/admin/billing/page.tsx", "src/app/admin/raporlar/page.tsx", "src/app/admin/page.tsx"]) {
      const src = read(p);
      expect(src).toContain("@/components/ui/lazy-charts");
      expect(src).not.toMatch(/<AreaChart\b/);
      expect(src).not.toMatch(/<FunnelChart\b/);
      expect(src).not.toContain("<polyline");
    }
    expect(read("src/app/admin/billing/page.tsx")).toContain("AreaTrendChart");
    expect(read("src/app/admin/raporlar/page.tsx")).toContain("AreaTrendChart");
  });

  it("/app/raporlar ve /admin/growth statik HBarList/NetDiffChart/FunnelChart yerine canlı çubuk grafik kullanır", () => {
    const app = read("src/app/app/raporlar/page.tsx");
    expect(app).toContain("RankBars");
    expect(app).toContain("NetBars");
    expect(app).not.toMatch(/HBarList|NetDiffChart/);
    expect(read("src/app/admin/growth/page.tsx")).not.toMatch(/<FunnelChart\b/);
  });

  it("kontrol paneli satır çekip saymaz: aktivite/huni/deneme/iptal/defter tek SQL toplulaştırma RPC'sinden gelir", () => {
    const src = read("src/app/admin/page.tsx");
    expect(src).toContain("platform_dashboard_rollups");
    expect(src).not.toContain("fetchAllPaged");
    expect(src).not.toMatch(/from\("audit_logs"\)\.select\("tenant_id, created_at"\)/);
    expect(src).not.toContain("account_credit_ledger");
    const sql = read("supabase/migrations/20261008001400_platform_dashboard_rollups.sql");
    // Yalnız service_role çağırır; anon/authenticated yürütemez.
    expect(sql).toMatch(/auth\.role\(\)[\s\S]*<> 'service_role'/);
    expect(sql).toMatch(/revoke all on function public\.platform_dashboard_rollups[^;]*from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.platform_dashboard_rollups[^;]*to service_role/);
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).not.toMatch(/\b(insert|update|delete)\s+(into|from)?\s*public\./i);
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
