import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLANS, planAmountTry } from "@/lib/billing/plans";
import { PLAN_GATES } from "@/lib/billing/page-gates";
import { buildComparison, buildFaq, yearlyDiscountPercent } from "@/lib/pricing-page-model";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const PAGE_FILES = [
  "src/app/fiyatlar/page.tsx",
  "src/lib/pricing-page-model.ts",
  "src/lib/roi-calculator.ts",
  ...readdirSync(join(root, "src/components/pricing-page")).map((f) => `src/components/pricing-page/${f}`),
];

describe("/fiyatlar sözleşmesi: tek kaynak plans.ts + page-gates.ts", () => {
  it("sayfa ve bileşenlerde sabit TL tutarı yok", () => {
    for (const f of PAGE_FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/\d[\d.]*\s*(₺|TL\b)/);
      for (const p of PLANS) expect(src, `${f}: ${p.monthlyTry}`).not.toMatch(new RegExp(`\\b${p.monthlyTry.toLocaleString("tr-TR").replace(".", "\\.")}\\b|\\b${p.monthlyTry}\\b`));
    }
  });

  it("sayfa plans.ts'ten okur ve mevcut Pricing bileşenini yeniden kullanır", () => {
    const page = read("src/app/fiyatlar/page.tsx");
    expect(page).toContain('from "@/components/pricing"');
    expect(page).toContain('from "@/lib/billing/plans"');
    expect(read("src/lib/pricing-page-model.ts")).toContain('from "@/lib/billing/page-gates"');
  });

  it("karşılaştırma tablosu her plan ve her sayfa kilidi için üretilir", () => {
    const groups = buildComparison();
    const labels = groups.flatMap((g) => g.rows.map((r) => r.label));
    for (const gate of PLAN_GATES) expect(labels).toContain(gate.title);
    for (const row of groups.flatMap((g) => g.rows)) expect(row.cells).toHaveLength(PLANS.length);
    const monthly = groups[0]!.rows[0]!.cells.map((c) => c.text);
    PLANS.forEach((p, i) => expect(monthly[i]).toContain(p.monthlyTry.toLocaleString("tr-TR")));
  });

  it("kayıp-kaçak yalnız Profesyonel ve üzeri, yıllık indirim plans.ts ile tutarlı", () => {
    const row = buildComparison().flatMap((g) => g.rows).find((r) => r.label === "Kayıp-kaçak komisyon motoru")!;
    expect(row.cells.map((c) => c.included)).toEqual([false, false, true, true]);
    const p = PLANS[0]!;
    expect(Math.round(p.monthlyTry * 12 * (1 - yearlyDiscountPercent() / 100))).toBe(planAmountTry(p.id, "yearly"));
  });

  it("SSS doğrulanmış iddiaları içerir; e-imza değil, KDV hariç", () => {
    const text = buildFaq().map((f) => f.a).join(" ");
    expect(text).toContain("nitelikli elektronik imza");
    expect(text).toContain("KDV hariçtir");
    expect(text).toContain("Profesyonel");
  });

  it("14 gün deneme ve kartsız kayıt iddiası kayıt akışında doğrulanır", () => {
    expect(read("supabase/migrations/20260731000140_atomic_registration_provisioning.sql")).toContain("interval '14 days'");
    const kayit = read("src/app/kayit/register-form.tsx");
    expect(kayit).toContain("Kredi kartı gerekmez");
    expect(kayit).toContain("14 gün ücretsiz");
    expect(read("src/components/pricing.tsx")).toContain("KDV hariç");
  });

  it("FAQ JSON-LD yalnız görünen SSS'den üretilir", () => {
    const page = read("src/app/fiyatlar/page.tsx");
    expect(page).toContain("faq.map");
    expect(page.match(/const faq = buildFaq\(\)/g)).toHaveLength(1);
  });

  it("hesaplayıcı commission.ts'i yeniden kullanır ve sektör verisi yoktur", () => {
    const src = read("src/lib/roi-calculator.ts");
    expect(src).toContain('from "@/lib/commission"');
    expect(src).not.toMatch(/sektör ortalaması\s*[:=]/i);
  });
});
