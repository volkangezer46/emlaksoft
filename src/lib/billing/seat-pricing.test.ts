import { describe, expect, it } from "vitest";
import { RECOMMENDED_CATALOG_OVERRIDES, applyPlanOverrides } from "@/lib/billing/plan-overrides";
import type { PlanDef } from "@/lib/billing/plans";
import {
  findCrossoverSeat,
  findSeatCrossovers,
  prorateSeatChange,
  quoteSeats,
  recommendPlanForSeats,
  resolveSeatTiers,
  roundSeatPrice,
  seatUtilization,
  suggestSeatTiers,
  trBillingMonthPeriod,
  validateSeatCatalog,
  validateSeatTiers,
} from "@/lib/billing/seat-pricing";

// Onaylı katalog (2026-10-08): Danışman 749 (ek 559), Ofis 2790 (ek 499/449/399), Profesyonel 5490 (15 kullanıcı, ek 449/399), Business gizli, Kurumsal 14.900 (50 dahil, ek 289/249/199, en fazla 500).
const catalog = applyPlanOverrides(RECOMMENDED_CATALOG_OVERRIDES);
const office = catalog.find((p) => p.id === "office")!;
const pro = catalog.find((p) => p.id === "professional")!;

function withPlan(id: string, patch: Partial<PlanDef>): PlanDef[] {
  return catalog.map((p) => (p.id === id ? { ...p, ...patch } : p));
}

describe("quoteSeats: kademeli marjinal fiyat", () => {
  it("dahil kullanıcı içinde yalnız taban fiyat", () => {
    const q = quoteSeats(catalog, "office", 5, "monthly");
    expect(q.extraSeats).toBe(0);
    expect(q.totalMonthlyTry).toBe(2790);
    expect(q.breakdown).toEqual([]);
    expect(q.maxSeatsExceeded).toBe(false);
  });

  it("kademeleri marjinal uygular (5x499 + 3x449)", () => {
    const q = quoteSeats(catalog, "office", 13, "monthly");
    expect(q.extraSeats).toBe(8);
    expect(q.breakdown).toEqual([
      { fromSeat: 1, toSeat: 5, count: 5, unitTry: 499, subtotalTry: 2495 },
      { fromSeat: 6, toSeat: 8, count: 3, unitTry: 449, subtotalTry: 1347 },
    ]);
    expect(q.extraMonthlyTry).toBe(3842);
    expect(q.totalMonthlyTry).toBe(2790 + 3842);
  });

  it("toplam fiyat koltukla monoton artar, ani düşüş yok", () => {
    for (const plan of [office, pro]) {
      let prev = 0;
      for (let s = 1; s <= 60; s++) {
        const q = quoteSeats(catalog, plan.id, s, "monthly");
        expect(q.totalMonthlyTry).toBeGreaterThanOrEqual(prev);
        prev = q.totalMonthlyTry;
      }
    }
  });

  it("adım artışı hiçbir koltukta bir önceki kademenin biriminden büyük olmaz", () => {
    let prev = quoteSeats(catalog, "office", 5, "monthly").totalMonthlyTry;
    let prevStep = Number.POSITIVE_INFINITY;
    for (let s = 6; s <= 20; s++) {
      const t = quoteSeats(catalog, "office", s, "monthly").totalMonthlyTry;
      expect(t - prev).toBeLessThanOrEqual(prevStep);
      prevStep = t - prev;
      prev = t;
    }
  });

  it("tek kademeli extraSeatMonthlyTry (kademe yok) geriye uyumlu", () => {
    const plans = withPlan("office", { extraSeatTiers: null, extraSeatMonthlyTry: 400 });
    const q = quoteSeats(plans, "office", 8, "monthly");
    expect(q.totalMonthlyTry).toBe(2790 + 3 * 400);
    expect(resolveSeatTiers(plans.find((p) => p.id === "office")!)).toEqual([{ fromSeat: 1, toSeat: null, monthlyTry: 400 }]);
  });

  it("Danışman'da da ek kullanıcı satılır (559 TL); 5 kullanıcıda Ofis önerilir", () => {
    const q2 = quoteSeats(catalog, "advisor", 2, "monthly");
    expect(q2.maxSeatsExceeded).toBe(false);
    expect(q2.extraMonthlyTry).toBe(559);
    expect(q2.recommendation).toBeNull();
    const q5 = quoteSeats(catalog, "advisor", 5, "monthly");
    expect(q5.totalMonthlyTry).toBe(749 + 4 * 559);
    expect(q5.recommendation?.planId).toBe("office");
  });

  it("azami koltuk aşımı işaretlenir ve zorunlu yükseltme önerilir", () => {
    // Paket kullanıcı tavanı (2026-10-10): Danışman 3 · Ofis 15 · Profesyonel 50 · Kurumsal 500.
    expect(quoteSeats(catalog, "office", 15, "monthly").maxSeatsExceeded).toBe(false);
    const q = quoteSeats(catalog, "office", 16, "monthly");
    expect(q.maxSeatsExceeded).toBe(true);
    expect(quoteSeats(catalog, "enterprise", 500, "monthly").maxSeatsExceeded).toBe(false);
    const top = quoteSeats(catalog, "enterprise", 501, "monthly");
    expect(top.maxSeatsExceeded).toBe(true);
    expect(top.recommendation).toBeNull();
  });

  it("kapalı son kademe: ötesi son birim fiyatla uzatılır ama aşım işaretlenir", () => {
    const plans = withPlan("office", {
      extraSeatTiers: [{ fromSeat: 1, toSeat: 3, monthlyTry: 399 }],
      maxSeats: null,
    });
    const q = quoteSeats(plans, "office", 12, "monthly");
    expect(q.maxSeatsExceeded).toBe(true);
    expect(q.extraMonthlyTry).toBe(7 * 399);
  });

  it("bilinmeyen paket hata verir", () => {
    expect(() => quoteSeats(catalog, "yok", 3, "monthly")).toThrow();
  });
});

