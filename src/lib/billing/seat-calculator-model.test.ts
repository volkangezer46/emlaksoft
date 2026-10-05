import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RECOMMENDED_CATALOG_OVERRIDES, applyPlanOverrides } from "@/lib/billing/plan-overrides";
import { visiblePlans, type PlanDef } from "@/lib/billing/plans";
import {
  applyOffers,
  clampSeats,
  computeSeatCalc,
  extraSeatSummary,
  registrationQuote,
  registrationSelection,
  seatBounds,
  seatCalcAnnouncement,
} from "@/lib/billing/seat-calculator-model";
import { findCrossoverSeat, quoteSeats, recommendPlanForSeats } from "@/lib/billing/seat-pricing";
import { registrationPlanForTeamSize } from "@/lib/billing/registration-plan";

const catalog: PlanDef[] = visiblePlans(applyPlanOverrides(RECOMMENDED_CATALOG_OVERRIDES));
const sellable = catalog.filter((p) => !p.hidden);
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("computeSeatCalc: tek kaynak motor", () => {
  it("öneri ve tutar recommendPlanForSeats/quoteSeats ile birebir aynıdır", () => {
    for (const s of [1, 3, 5, 12, 18, 25, 40]) {
      const calc = computeSeatCalc(catalog, undefined, s, "monthly");
      const rec = recommendPlanForSeats(catalog, s, "monthly");
      expect(calc.planId).toBe(rec.planId);
      expect(calc.cycleTotalTry).toBe(rec.quote.totalForCycleTry);
      expect(calc.quote.totalMonthlyTry).toBe(quoteSeats(catalog, rec.planId, s, "monthly").totalMonthlyTry);
    }
  });

  it("yıllık: dönem tutarı yıllık, aylık eşdeğer ve tasarruf tutarlı", () => {
    const m = computeSeatCalc(catalog, undefined, 8, "monthly");
    const y = computeSeatCalc(catalog, undefined, 8, "yearly");
    expect(y.planId).toBe(m.planId);
    expect(y.cycleTotalTry).toBeLessThan(m.quote.totalMonthlyTry * 12);
    expect(y.yearlySavingTry).toBe(m.quote.totalMonthlyTry * 12 - y.cycleTotalTry);
    expect(y.yearlySavingTry).toBeGreaterThan(0);
    expect(y.yearlyLabel).toMatch(/öde 12 kullan/);
    expect(y.monthlyEquivalentTry).toBe(Math.round(y.cycleTotalTry / 12));
  });

  it("kırılım toplamı aylık toplamı verir", () => {
    const c = computeSeatCalc(catalog, undefined, 9, "monthly");
    const sum = c.breakdown.base.amountTry + c.breakdown.rows.reduce((a, r) => a + r.subtotalTry, 0);
    expect(sum).toBe(c.quote.totalMonthlyTry);
  });

  it("alternatifler artan fiyatlıdır ve önerilen paketi içermez", () => {
    const c = computeSeatCalc(catalog, undefined, 10, "monthly");
    expect(c.alternatives.every((a) => a.planId !== c.planId)).toBe(true);
    const prices = c.alternatives.map((a) => a.totalMonthlyTry);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    expect(c.alternatives.every((a) => a.diffMonthlyTry >= 0)).toBe(true);
  });

  it("çapraz nokta notu motorun findCrossoverSeat değerini yazar", () => {
    const lo = sellable[0]!;
    const hi = sellable[1]!;
    const cross = findCrossoverSeat(catalog, lo.id, hi.id);
    expect(cross).not.toBeNull();
    const seats = Math.max(1, cross! - 2);
    const c = computeSeatCalc(catalog, undefined, seats, "monthly");
    if (c.planId === lo.id) expect(c.crossoverNote).toContain(String(cross));
  });

  it("en yüksek kullanıcı sayısında (500) Kurumsal fiyatı hesaplanır, teklif istenmez", () => {
    const b = seatBounds(catalog);
    expect(b.inputMax).toBe(500);
    const c = computeSeatCalc(catalog, undefined, b.inputMax, "monthly");
    expect(c.status).toBe("ok");
    expect(c.planId).toBe("enterprise");
    expect(c.monthlyEquivalentTry).toBe(92450);
    expect(seatCalcAnnouncement(c)).not.toContain("bize ulaşın");
  });

  it("sınırın üstü satılmaz: over_max, tutar yok, iletişim yönlendirmesi yok", () => {
    const c = computeSeatCalc(catalog, undefined, 501, "monthly");
    expect(c.status).toBe("over_max");
    expect(c.limitNote).toContain("en fazla 500");
    expect(c.alternatives).toEqual([]);
    expect(seatCalcAnnouncement(c)).not.toContain("ulaşın");
  });

  it("geçersiz koltuk sayısı 1'e sıkıştırılır", () => {
    expect(computeSeatCalc(catalog, undefined, Number.NaN, "monthly").seats).toBe(1);
    expect(computeSeatCalc(catalog, undefined, -4, "monthly").seats).toBe(1);
  });
});

