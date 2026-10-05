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
  it("kodda mekanizması olmayan insan hizmeti vaatleri varsayılan özellik listelerinde yok", () => {
    const defs = applyPlanOverrides(resolveCatalogSettings(null).overrides);
    const all = defs.flatMap((p) => p.features).join(" | ");
    expect(all).not.toMatch(/öncelikli destek|özel onboarding|destek sla/i);
  });

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
    expect(byId.enterprise!.monthlyTry).toBe(12900);
    expect(byId.enterprise!.maxSeats).toBe(500);
    expect(Object.keys(byId.enterprise!)).not.toContain("customPricing");
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

  it("Kurumsal dahil her paket tabloda liste fiyatını gösterir (Özel teklif yok); isteğe bağlı satırlar yalnız doluysa çıkar", () => {
    const rows = buildComparison(defs)[0]!.rows;
    const monthly = rows.find((r) => r.label.startsWith("Aylık fiyat"))!;
    expect(monthly.cells.at(-1)!.text).toBe("12.900 ₺");
    expect(rows.flatMap((r) => r.cells.map((c) => c.text))).not.toContain("Özel teklif");
    expect(rows.find((r) => r.label.startsWith("En fazla kullanıcı"))!.cells.at(-1)!.text).toBe("500");
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

describe("plans.ts ham varsayılanı onaylı katalogla aynı (tek kaynak kayması olmaz)", () => {
  const raw = applyPlanOverrides({});
  const recommended = applyPlanOverrides(RECOMMENDED_CATALOG_OVERRIDES);

  const pick = (p: (typeof raw)[number]) => ({
    monthlyTry: p.monthlyTry,
    extraSeatMonthlyTry: p.extraSeatMonthlyTry ?? null,
    extraSeatTiers: p.extraSeatTiers ?? null,
    maxSeats: p.maxSeats ?? null,
    seatRounding: p.seatRounding ?? null,
    limits: p.limits,
    hidden: Boolean(p.hidden),
    yearlyPaidMonths: p.yearlyPaidMonths ?? 10,
    efCreditsMonthly: p.efCreditsMonthly ?? null,
    efCreditsPerExtraSeat: p.efCreditsPerExtraSeat ?? null,
  });

  it("fiyat, ek kullanıcı kademesi, sınır ve görünürlük alanları RECOMMENDED_CATALOG_OVERRIDES ile eşit", () => {
    expect(raw.map((p) => p.id)).toEqual(recommended.map((p) => p.id));
    for (const r of recommended) {
      expect(pick(raw.find((p) => p.id === r.id)!), `plan ${r.id}`).toEqual(pick(r));
    }
  });

  it("önerilen aylık kontör hakkı: Danışman 10, Ofis 40, Profesyonel 120, Business 300, Kurumsal 400 (+ ek kullanıcı başına 6)", () => {
    const got = Object.fromEntries(raw.map((p) => [p.id, p.efCreditsMonthly ?? null]));
    expect(got).toEqual({ advisor: 10, office: 40, professional: 120, business: 300, enterprise: 400 });
    expect(raw.find((p) => p.id === "enterprise")!.efCreditsPerExtraSeat).toBe(6);
  });

  it("ham katalogda eski fiyatlar yok ve ücretsiz paket yok", () => {
    const prices = Object.fromEntries(raw.map((p) => [p.id, p.monthlyTry]));
    expect(prices).toMatchObject({ advisor: 749, office: 2490, professional: 4990, business: 8990 });
    expect(Object.values(prices).every((v) => v > 0)).toBe(true);
    expect(raw.find((p) => p.id === "professional")!.limits.seats).toBe(15);
  });

  it("ham varsayılan özellik listelerinde mekanizmasız destek vaadi yok", () => {
    const text = raw.flatMap((p) => p.features).join(" | ");
    expect(text).not.toMatch(/Öncelikli destek|Özel onboarding|destek SLA/i);
  });
});