describe("yıllık", () => {
  it("aylık x ödenen ay (10); ek kullanıcı da aynı", () => {
    const q = quoteSeats(catalog, "office", 8, "yearly");
    expect(q.totalMonthlyTry).toBe(2790 + 3 * 499);
    expect(q.totalForCycleTry).toBe(q.totalMonthlyTry * 10);
    expect(q.cycle).toBe("yearly");
  });

  it("plan başına yıllık ödenen ay panelden gelir", () => {
    const plans = withPlan("office", { yearlyPaidMonths: 9 });
    expect(quoteSeats(plans, "office", 5, "yearly").totalForCycleTry).toBe(2790 * 9);
  });
});

describe("çapraz nokta ve öneri", () => {
  it("Ofis -> Profesyonel çapraz noktası katalogda 11 kullanıcıdır", () => {
    expect(findCrossoverSeat(catalog, "office", "professional")).toBe(11);
    const q10 = quoteSeats(catalog, "office", 10, "monthly");
    const q11 = quoteSeats(catalog, "office", 11, "monthly");
    expect(q10.totalMonthlyTry).toBe(5285);
    expect(q10.recommendation).toBeNull();
    expect(q11.totalMonthlyTry).toBe(5734);
    expect(q11.recommendation).toMatchObject({ planId: "professional", totalMonthlyTry: 5490, savingsMonthlyTry: 244 });
    expect(q11.recommendation?.reason).toContain("tasarruf");
  });

  it("alt plana düşürme önerilmez (özellik kaybı)", () => {
    const q = quoteSeats(catalog, "professional", 5, "monthly");
    expect(q.recommendation).toBeNull();
  });

  it("recommendPlanForSeats en ucuz uygun planı ve alternatifleri verir", () => {
    const r = recommendPlanForSeats(catalog, 1, "monthly");
    expect(r.planId).toBe("advisor");
    expect(r.alternatives.map((a) => a.planId)).toEqual(["office", "professional", "enterprise"]);
    const r15 = recommendPlanForSeats(catalog, 15, "monthly");
    expect(r15.planId).toBe("professional");
    expect(r15.quote.totalMonthlyTry).toBe(5490);
    expect(r15.alternatives.every((a) => a.totalMonthlyTry >= r15.quote.totalMonthlyTry)).toBe(true);
  });

  it("gizli paket (Business) öneride yer almaz; 41+ kullanıcıda Kurumsal satılır, 500'ü aşınca satış yok", () => {
    const r = recommendPlanForSeats(catalog, 41, "monthly");
    expect(r.planId).toBe("enterprise");
    expect(r.quote.maxSeatsExceeded).toBe(false);
    expect(r.quote.totalMonthlyTry).toBe(14900);
    const over = recommendPlanForSeats(catalog, 501, "monthly");
    expect(over.planId).toBe("enterprise");
    expect(over.quote.maxSeatsExceeded).toBe(true);
    expect(over.alternatives).toEqual([]);
    const mid = recommendPlanForSeats(catalog, 30, "monthly");
    expect(mid.planId).toBe("professional");
  });

  it("öneri yıllıkta da aynı planı bulur ve dönem tutarını verir", () => {
    const r = recommendPlanForSeats(catalog, 12, "yearly");
    expect(r.planId).toBe("professional");
    expect(r.quote.totalForCycleTry).toBe(5490 * 10);
  });

  it("findSeatCrossovers ardışık planları listeler", () => {
    const list = findSeatCrossovers(catalog);
    expect(list.map((c) => `${c.fromPlanId}>${c.toPlanId}`)).toEqual(["advisor>office", "office>professional", "professional>enterprise"]);
    // Danışman tavanı 3: 4. kullanıcıda Ofis'e geçiş zorunlu olur.
    expect(list[0]!.seat).toBe(4);
  });
});

