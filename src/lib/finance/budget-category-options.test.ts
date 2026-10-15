import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPENSE_CATEGORIES } from "@/lib/definition-defaults";
import { CASH_CATEGORIES, budgetCategoryFor } from "@/lib/finance/cash/categories";
import { budgetCategoryOptions } from "@/lib/finance/expense-budget";

/**
 * SK6/B102: Bütçe formunda 'Kira' seçip kaydetmek finance_v2_budget_category ile 'ofis' satırını sessizce eziyordu.
 * Seçenekler artık SQL eşlemesinin TS karşılığıyla (budgetCategoryFor → expenseCategoryFor) bütçe anahtarına iner ve tekilleşir.
 */
describe("bütçe kategori seçenekleri (B102)", () => {
  const defs = EXPENSE_CATEGORIES.map((d) => ({ value: d.value, label: d.label }));

  it("gider yönünde eşlenmiş anahtarlarda tekrar yok; 'Kira' ayrı seçenek değil", () => {
    const out = budgetCategoryOptions("out", defs, [], true);
    const values = out.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    for (const raw of ["kira", "aidat", "muhasebe", "portal", "sgk", "diger_gider"]) expect(values).not.toContain(raw);
    const ofis = out.find((o) => o.value === "ofis");
    expect(ofis?.label).toBe("Ofis gideri (kira, aidat, muhasebe dahil)");
    expect(ofis?.includes).toEqual(["Kira", "Aidat", "Muhasebe"]);
    expect(out.find((o) => o.value === "reklam")?.label).toBe("Reklam (portal dahil)");
    expect(out.find((o) => o.value === "diger")?.label).toBe("Diğer (SGK/vergi dahil)");
    // Tanımlardaki ek anahtarlar (eğitim, komisyon gideri) ve maaş (yetkiliyse) kalır.
    expect(values).toEqual(expect.arrayContaining(["maas", "ulasim", "egitim", "komisyon_gider"]));
  });

  it("maaş yalnız yetkiliye; ofis kategorisi aynı anahtara düşerse tekrar etmez", () => {
    const custom = [
      { key: "ofis", label: "Ofis (özel)", direction: "out", archived_at: null },
      { key: "kirtasiye", label: "Kırtasiye", direction: "out", archived_at: null },
      { key: "eski", label: "Eski", direction: "out", archived_at: "2026-01-01" },
    ];
    const out = budgetCategoryOptions("out", defs, custom, false);
    const values = out.map((o) => o.value);
    expect(values).not.toContain("maas");
    expect(values.filter((v) => v === "ofis")).toHaveLength(1);
    expect(values).toContain("kirtasiye");
    expect(values).not.toContain("eski");
  });

  it("gelir yönünde eşleme yok; mülk sahibinin parası ve transfer çıkmaz", () => {
    const vals = budgetCategoryOptions("in", defs, [], true).map((o) => o.value);
    expect(vals).toContain("komisyon");
    expect(vals).not.toContain("kira_tahsilat");
    expect(vals).not.toContain("aidat_tahsilat");
  });

  it("budgetCategoryFor SQL finance_v2_budget_category ile birebir (gider sistem kategorileri)", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261014001100_finance_ledger_v2_rpc.sql"), "utf8");
    const body = sql.slice(sql.indexOf("function public.finance_v2_budget_category"), sql.indexOf("$$;", sql.indexOf("function public.finance_v2_budget_category")));
    const sqlMap = (cat: string): string => {
      for (const m of body.matchAll(/when p_category in \(([^)]*)\) then '([a-z_]+)'/g)) {
        const members = m[1].split(",").map((x) => x.trim().replace(/'/g, ""));
        if (members.includes(cat)) return m[2];
      }
      return cat;
    };
    for (const c of CASH_CATEGORIES.filter((x) => x.direction === "out")) expect(budgetCategoryFor(c.value, "out")).toBe(sqlMap(c.value));
    expect(budgetCategoryFor("kira", "in")).toBe("kira");
  });
});
