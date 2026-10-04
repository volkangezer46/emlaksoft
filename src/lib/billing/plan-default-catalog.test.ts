import { describe, expect, it } from "vitest";
import {
  RECOMMENDED_CATALOG_OVERRIDES,
  applyPlanOverrides,
  resolveCatalogSettings,
  serializePlanCatalogSettings,
} from "@/lib/billing/plan-overrides";
import { visiblePlans } from "@/lib/billing/plans";
import { buildComparison, buildFaq, trialPhrase, yearlyDiscountPercent } from "@/lib/pricing-page-model";
import { yearlyOffer } from "@/lib/marketing-copy";

describe("varsayılan katalog: panel kaydı yoksa önerilen katalog", () => {
  it("ham kayıt yoksa/boşsa önerilen katalog geçerlidir", () => {
    for (const raw of [null, undefined, "", "   "]) {
      expect(resolveCatalogSettings(raw).overrides).toEqual(RECOMMENDED_CATALOG_OVERRIDES);
    }
    const defs = applyPlanOverrides(resolveCatalogSettings(null).overrides);
    const byId = Object.fromEntries(defs.map((p) => [p.id, p]));
    expect(byId.advisor!.monthlyTry).toBe(749);
    expect(byId.office!.extraSeatMonthlyTry).toBe(399);
    expect(byId.professional!.monthlyTry).toBe(4990);
    expect(byId.professional!.limits.seats).toBe(15);
    expect(byId.business!.hidden).toBe(true);
    expect(byId.enterprise!.customPricing).toBe(true);
    // gizli Business public listede yok; ücretsiz paket yok
    const publicIds = visiblePlans(defs).map((p) => p.id);
    expect(publicIds).toEqual(["advisor", "office", "professional", "enterprise"]);
    expect(defs.every((p) => p.monthlyTry > 0)).toBe(true);
  });

  it("admin bir kayıt yazdıysa (boş plans dahil) yalnız o kayıt geçerlidir", () => {
    const saved = serializePlanCatalogSettings({ overrides: { advisor: { monthlyTry: 1111 } }, campaign: resolveCatalogSettings(null).campaign });
    const s = resolveCatalogSettings(saved);
    expect(s.overrides).toEqual({ advisor: { monthlyTry: 1111 } });
    const emptied = resolveCatalogSettings(serializePlanCatalogSettings({ overrides: {}, campaign: s.campaign }));
    expect(emptied.overrides).toEqual({});
  });
});

describe("fiyat sayfası modeli admin tanımlarını izler", () => {
  const defs = visiblePlans(applyPlanOverrides(resolveCatalogSettings(null).overrides));

  it("özel fiyatlı paket tabloda tutar yerine 'Özel teklif' gösterir; isteğe bağlı satırlar yalnız doluysa çıkar", () => {
    const rows = buildComparison(defs)[0]!.rows;
    const monthly = rows.find((r) => r.label.startsWith("Aylık fiyat"))!;
    expect(monthly.cells.at(-1)!.text).toBe("Özel teklif");
    expect(rows.some((r) => r.label.startsWith("Ek kullanıcı"))).toBe(true);
    expect(rows.some((r) => r.label.startsWith("Aylık AI kredisi"))).toBe(false);
    const withAi = buildComparison(defs.map((p) => ({ ...p, aiCreditsMonthly: 500 })))[0]!.rows;
    expect(withAi.some((r) => r.label === "Aylık AI kredisi")).toBe(true);
  });

  it("yıllık indirim ve deneme günü panel değerinden gelir", () => {
    expect(yearlyDiscountPercent(defs)).toBe(17);
    expect(yearlyDiscountPercent(defs.map((p) => ({ ...p, yearlyPaidMonths: 9 })))).toBe(25);
    expect(yearlyOffer(defs)).toEqual({ label: "10 öde 12 kullan", gift: 2 });
    expect(yearlyOffer(defs.map((p, i) => ({ ...p, yearlyPaidMonths: i === 0 ? 9 : 10 })))).toBeNull();
    expect(trialPhrase(30)).toBe("30 gün ücretsiz deneme");
    expect(trialPhrase()).toBe("Ücretsiz deneme");
    expect(buildFaq({ trialDays: 30, plans: defs })[0]!.a).toContain("30 gün");
    expect(buildFaq({ plans: defs })[0]!.a).not.toMatch(/\d+ gün/);
  });
});
