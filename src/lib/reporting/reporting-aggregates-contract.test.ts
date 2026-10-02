import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const migration = source("supabase/migrations/20260802000340_reporting_aggregates.sql");
const commission = source("src/app/app/komisyon/page.tsx");
const tenantReports = source("src/app/app/raporlar/page.tsx");
const adminHome = source("src/app/admin/page.tsx");
const adminReports = source("src/app/admin/raporlar/page.tsx");

describe("exact reporting aggregate contract", () => {
  it("tenant RPCs derive scope from the authenticated tenant and enforce module access", () => {
    expect(migration).toContain("v_tenant uuid := public.current_active_tenant_id()");
    expect(migration).toContain("public.has_effective_permission('commissions', 'view')");
    expect(migration).toContain("public.has_effective_permission('reports', 'view')");
    expect(migration).toContain("where c.tenant_id = v_tenant");
    expect(migration).toContain("grant execute on function public.tenant_reporting_aggregates");
    expect(migration).not.toContain("grant execute on function public.tenant_reporting_aggregates(timestamptz) to anon");
  });

  it("platform aggregate is callable only through the server-only service boundary", () => {
    expect(migration).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(migration.match(/set search_path = ''/g)).toHaveLength(3);
    expect(migration).toContain("revoke all on function public.platform_reporting_aggregates(date, date, timestamptz) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.platform_reporting_aggregates(date, date, timestamptz) to service_role");
  });

  it("all four KPI pages consume aggregate RPCs and fail visibly on query errors", () => {
    expect(commission).toContain('rpc("tenant_commission_aggregates"');
    expect(tenantReports).toContain('rpc("tenant_reporting_aggregates"');
    expect(adminHome).toContain('rpc("platform_reporting_aggregates"');
    expect(adminReports).toContain('rpc("platform_reporting_aggregates"');
    for (const page of [commission, tenantReports, adminHome, adminReports]) {
      expect(page).toContain("requireReportingData");
    }
  });

  it("admin pages use the central plan catalog instead of duplicating prices", () => {
    for (const page of [adminHome, adminReports]) {
      expect(page).toContain('@/lib/billing/plans');
      expect(page).not.toContain("advisor: 990");
      expect(page).not.toContain("office: 2490");
    }
  });

  it("treats subscription amounts as canonical monthly MRR for every billing cycle", () => {
    expect(migration).toContain("sum(amount_try)");
    expect(migration).toContain("sum(s.amount_try)");
    expect(migration).not.toMatch(/amount_try\s*\/\s*12/);
  });
});