describe("kilitli fiyat (price_lock)", () => {
  it("kilitli taban fiyat liste değişse de korunur", () => {
    const raised = withPlan("office", { monthlyTry: 3000 });
    const q = quoteSeats(raised, "office", 7, "monthly", { lockedBaseMonthlyTry: 2790 });
    expect(q.baseMonthlyTry).toBe(2790);
    expect(q.totalMonthlyTry).toBe(2790 + 2 * 499);
  });

  it("kilitli kademeler yeni listeyi ezer", () => {
    const raised = withPlan("office", {
      extraSeatTiers: [{ fromSeat: 1, toSeat: null, monthlyTry: 599 }],
    });
    const locked = [{ fromSeat: 1, toSeat: null, monthlyTry: 399 }];
    const q = quoteSeats(raised, "office", 7, "monthly", { lockedTiers: locked });
    expect(q.extraMonthlyTry).toBe(2 * 399);
    const fresh = quoteSeats(raised, "office", 7, "monthly");
    expect(fresh.extraMonthlyTry).toBe(2 * 599);
  });

  it("kampanya fiyatı taban olarak parametre geçirilir", () => {
    const q = quoteSeats(catalog, "office", 5, "yearly", { lockedBaseMonthlyTry: 1990 });
    expect(q.totalForCycleTry).toBe(19900);
  });
});