describe("kampanya (Founders) etkin fiyatı", () => {
  const first = sellable[0]!;
  const offers = Object.fromEntries(
    catalog.map((p) => [p.id, { monthlyTry: p.id === first.id ? Math.round(p.monthlyTry * 0.8) : p.monthlyTry, listMonthlyTry: p.monthlyTry, campaign: p.id === first.id }]),
  );

  it("etkin fiyat motora taban olarak verilir; liste fiyatı üstü çizili için ayrıca döner", () => {
    const eff = applyOffers(catalog, offers);
    expect(eff.find((p) => p.id === first.id)!.monthlyTry).toBe(offers[first.id]!.monthlyTry);
    const c = computeSeatCalc(catalog, offers, 1, "monthly");
    expect(c.planId).toBe(first.id);
    expect(c.campaign).toBe(true);
    expect(c.monthlyEquivalentTry).toBeLessThan(c.listMonthlyEquivalentTry!);
  });

  it("kampanya yoksa liste fiyatı alanı null", () => {
    expect(computeSeatCalc(catalog, undefined, 1, "monthly").listMonthlyEquivalentTry).toBeNull();
  });
});

describe("seatBounds / clampSeats", () => {
  it("kaydırıcı ve giriş sonu herkese açık en büyük kapasitedir (500)", () => {
    const b = seatBounds(catalog);
    expect(b.min).toBe(1);
    expect(b.sliderMax).toBe(500);
    expect(computeSeatCalc(catalog, undefined, b.sliderMax, "monthly").status).toBe("ok");
  });

  it("sıkıştırma sınırları", () => {
    const b = seatBounds(catalog);
    expect(clampSeats(0, b)).toBe(1);
    expect(clampSeats(5000, b)).toBe(b.inputMax);
    expect(clampSeats(7.9, b)).toBe(7);
  });
});

describe("extraSeatSummary: plan kartı metni admin kademelerinden üretilir", () => {
  it("kademeli plan: dahil kullanıcı, ilk/sonraki/sonrası satırları", () => {
    const withTiers = sellable.find((p) => (p.extraSeatTiers?.length ?? 0) >= 2);
    expect(withTiers).toBeDefined();
    const s = extraSeatSummary(withTiers!)!;
    expect(s.included).toBe(`${withTiers!.limits.seats} kullanıcı dahil`);
    expect(s.tiers[0]).toMatch(/^ilk \d+ ek kullanıcı /);
    for (const t of withTiers!.extraSeatTiers!) expect(s.tiers.join(" ")).toContain(t.monthlyTry.toLocaleString("tr-TR"));
  });

  it("tek kademeli ve kademesiz", () => {
    const base = sellable[0]!;
    const single = extraSeatSummary({ ...base, extraSeatTiers: null, extraSeatMonthlyTry: 111 })!;
    expect(single.tiers).toEqual([`her ek kullanıcı ${(111).toLocaleString("tr-TR")} ₺`]);
    expect(extraSeatSummary({ ...base, extraSeatTiers: null, extraSeatMonthlyTry: null })).toBeNull();
  });

  it("azami kullanıcı varsa belirtilir", () => {
    const base = sellable.find((p) => (p.extraSeatTiers?.length ?? 0) > 0)!;
    const s = extraSeatSummary({ ...base, maxSeats: base.limits.seats + 7 })!;
    expect(s.max).toBe(`En fazla ${base.limits.seats + 7} kullanıcı`);
  });
});

