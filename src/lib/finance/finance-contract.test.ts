import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("gider bütçesi / tekrar / portal sözleşmesi", () => {
  const sql = read("supabase/migrations/20261008000700_expense_budgets_recurring_portal.sql");

  it("migration: RLS açık, politikalar tenant + izin kapılı, rollback çifti var", () => {
    expect(sql).toMatch(/alter table public\.expense_budgets enable row level security/);
    for (const op of ["select", "insert", "update", "delete"]) {
      expect(sql).toMatch(new RegExp(`create policy expense_budgets_${op} on public\\.expense_budgets`));
    }
    expect(sql).toContain("current_active_tenant_id()");
    expect(sql).toContain("has_effective_permission('expenses', 'edit')");
    expect(sql).toMatch(/revoke all on table public\.expense_budgets from public, anon, authenticated/);
    expect(fs.existsSync(path.join(root, "supabase/rollbacks/20261008000700_expense_budgets_recurring_portal.rollback.sql"))).toBe(true);
  });

  it("migration: yeni sütunlar null'lanabilir ve kapalı değer listeli (mevcut satırlar değişmez)", () => {
    expect(sql).toMatch(/add column if not exists recurrence text/);
    expect(sql).toMatch(/add column if not exists portal_key text/);
    expect(sql).not.toMatch(/recurrence text not null/);
    expect(sql).toContain("'monthly', 'quarterly', 'yearly'");
    expect(sql).toContain("'sahibinden', 'hepsiemlak', 'zingat', 'emlakjet'");
  });

  it("bütçe action'ı yetki kapılı ve kategoriyi tanım listesinden doğrular", () => {
    const src = read("src/app/actions/expense-budgets.ts");
    expect(src.match(/await requirePermission\("expenses", "edit"\)/g)?.length).toBe(1);
    expect(src).toContain('getDefinitionsOrDefault("expense_category")');
    expect(src).toContain("tenant_id: gate.tenantId");
  });

  it("gider action'ları yeni sütunları yalnız doluyken yazar (şema yokken eski akış çalışır)", () => {
    const src = read("src/app/actions/expenses.ts");
    expect(src).toContain("...(fin.value.recurrence ? { recurrence: fin.value.recurrence } : {})");
    expect(src).toContain("...(fin.value.portalKey ? { portal_key: fin.value.portalKey } : {})");
    expect(src).toContain("...(fin.value.hasRecurrence ? { recurrence: fin.value.recurrence } : {})");
    // liste okuması şema yoksa eski sütunlarla yeniden denenir
    expect(src).toContain("isMissingFinanceSchema(error)");
  });

  it("içgörü kuralları: gider kuralları yalnız yönetim alıcılı, gelir kuralları kullanıcı alıcılı; LLM yok", () => {
    const finance = read("src/lib/insights/rules/finance.ts");
    expect(finance).not.toMatch(/audience: \{ type: "user"/);
    expect(finance.match(/audience: \{ type: "management"/g)?.length).toBeGreaterThanOrEqual(4);
    const revenue = read("src/lib/insights/rules/revenue.ts");
    expect(revenue).not.toMatch(/type: "management"/);
    for (const f of ["src/lib/insights/rules/finance.ts", "src/lib/insights/rules/revenue.ts", "src/lib/insights/revenue-facts.ts", "src/lib/finance/load.ts"]) {
      expect(read(f)).not.toMatch(/openai|api\.openai\.com/i);
    }
  });

  it("olgu yükleyicileri örnek veriyi dışarıda bırakır ve tenant süzgeci taşır", () => {
    for (const f of ["src/lib/insights/revenue-facts.ts", "src/lib/finance/load.ts"]) {
      const src = read(f);
      expect(src).toContain('.eq("tenant_id", tenantId)');
      expect(src).toContain('.eq("is_sample", false)');
    }
  });
});