describe("prorateSeatChange", () => {
  const from = quoteSeats(catalog, "office", 5, "monthly");
  const to = quoteSeats(catalog, "office", 8, "monthly");
  const start = Date.UTC(2026, 9, 1);
  const end = Date.UTC(2026, 10, 1);

  it("artış: kalan gün oranında anlık fatura", () => {
    const now = start + (end - start) / 2; // yarı dönem
    const r = prorateSeatChange({ fromQuote: from, toQuote: to, periodStartMs: start, periodEndMs: end, nowMs: now });
    expect(r.effectiveAtPeriodEnd).toBe(false);
    expect(r.immediateChargeTry).toBe(Math.round(((3 * 499) / 2) * 100) / 100);
    expect(r.note).toContain("hemen");
  });

  it("dönem başında tam fark, sonunda sıfır", () => {
    const a = prorateSeatChange({ fromQuote: from, toQuote: to, periodStartMs: start, periodEndMs: end, nowMs: start });
    expect(a.immediateChargeTry).toBe(1497);
    const b = prorateSeatChange({ fromQuote: from, toQuote: to, periodStartMs: start, periodEndMs: end, nowMs: end });
    expect(b.immediateChargeTry).toBe(0);
    const c = prorateSeatChange({ fromQuote: from, toQuote: to, periodStartMs: start, periodEndMs: end, nowMs: end + 5 * 86_400_000 });
    expect(c.immediateChargeTry).toBe(0);
  });

  it("azaltma dönem sonunda geçerli, iade/kredi yok", () => {
    const r = prorateSeatChange({ fromQuote: to, toQuote: from, periodStartMs: start, periodEndMs: end, nowMs: start + 86_400_000 });
    expect(r).toMatchObject({ immediateChargeTry: 0, effectiveAtPeriodEnd: true });
    expect(r.note).toContain("İade ve kredi yoktur");
  });

  it("değişim yoksa 0", () => {
    const r = prorateSeatChange({ fromQuote: from, toQuote: from, periodStartMs: start, periodEndMs: end, nowMs: start });
    expect(r.immediateChargeTry).toBe(0);
    expect(r.effectiveAtPeriodEnd).toBe(false);
  });

  it("yıllık dönemde yıllık tutar farkı oranlanır", () => {
    const fy = quoteSeats(catalog, "office", 5, "yearly");
    const ty = quoteSeats(catalog, "office", 6, "yearly");
    const ys = Date.UTC(2026, 0, 1);
    const ye = Date.UTC(2027, 0, 1);
    const r = prorateSeatChange({ fromQuote: fy, toQuote: ty, periodStartMs: ys, periodEndMs: ye, nowMs: ys + (ye - ys) / 4 });
    expect(r.immediateChargeTry).toBe(Math.round(499 * 10 * 0.75 * 100) / 100);
  });

  it("TR ay sınırı UTC+3'e göre hesaplanır", () => {
    // 2026-10-31 22:30 UTC = 2026-11-01 01:30 TR -> Kasım ayı
    const p = trBillingMonthPeriod(Date.UTC(2026, 9, 31, 22, 30));
    expect(p.startMs).toBe(Date.UTC(2026, 9, 31, 21, 0));
    expect(p.endMs).toBe(Date.UTC(2026, 10, 30, 21, 0));
  });
});