describe("kayıt: ekip büyüklüğü motorun önerisiyle tutarlı", () => {
  it("seçilen plan öneriyle aynı; sunucu kovası planı değiştirmez", () => {
    for (const s of [1, 2, 5, 8, 15, 20, 30, 45, 60, 120]) {
      const sel = registrationSelection(catalog, undefined, s, "monthly");
      expect(sel.planId).toBe(computeSeatCalc(catalog, undefined, s, "monthly").planId);
      // Sunucu eylemi (registrationPlanForTeamSize) kovanın minimumuyla karşılaştırır: plan değişmemeli.
      expect(registrationPlanForTeamSize(sel.planId, sel.teamSize)).toBe(sel.planId);
    }
  });

  it("fiyat sayfasından gelen bilinçli üst plan, sayı değişmedikçe korunur", () => {
    const top = sellable[sellable.length - 1]!;
    const sel = registrationSelection(catalog, undefined, 1, "monthly", top.id);
    expect(sel.planId).toBe(top.id);
    expect(registrationSelection(catalog, undefined, 1, "monthly").planId).not.toBe(top.id);
  });

  it("özet tutarı motordan gelir", () => {
    const sel = registrationSelection(catalog, undefined, 12, "yearly");
    const q = registrationQuote(catalog, undefined, sel.planId, 12, "yearly")!;
    expect(q.totalForCycleTry).toBe(sel.calc.cycleTotalTry);
    expect(registrationQuote(catalog, undefined, "yok", 3, "monthly")).toBeNull();
  });
});

describe("sözleşme: istemci dosyaları sunucu modülü import etmez, JSON-LD yalnız taban fiyat yazar", () => {
  const FILES = [
    "src/components/pricing-page/seat-calculator.tsx",
    "src/components/pricing-page/seat-calculator-lazy.tsx",
    "src/components/pricing-page/roi-calculator.tsx",
    "src/components/pricing.tsx",
    "src/lib/billing/seat-calculator-model.ts",
  ];

  it("sunucu modülü import edilmez; use client ilk satırda", () => {
    for (const f of FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/from "@\/lib\/billing\/(public-pricing|plan-definitions|plan-support)"/);
      expect(src, f).not.toMatch(/from "@\/lib\/platform-settings"|server-only|next\/headers/);
      expect(src, f).not.toMatch(/Date\.now\(\)|new Date\(/);
      expect(src, f).not.toMatch(/text-\[\d+px\]/);
      if (f.endsWith(".tsx")) expect(src.startsWith('"use client";'), f).toBe(true);
    }
  });

  it("hesaplayıcı ana sayfa ve /fiyatlar'da yalnız lazy sarmalayıcıyla bağlanır", () => {
    for (const f of ["src/app/fiyatlar/page.tsx", "src/components/marketing/pricing-section.tsx"]) {
      const src = read(f);
      expect(src).toContain("seat-calculator-lazy");
      expect(src).not.toMatch(/from "@\/components\/pricing-page\/seat-calculator"/);
    }
    expect(read("src/components/pricing-page/seat-calculator-lazy.tsx")).toContain("ssr: false");
  });

  it("plan kartı (eager paket) fiyat motorunu değer olarak import etmez; kademe metni sunucudan props gelir", () => {
    const src = read("src/components/pricing.tsx");
    expect(src).not.toMatch(/import \{[^}]*\} from "@\/lib\/billing\/seat-(pricing|calculator-model)"/);
    expect(src).toContain("extraSeats");
    expect(read("src/app/fiyatlar/page.tsx")).toContain("extraSeatTexts(plans)");
    expect(read("src/components/marketing/pricing-section.tsx")).toContain("extraSeatTexts(plans)");
  });

  it("SEO JSON-LD Offer'ı yalnız taban plan fiyatından üretilir (ek kullanıcı yok)", () => {
    const src = read("src/components/seo/seo-json-ld.tsx");
    expect(src).toContain("monthlyTry: p.monthlyTry");
    expect(src).not.toMatch(/extraSeat|seat-pricing|seat-calculator/);
  });
});
