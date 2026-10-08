import { describe, expect, it } from "vitest";
import { RECOMMENDED_CATALOG_OVERRIDES, applyPlanOverrides, parsePlanCatalogSettings, serializePlanCatalogSettings, diffAgainstDefault, sanitizeSeatTiers, BASE_CATALOG } from "@/lib/billing/plan-overrides";
import { parsePlanForm } from "@/lib/billing/plan-form";
import {
  computeSeatAnalytics,
  monthlyEquivalent,
  simulatePriceChange,
  type SeatSubscriberRow,
} from "@/lib/billing/seat-analytics";
import { DEFAULT_SEAT_SETTINGS, parseSeatSettings, serializeSeatSettings, warnRatioOf } from "@/lib/billing/seat-settings";

const catalog = applyPlanOverrides(RECOMMENDED_CATALOG_OVERRIDES);

function row(p: Partial<SeatSubscriberRow> & { tenantId: string }): SeatSubscriberRow {
  return {
    tenantName: p.tenantId,
    plan: "office",
    status: "active",
    cycle: "monthly",
    amountTry: 2490,
    extraSeats: 0,
    usedSeats: 2,
    locked: false,
    ...p,
  };
}

describe("computeSeatAnalytics", () => {
  const rows = [
    row({ tenantId: "a", usedSeats: 2 }), // ok
    row({ tenantId: "b", usedSeats: 4 }), // %80 -> uyarı
    row({ tenantId: "c", usedSeats: 5 }), // dolu
    row({ tenantId: "d", extraSeats: 3, amountTry: 2790 + 3 * 499, usedSeats: 7 }), // 7/8 uyarı
    row({ tenantId: "e", plan: "advisor", amountTry: 749, usedSeats: 1 }), // dolu
    row({ tenantId: "f", status: "past_due" }), // sayılmaz
    row({ tenantId: "g", cycle: "yearly", amountTry: 24900, usedSeats: null }), // 2075/ay, bilinmiyor
  ];
  const a = computeSeatAnalytics(rows, catalog, 0.8, true);

  it("MRR yıllığı 12'ye böler; yalnız aktifler sayılır; ARPA", () => {
    expect(monthlyEquivalent(rows[6]!)).toBe(2075);
    const expected = 2490 * 3 + (2790 + 1497) + 749 + 2075;
    expect(a.activeSubscribers).toBe(6);
    expect(a.mrrTry).toBe(Math.round(expected));
    expect(a.arpaTry).toBe(Math.round(expected / 6));
  });

  it("genişleme MRR kayıtlı ek koltuk x kademe", () => {
    expect(a.expansionMrrTry).toBe(1497);
    expect(a.extraSeatsTotal).toBe(3);
    expect(a.officesWithExtraSeats).toBe(1);
  });

  it("doluluk dağılımı ve listeler", () => {
    expect(a.utilization).toEqual({ ok: 1, warn: 2, full: 2, unknown: 1 });
    expect(a.fullTenants.map((r) => r.tenantId).sort()).toEqual(["c", "e"]);
    expect(a.warnTenants.map((r) => r.tenantId).sort()).toEqual(["b", "d"]);
  });

  it("eşik admin ayarına göre kayar", () => {
    const strict = computeSeatAnalytics(rows, catalog, 0.3, true);
    expect(strict.utilization.warn).toBeGreaterThan(a.utilization.warn);
  });

  it("plan dağılımı ofis sayısına göre sıralı", () => {
    expect(a.planDistribution[0]).toMatchObject({ plan: "office", offices: 5 });
    expect(a.planDistribution.find((p) => p.plan === "advisor")?.offices).toBe(1);
  });

  it("şema yoksa (extra_seats yok) genişleme etkin değil, çökmez", () => {
    const off = computeSeatAnalytics(rows.map((r) => ({ ...r, extraSeats: null })), catalog, 0.8, false);
    expect(off.extraSeatsEnabled).toBe(false);
    expect(off.expansionMrrTry).toBe(0);
    expect(off.extraSeatsTotal).toBe(0);
  });

  it("boş veri sıfır döner", () => {
    const e = computeSeatAnalytics([], catalog, 0.8, true);
    expect(e).toMatchObject({ activeSubscribers: 0, mrrTry: 0, arpaTry: 0 });
  });
});