describe("validateSeatTiers / validateSeatCatalog", () => {
  it("onaylı katalog geçerli ve uyarısız", () => {
    for (const p of catalog) expect(validateSeatTiers(p)).toEqual([]);
    const rep = validateSeatCatalog(catalog);
    expect(rep.errors).toEqual([]);
    expect(rep.warnings).toEqual([]);
  });

  it("boşluğu reddeder", () => {
    const def = { ...office, extraSeatTiers: [
      { fromSeat: 1, toSeat: 5, monthlyTry: 399 },
      { fromSeat: 8, toSeat: null, monthlyTry: 349 },
    ] };
    expect(validateSeatTiers(def).join(" ")).toContain("boşluk");
  });

  it("çakışmayı reddeder", () => {
    const def = { ...office, extraSeatTiers: [
      { fromSeat: 1, toSeat: 6, monthlyTry: 399 },
      { fromSeat: 6, toSeat: null, monthlyTry: 349 },
    ] };
    expect(validateSeatTiers(def).join(" ")).toContain("çakış");
  });

  it("ilk kademe 1'den başlamalı; sınırsız kademe sonda olmalı", () => {
    expect(validateSeatTiers({ ...office, extraSeatTiers: [{ fromSeat: 2, toSeat: null, monthlyTry: 399 }] }).join(" ")).toContain("1. ek kullanıcıdan");
    const def = { ...office, extraSeatTiers: [
      { fromSeat: 1, toSeat: null, monthlyTry: 399 },
      { fromSeat: 6, toSeat: null, monthlyTry: 349 },
    ] };
    expect(validateSeatTiers(def).join(" ")).toContain("sınırsız");
  });

  it("artan birim fiyatı (monotonluk ihlali) reddeder", () => {
    const def = { ...office, extraSeatTiers: [
      { fromSeat: 1, toSeat: 5, monthlyTry: 299 },
      { fromSeat: 6, toSeat: null, monthlyTry: 399 },
    ] };
    expect(validateSeatTiers(def).join(" ")).toContain("yüksek olamaz");
  });

  it("negatif/sıfır/ondalık fiyat ve ters aralığı reddeder", () => {
    expect(validateSeatTiers({ ...office, extraSeatTiers: [{ fromSeat: 1, toSeat: null, monthlyTry: 0 }] }).length).toBeGreaterThan(0);
    expect(validateSeatTiers({ ...office, extraSeatTiers: [{ fromSeat: 1, toSeat: null, monthlyTry: 399.5 }] }).length).toBeGreaterThan(0);
    expect(validateSeatTiers({ ...office, extraSeatTiers: [{ fromSeat: 5, toSeat: 2, monthlyTry: 399 }] }).length).toBeGreaterThan(0);
  });

  it("yuvarlama düzenini (x9 / x0) zorlar", () => {
    expect(validateSeatTiers({ ...office, seatRounding: "x9", extraSeatTiers: [{ fromSeat: 1, toSeat: null, monthlyTry: 400 }] }).join(" ")).toContain("x9");
    expect(validateSeatTiers({ ...office, seatRounding: "x0", extraSeatTiers: [{ fromSeat: 1, toSeat: null, monthlyTry: 399 }] }).join(" ")).toContain("onluk");
    expect(validateSeatTiers({ ...office, seatRounding: "none", extraSeatTiers: [{ fromSeat: 1, toSeat: null, monthlyTry: 400 }] })).toEqual([]);
    expect(roundSeatPrice(402, "x9")).toBe(399);
    expect(roundSeatPrice(405, "x9")).toBe(409);
    expect(roundSeatPrice(403, "x0")).toBe(400);
  });

  it("azami kullanıcı dahil kullanıcıdan küçük olamaz; son kademe ötesine geçemez", () => {
    expect(validateSeatTiers({ ...office, maxSeats: 3 }).join(" ")).toContain("küçük olamaz");
    const def = { ...office, maxSeats: 40, extraSeatTiers: [{ fromSeat: 1, toSeat: 10, monthlyTry: 399 }] };
    expect(validateSeatTiers(def).join(" ")).toContain("son kademenin ötesine");
  });

  it("katalog: üst plan taban fiyatı alttan düşük olamaz, dahil kullanıcı da geriye gidemez", () => {
    const cheapPro = withPlan("professional", { monthlyTry: 2000 });
    expect(validateSeatCatalog(cheapPro).errors.join(" ")).toContain("düşük olamaz");
    const fewSeats = withPlan("professional", { limits: { ...pro.limits, seats: 3 } });
    expect(validateSeatCatalog(fewSeats).errors.join(" ")).toContain("az olamaz");
  });

  it("katalog: çapraz nokta oluşmuyorsa kanibalizasyon uyarısı verir", () => {
    const tiny = withPlan("office", {
      extraSeatTiers: [{ fromSeat: 1, toSeat: null, monthlyTry: 9 }],
      maxSeats: null,
      seatRounding: "x9",
    });
    const rep = validateSeatCatalog(tiny);
    expect(rep.warnings.join(" ")).toContain("kanibalizasyon");
  });

  it("katalog: üst paketin ek kullanıcıyla yeniden pahalılaşması uyarılır", () => {
    // Ofis tavanı 15 olduğundan senaryo için Ofis'in tavanı yalnız bu testte açılır.
    const dear = withPlan("professional", {
      extraSeatTiers: [{ fromSeat: 1, toSeat: null, monthlyTry: 999 }],
      seatRounding: "x9",
      maxSeats: 40,
    }).map((p) => (p.id === "office" ? { ...p, maxSeats: 500 } : p));
    const rep = validateSeatCatalog(dear);
    expect(rep.warnings.join(" ")).toContain("yeniden");
  });

  it("suggestSeatTiers geçerli ve azalan kademeler üretir", () => {
    const tiers = suggestSeatTiers({ ...office, extraSeatTiers: null, extraSeatMonthlyTry: null });
    expect(validateSeatTiers({ ...office, seatRounding: "x9", extraSeatTiers: tiers })).toEqual([]);
    expect(tiers[0]!.monthlyTry).toBeGreaterThanOrEqual(tiers[1]!.monthlyTry);
    expect(tiers[tiers.length - 1]!.toSeat).toBeNull();
  });
});

describe("seatUtilization", () => {
  it("%80 uyarı ve %100 dolu eşikleri", () => {
    expect(seatUtilization(3, 5, 0).level).toBe("ok");
    expect(seatUtilization(4, 5, 0).level).toBe("warn80");
    expect(seatUtilization(5, 5, 0)).toEqual({ ratio: 1, level: "full" });
    expect(seatUtilization(6, 5, 1).level).toBe("full");
    expect(seatUtilization(8, 5, 5).level).toBe("warn80");
  });

  it("eşik admin ayarıyla değişir, boş kapasite güvenli", () => {
    expect(seatUtilization(3, 5, 0, 0.6).level).toBe("warn80");
    expect(seatUtilization(0, 0, 0)).toEqual({ ratio: 0, level: "ok" });
    expect(seatUtilization(1, 0, 0).level).toBe("full");
  });
});

describe("Kurumsal: kullanıcı başı kademeli fiyat (50 dahil, en fazla 500)", () => {
  const ent = catalog.find((p) => p.id === "enterprise")!;
  const total = (n: number) => quoteSeats(catalog, "enterprise", n, "monthly").totalMonthlyTry;

  it("dahil 50 kullanıcıda taban, sonrası 289 / 249 / 199 marjinal", () => {
    expect(ent.limits.seats).toBe(50);
    expect(total(50)).toBe(14900);
    expect(total(51)).toBe(14900 + 289);
    expect(total(100)).toBe(14900 + 50 * 289);
    expect(total(101)).toBe(14900 + 50 * 289 + 249);
    expect(total(250)).toBe(14900 + 50 * 289 + 150 * 249);
    expect(total(500)).toBe(14900 + 50 * 289 + 150 * 249 + 250 * 199);
  });

  it("toplam monoton artar, kullanıcı başı ortalama düşer (hacim indirimi) ve kademeler x9", () => {
    let prev = 0;
    let prevAvg = Number.POSITIVE_INFINITY;
    for (const n of [50, 51, 75, 100, 101, 200, 250, 251, 400, 500]) {
      const t = total(n);
      expect(t).toBeGreaterThan(prev);
      expect(t / n).toBeLessThan(prevAvg);
      prev = t;
      prevAvg = t / n;
    }
    for (const t of resolveSeatTiers(ent)) expect(t.monthlyTry % 10).toBe(9);
  });

  it("Profesyonel'in son kademesinden (399) ucuz; Profesyonel 38 kullanıcıdan sonra Kurumsal ucuzdur", () => {
    const tiers = resolveSeatTiers(ent);
    expect(Math.max(...tiers.map((t) => t.monthlyTry))).toBeLessThan(Math.min(...resolveSeatTiers(pro).slice(-1).map((t) => t.monthlyTry)));
    expect(findCrossoverSeat(catalog, "professional", "enterprise")).toBe(38);
    expect(quoteSeats(catalog, "enterprise", 501, "monthly").maxSeatsExceeded).toBe(true);
    expect(quoteSeats(catalog, "enterprise", 500, "monthly").maxSeatsExceeded).toBe(false);
  });
});