describe("simulatePriceChange", () => {
  const office = catalog.find((p) => p.id === "office")!;
  const subs = [
    { plan: "office", status: "active", cycle: "monthly" as const, amountTry: 2790, extraSeats: 0, locked: false },
    { plan: "office", status: "active", cycle: "monthly" as const, amountTry: 1990, extraSeats: 0, locked: true },
    { plan: "office", status: "trialing", cycle: "monthly" as const, amountTry: 0, extraSeats: 0, locked: false },
  ];
  const raised = catalog.map((p) => (p.id === "office" ? { ...office, monthlyTry: 3290 } : p));

  it("varsayılan politika: mevcut abonenin kayıtlı tutarı değişmez, yalnız yeni satış etkilenir", () => {
    const r = simulatePriceChange({
      currentPlans: catalog,
      proposedPlans: raised,
      subscribers: subs,
      newSales: [{ planId: "office", totalSeats: 5, count: 4, cycle: "monthly" }],
      repriceExistingAtRenewal: false,
    });
    expect(r.before.mrrTry).toBe(2790 + 1990 + 4 * 2790);
    expect(r.after.mrrTry).toBe(2790 + 1990 + 4 * 3290);
    expect(r.deltaMrrTry).toBe(4 * 500);
    expect(r.unchangedSubscribers).toBe(2);
    expect(r.repricedSubscribers).toBe(0);
  });

  it("yenilemede yeniden fiyatlama: kilitli tutar korunur", () => {
    const r = simulatePriceChange({
      currentPlans: catalog,
      proposedPlans: raised,
      subscribers: subs,
      newSales: [],
      repriceExistingAtRenewal: true,
    });
    expect(r.after.mrrTry).toBe(3290 + 1990);
    expect(r.lockedSubscribers).toBe(1);
    expect(r.repricedSubscribers).toBe(1);
    expect(r.deltaMrrTry).toBe(500);
  });

  it("değişiklik yoksa fark 0; yeni satış adedi 0 ise yok sayılır", () => {
    const r = simulatePriceChange({
      currentPlans: catalog,
      proposedPlans: catalog,
      subscribers: subs,
      newSales: [{ planId: "office", totalSeats: 5, count: 0, cycle: "monthly" }],
      repriceExistingAtRenewal: true,
    });
    expect(r.deltaMrrTry).toBe(0);
    expect(r.deltaArpaTry).toBe(0);
  });

  it("ARPA değişimi yeni satış varsayımıyla hesaplanır", () => {
    const r = simulatePriceChange({
      currentPlans: catalog,
      proposedPlans: raised,
      subscribers: [subs[0]!],
      newSales: [{ planId: "office", totalSeats: 5, count: 1, cycle: "monthly" }],
      repriceExistingAtRenewal: false,
    });
    expect(r.before.arpaTry).toBe(2790);
    expect(r.after.arpaTry).toBe(Math.round((2790 + 3290) / 2));
  });
});

describe("koltuk ayarları (admin eşiği)", () => {
  it("varsayılan %80; bozuk/aralık dışı kayıt varsayılana düşer", () => {
    expect(parseSeatSettings(null)).toEqual(DEFAULT_SEAT_SETTINGS);
    expect(parseSeatSettings("{bozuk")).toEqual(DEFAULT_SEAT_SETTINGS);
    expect(parseSeatSettings(JSON.stringify({ warnPercent: 120 }))).toEqual(DEFAULT_SEAT_SETTINGS);
    expect(parseSeatSettings(JSON.stringify({ warnPercent: 70.5 }))).toEqual(DEFAULT_SEAT_SETTINGS);
  });

  it("geçerli eşik gidiş-dönüş", () => {
    const s = parseSeatSettings(serializeSeatSettings({ warnPercent: 65 }));
    expect(s.warnPercent).toBe(65);
    expect(warnRatioOf(s)).toBe(0.65);
  });
});

describe("katalog kalıcılığı: kademe alanları", () => {
  it("sanitizeSeatTiers yapısal bozuğu reddeder", () => {
    expect(sanitizeSeatTiers("x")).toBeUndefined();
    expect(sanitizeSeatTiers([{ fromSeat: 1.5, toSeat: null, monthlyTry: 399 }])).toBeUndefined();
    expect(sanitizeSeatTiers([{ fromSeat: 1, toSeat: null, monthlyTry: -3 }])).toBeUndefined();
    expect(sanitizeSeatTiers([])).toBeNull();
    expect(sanitizeSeatTiers(null)).toBeNull();
    expect(sanitizeSeatTiers([{ fromSeat: 1, toSeat: null, monthlyTry: 399 }])).toEqual([{ fromSeat: 1, toSeat: null, monthlyTry: 399 }]);
  });

  it("serileştirme gidiş-dönüş kademeleri korur; eski kayıt (alansız) bozulmaz", () => {
    const raw = serializePlanCatalogSettings({ overrides: RECOMMENDED_CATALOG_OVERRIDES, campaign: parsePlanCatalogSettings(null).campaign });
    const back = parsePlanCatalogSettings(raw);
    expect(back.overrides.office?.extraSeatTiers).toHaveLength(3);
    expect(back.overrides.professional?.maxSeats).toBe(500);
    const legacy = parsePlanCatalogSettings(JSON.stringify({ v: 2, plans: { office: { extraSeatMonthlyTry: 399 } } }));
    expect(legacy.overrides.office).toEqual({ extraSeatMonthlyTry: 399 });
  });

  it("diffAgainstDefault kademe farkını yakalar, aynıysa boş", () => {
    const base = BASE_CATALOG.find((p) => p.id === "office")!;
    expect(diffAgainstDefault(base, base)).toEqual({});
    const edited = { ...base, extraSeatTiers: [{ fromSeat: 1, toSeat: null, monthlyTry: 399 }] };
    expect(diffAgainstDefault(base, edited).extraSeatTiers).toEqual(edited.extraSeatTiers);
  });
});

describe("parsePlanForm: kademe alanları", () => {
  const base = BASE_CATALOG.find((p) => p.id === "office")!;
  const f = {
    name: "Ofis",
    blurb: "x",
    eyebrow: "y",
    monthly_try: "2490",
    yearly_paid_months: "10",
    seats: "5",
    features: "a",
  };

  it("geçerli kademeleri kabul eder", () => {
    const tiers = JSON.stringify([
      { fromSeat: 1, toSeat: 5, monthlyTry: 399 },
      { fromSeat: 6, toSeat: null, monthlyTry: 349 },
    ]);
    const r = parsePlanForm(base, { ...f, seat_tiers_json: tiers, seat_rounding: "x9", max_seats: "20" });
    expect("plan" in r && r.plan.extraSeatTiers?.length).toBe(2);
    expect("plan" in r && r.plan.maxSeats).toBe(20);
  });

  it("bozuk kademeyi (boşluk) reddeder", () => {
    const tiers = JSON.stringify([
      { fromSeat: 1, toSeat: 5, monthlyTry: 399 },
      { fromSeat: 9, toSeat: null, monthlyTry: 349 },
    ]);
    const r = parsePlanForm(base, { ...f, seat_tiers_json: tiers });
    expect("error" in r && r.error).toContain("boşluk");
  });

  it("kademe alanı yoksa eski davranış (kademesiz)", () => {
    const r = parsePlanForm(base, f);
    expect("plan" in r && r.plan.extraSeatTiers).toBeNull();
  });
});
