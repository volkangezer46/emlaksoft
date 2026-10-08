import { describe, expect, it } from "vitest";
import { BUDGET_OVER_RATIO, BUDGET_WARN_RATIO, budgetStatus, computeBudgetRows, parseBudgetAmount, sumByCategory } from "@/lib/finance/expense-budget";
import {
  addMonthsKey,
  buildRecurringSeries,
  monthlyEquivalent,
  nextDueKey,
  renewalInfo,
  RENEWAL_REMIND_DAYS,
  RENEWAL_STALE_AFTER_DAYS,
  type RecurringExpense,
} from "@/lib/finance/recurring-expenses";
import {
  allocatedCost,
  computePortalRoi,
  pickLeastEfficientPortal,
  portalKeyFromLeadSource,
  portalKeyFromName,
  unusedPortalSubscriptions,
  type PortalRoiInput,
} from "@/lib/finance/portal-roi";
import { computeCommissionLeakage, type WonSaleFact } from "@/lib/finance/commission-leakage";
import { computeAdvisorProfitability } from "@/lib/finance/advisor-profitability";

describe("gider bütçesi", () => {
  it("%80 ve %100 sınırları", () => {
    expect(budgetStatus(79.99, 100)).toBe("ok");
    expect(budgetStatus(100 * BUDGET_WARN_RATIO, 100)).toBe("warn");
    expect(budgetStatus(99.99, 100)).toBe("warn");
    expect(budgetStatus(100 * BUDGET_OVER_RATIO, 100)).toBe("over");
    expect(budgetStatus(500, 100)).toBe("over");
  });

  it("bütçe 0 / negatif ise aşım iddia edilmez ve satır üretilmez", () => {
    expect(budgetStatus(1000, 0)).toBe("ok");
    expect(computeBudgetRows([{ category: "ofis", monthlyAmount: 0 }, { category: "reklam", monthlyAmount: -5 }], new Map([["ofis", 500]]), new Map())).toEqual([]);
  });

  it("gerçekleşen, kalan ve önceki aya sapma; aşım üstte", () => {
    const rows = computeBudgetRows(
      [{ category: "ofis", monthlyAmount: 10_000 }, { category: "reklam", monthlyAmount: 5_000 }, { category: "ulasim", monthlyAmount: 2_000 }],
      new Map([["ofis", 8_500], ["reklam", 6_000]]),
      new Map([["ofis", 5_000], ["reklam", 0]]),
    );
    expect(rows.map((r) => r.category)).toEqual(["reklam", "ofis", "ulasim"]);
    const reklam = rows[0]!;
    expect(reklam.status).toBe("over");
    expect(reklam.remaining).toBe(-1_000);
    expect(reklam.deltaPctVsPrev).toBeNull(); // önceki ay 0: yüzde tanımsız
    expect(reklam.deltaVsPrev).toBe(6_000);
    const ofis = rows[1]!;
    expect(ofis.status).toBe("warn");
    expect(ofis.deltaPctVsPrev).toBe(70);
    expect(rows[2]!.spent).toBe(0);
    expect(rows[2]!.status).toBe("ok");
  });

  it("kategori toplamı ve tutar ayrıştırma", () => {
    expect(sumByCategory([{ category: "a", amount: "10" }, { category: "a", amount: 5 }, { category: "b", amount: "x" }]).get("a")).toBe(15);
    expect(sumByCategory([{ category: "b", amount: "x" }]).get("b")).toBe(0);
    expect(parseBudgetAmount("12.500,50")).toBe(12500.5);
    expect(parseBudgetAmount("12500.5")).toBe(12500.5);
    expect(parseBudgetAmount("0")).toBeNull();
    expect(parseBudgetAmount("-3")).toBeNull();
    expect(parseBudgetAmount("abc")).toBeNull();
    expect(parseBudgetAmount("")).toBeNull();
  });
});

describe("tekrarlayan giderler", () => {
  it("ay sonu sıkıştırma ve dönemler", () => {
    expect(addMonthsKey("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsKey("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsKey("2026-11-15", 3)).toBe("2027-02-15");
    expect(nextDueKey("2026-03-10", "yearly")).toBe("2027-03-10");
    expect(monthlyEquivalent(1200, "yearly")).toBe(100);
  });

  const mk = (id: string, date: string, extra: Partial<RecurringExpense> = {}): RecurringExpense => ({
    id, title: "Sahibinden Mağaza", category: "reklam", amount: 3000, date, recurrence: "monthly", ...extra,
  });

  it("aynı başlık+kategori+dönem tek seri; son kayıt yenilemeyi belirler", () => {
    // başlık büyük/küçük harf ve boşluk farkına duyarsız
    expect(buildRecurringSeries([mk("a", "2026-07-05"), mk("b", "2026-09-05", { title: " sahibinden  mağaza " })])).toHaveLength(1);
    const series = buildRecurringSeries([mk("a", "2026-07-05"), mk("b", "2026-09-05")])[0]!;
    expect(series.lastId).toBe("b");
    expect(series.nextDue).toBe("2026-10-05");
    expect(series.recordCount).toBe(2);
  });

  it("farklı dönem ayrı seri; geçersiz tarih atlanır", () => {
    expect(buildRecurringSeries([mk("a", "2026-07-05"), mk("b", "2026-07-05", { recurrence: "yearly" }), mk("c", "bozuk")])).toHaveLength(2);
  });

  it("yenileme durumu sınırları", () => {
    const s = { nextDue: "2026-10-10" };
    expect(renewalInfo(s, "2026-10-03")).toEqual({ state: "due_soon", daysLeft: RENEWAL_REMIND_DAYS });
    expect(renewalInfo(s, "2026-10-02").state).toBe("upcoming");
    expect(renewalInfo(s, "2026-10-10")).toEqual({ state: "due_soon", daysLeft: 0 });
    expect(renewalInfo(s, "2026-10-11")).toEqual({ state: "overdue", daysLeft: -1 });
    expect(renewalInfo(s, `2026-10-${10 + RENEWAL_STALE_AFTER_DAYS}`).state).toBe("overdue");
    expect(renewalInfo(s, `2026-10-${10 + RENEWAL_STALE_AFTER_DAYS + 1}`).state).toBe("inactive");
  });
});

describe("portal ROI", () => {
  it("anahtar eşleme", () => {
    expect(portalKeyFromLeadSource("portal_sahibinden")).toBe("sahibinden");
    expect(portalKeyFromLeadSource("PORTAL_Zingat")).toBe("zingat");
    expect(portalKeyFromLeadSource("tavsiye")).toBeNull();
    expect(portalKeyFromLeadSource("portal_bilinmeyen")).toBeNull();
    expect(portalKeyFromName("Sahibinden.com")).toBe("sahibinden");
    expect(portalKeyFromName("Emlak Jet")).toBe("emlakjet");
    expect(portalKeyFromName("HEPSİEMLAK")).toBe("hepsiemlak");
    expect(portalKeyFromName(null)).toBeNull();
  });

  it("gider payı: tek seferlik pencere içinde tam, dışında 0; yıllık dönem oransal", () => {
    const ws = "2026-07-10";
    const we = "2026-10-08";
    expect(allocatedCost({ portalKey: "zingat", amount: 900, date: "2026-08-01", recurrence: null }, ws, we)).toBe(900);
    expect(allocatedCost({ portalKey: "zingat", amount: 900, date: "2026-06-01", recurrence: null }, ws, we)).toBe(0);
    // 12 aylık 3650 TL; pencere 91 gün tamamen dönem içinde -> 91/365 pay
    const yearly = allocatedCost({ portalKey: "zingat", amount: 3650, date: "2026-01-01", recurrence: "yearly" }, ws, we);
    expect(yearly).toBeCloseTo(3650 * (91 / 365), 5);
    // dönem pencereden önce bitmiş
    expect(allocatedCost({ portalKey: "zingat", amount: 3650, date: "2025-01-01", recurrence: "yearly" }, ws, we)).toBe(0);
    expect(allocatedCost({ portalKey: "zingat", amount: 0, date: "2026-08-01", recurrence: null }, ws, we)).toBe(0);
  });

  const base: PortalRoiInput = {
    expenses: [],
    leads: {},
    won: {},
    liveListings: {},
    listingsInWindow: {},
    windowStart: "2026-07-10",
    windowEnd: "2026-10-08",
  };

  it("sıfıra bölme yok: talep/anlaşma 0 iken maliyet metrikleri null", () => {
    const [r] = computePortalRoi({
      ...base,
      expenses: [{ portalKey: "sahibinden", amount: 6000, date: "2026-07-15", recurrence: null }],
    });
    expect(r!.sufficient).toBe(true);
    expect(r!.leads).toBe(0);
    expect(r!.costPerLead).toBeNull();
    expect(r!.costPerDeal).toBeNull();
    expect(r!.netReturn).toBe(-6000);
  });

  it("maliyet geçmişi 45 günden kısaysa veri yetersiz: metrik de karar da yok", () => {
    const rows = computePortalRoi({
      ...base,
      expenses: [{ portalKey: "sahibinden", amount: 6000, date: "2026-09-20", recurrence: null }],
      leads: { sahibinden: 4 },
    });
    expect(rows[0]!.sufficient).toBe(false);
    expect(rows[0]!.costPerLead).toBeNull();
    expect(rows[0]!.netReturn).toBeNull();
    expect(pickLeastEfficientPortal(rows)).toBeNull();
  });

  it("gider eşlenmemiş portal: maliyet 0 ve yetersiz (talep sayısı yine görünür)", () => {
    const rows = computePortalRoi({ ...base, leads: { zingat: 5 } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cost).toBe(0);
    expect(rows[0]!.sufficient).toBe(false);
    expect(rows[0]!.leads).toBe(5);
  });

  const twoPortals: PortalRoiInput = {
    ...base,
    expenses: [
      { portalKey: "sahibinden", amount: 3000, date: "2026-07-12", recurrence: null },
      { portalKey: "sahibinden", amount: 3000, date: "2026-08-12", recurrence: null },
      { portalKey: "zingat", amount: 1000, date: "2026-07-12", recurrence: null },
      { portalKey: "zingat", amount: 1000, date: "2026-08-12", recurrence: null },
    ],
    leads: { sahibinden: 3, zingat: 10 },
    won: { zingat: { deals: 2, commission: 90_000 } },
    liveListings: { sahibinden: 4, zingat: 2 },
  };

  it("talep ve anlaşma başına maliyet", () => {
    const rows = computePortalRoi(twoPortals);
    const z = rows.find((r) => r.portalKey === "zingat")!;
    expect(z.costPerLead).toBe(200);
    expect(z.costPerDeal).toBe(1000);
    expect(z.netReturn).toBe(88_000);
    const s = rows.find((r) => r.portalKey === "sahibinden")!;
    expect(s.costPerLead).toBe(2000);
    expect(s.costPerDeal).toBeNull();
  });

  it("en verimsiz portal: göreli >= 2 kat", () => {
    const worst = pickLeastEfficientPortal(computePortalRoi(twoPortals));
    expect(worst).toMatchObject({ kind: "relative", portalKey: "sahibinden", benchmarkKey: "zingat", costPerLead: 2000, benchmarkCostPerLead: 200 });
  });

  it("fark 2 katın altındaysa uyarı yok", () => {
    const sixX = computePortalRoi({ ...twoPortals, leads: { sahibinden: 5, zingat: 10 } }); // 1200 vs 200
    expect(pickLeastEfficientPortal(sixX)?.kind).toBe("relative");
    const threeX = computePortalRoi({ ...twoPortals, leads: { sahibinden: 10, zingat: 10 } }); // 600 vs 200
    expect(pickLeastEfficientPortal(threeX)?.kind).toBe("relative");
    const even = computePortalRoi({ ...twoPortals, expenses: twoPortals.expenses.map((e) => ({ ...e, amount: 1000 })), leads: { sahibinden: 10, zingat: 10 } });
    expect(pickLeastEfficientPortal(even)).toBeNull();
  });

  it("talep sayısı 3'ün altındaysa göreli kıyas yok", () => {
    const rows = computePortalRoi({ ...twoPortals, leads: { sahibinden: 2, zingat: 10 } });
    expect(pickLeastEfficientPortal(rows)).toBeNull();
  });

  it("ilan yayında + maliyet var + hiç talep yok = uyarı; ilan yoksa o uyarı yok", () => {
    const rows = computePortalRoi({ ...twoPortals, leads: { zingat: 10 } });
    expect(pickLeastEfficientPortal(rows)).toMatchObject({ kind: "no_leads", portalKey: "sahibinden", cost: 6000 });
    const noListing = computePortalRoi({ ...twoPortals, leads: { zingat: 10 }, liveListings: { zingat: 2 } });
    expect(pickLeastEfficientPortal(noListing)?.kind).not.toBe("no_leads");
  });

  it("kullanılmayan abonelik: maliyet var, ilan yok, talep yok", () => {
    const rows = computePortalRoi({ ...twoPortals, leads: { zingat: 10 }, liveListings: { zingat: 2 } });
    expect(unusedPortalSubscriptions(rows).map((r) => r.portalKey)).toEqual(["sahibinden"]);
    // son 90 günde ilan yayınlanmışsa kullanılmış sayılır
    const used = computePortalRoi({ ...twoPortals, leads: { zingat: 10 }, liveListings: { zingat: 2 }, listingsInWindow: { sahibinden: 1 } });
    expect(unusedPortalSubscriptions(used)).toEqual([]);
    // maliyet eşiğin altında
    const cheap = computePortalRoi({ ...twoPortals, expenses: [{ portalKey: "sahibinden", amount: 400, date: "2026-07-12", recurrence: null }, { portalKey: "sahibinden", amount: 400, date: "2026-08-12", recurrence: null }] });
    expect(unusedPortalSubscriptions(cheap)).toEqual([]);
  });
});

describe("komisyon sızıntısı", () => {
  const sale = (id: string, rate: number | null, value: number, closedAt: string, extra: Partial<WonSaleFact> = {}): WonSaleFact => ({
    dealId: id, propertyId: `p-${id}`, propertyLabel: `Daire ${id}`, advisorId: "u1", advisorName: "Ayşe", dealValue: value, appliedRate: rate, closedAt, ...extra,
  });
  const months = ["2026-08", "2026-09", "2026-10"];

  it("indirim farkı = bedel × puan / 100; aylara ve danışmana dağılır", () => {
    const r = computeCommissionLeakage(
      [sale("a", 2, 5_000_000, "2026-09-10T09:00:00Z"), sale("b", 3, 4_000_000, "2026-09-12T09:00:00Z"), sale("c", 2.5, 2_000_000, "2026-10-02T09:00:00Z", { advisorId: "u2", advisorName: "Can" })],
      3,
      months,
      { enabled: true, threshold: 1 },
    );
    expect(r.salesAnalyzed).toBe(3);
    expect(r.discountedCount).toBe(2);
    expect(r.totalLeak).toBe(50_000 + 10_000);
    expect(r.months.find((m) => m.key === "2026-09")!.leak).toBe(50_000);
    expect(r.months.find((m) => m.key === "2026-10")!.deals).toBe(1);
    expect(r.deals[0]!.dealId).toBe("a");
    expect(r.advisors.map((a) => a.name)).toEqual(["Ayşe", "Can"]);
    expect(r.advisors[0]!.avgCutPoints).toBe(1);
  });

  it("oran standartta/üstünde, oran yok, bedel 0 ise sızıntı yok", () => {
    const r = computeCommissionLeakage(
      [sale("a", 3, 1_000_000, "2026-09-10T09:00:00Z"), sale("b", 4, 1_000_000, "2026-09-10T09:00:00Z"), sale("c", null, 1_000_000, "2026-09-10T09:00:00Z"), sale("d", 1, 0, "2026-09-10T09:00:00Z")],
      3,
      months,
      { enabled: false, threshold: 1 },
    );
    expect(r.totalLeak).toBe(0);
    expect(r.discountedCount).toBe(0);
    expect(r.salesAnalyzed).toBe(2); // yalnız oranı ve bedeli olanlar
    expect(r.advisors).toEqual([]);
  });

  it("onay eşiği: kural açıkken eşik ve üstü sayılır, kapalıyken sayılmaz", () => {
    const sales = [sale("a", 2, 1_000_000, "2026-09-10T09:00:00Z"), sale("b", 2.6, 1_000_000, "2026-09-10T09:00:00Z")];
    expect(computeCommissionLeakage(sales, 3, months, { enabled: true, threshold: 1 }).overThresholdCount).toBe(1);
    expect(computeCommissionLeakage(sales, 3, months, { enabled: false, threshold: 1 }).overThresholdCount).toBe(0);
  });

  it("pencere dışı ay yok sayılır; standart oran geçersizse boş", () => {
    expect(computeCommissionLeakage([sale("a", 2, 1_000_000, "2025-01-10T09:00:00Z")], 3, months, { enabled: true, threshold: 1 }).salesAnalyzed).toBe(0);
    expect(computeCommissionLeakage([sale("a", 2, 1_000_000, "2026-09-10T09:00:00Z")], 0, months, { enabled: true, threshold: 1 }).totalLeak).toBe(0);
  });
});

describe("danışman kârlılığı", () => {
  const names = new Map([["u1", "Ayşe"], ["u2", "Can"]]);

  it("ofiste kalan − doğrudan maliyet; iptal komisyon sayılmaz; ortak gider ayrı", () => {
    const r = computeAdvisorProfitability(
      [
        { commissionId: "c1", advisorId: "u1", gross: 100_000, vat: 16_667, status: "paid" },
        { commissionId: "c2", advisorId: "u1", gross: 50_000, vat: 8_333, status: "cancelled" },
        { commissionId: "c3", advisorId: "u2", gross: 60_000, vat: 10_000, status: "calculated" },
      ],
      [
        { commissionId: "c1", kind: "advisor", amount: 40_000 },
        { commissionId: "c1", kind: "office", amount: 43_333 },
        { commissionId: "c3", kind: "office", amount: 50_000 },
      ],
      [{ advisorId: "u1", amount: 3_000 }, { advisorId: null, amount: 9_000 }],
      names,
    );
    expect(r.unattributedExpenses).toBe(9_000);
    const a = r.rows.find((x) => x.advisorId === "u1")!;
    expect(a.commissions).toBe(1);
    expect(a.retained).toBe(43_333);
    expect(a.directCosts).toBe(3_000);
    expect(a.net).toBe(40_333);
    expect(r.rows[0]!.advisorId).toBe("u2"); // net 50.000 > 40.333
    expect(r.rows.find((x) => x.advisorId === "u2")!.unsplit).toBe(0);
  });

  it("veri yoksa boş; paylaşımı tanımsız komisyon sayılır", () => {
    expect(computeAdvisorProfitability([], [], [], names).rows).toEqual([]);
    const r = computeAdvisorProfitability([{ commissionId: "c1", advisorId: "u1", gross: 1000, vat: 0, status: "calculated" }], [], [], names);
    expect(r.rows[0]!.unsplit).toBe(1);
    expect(r.rows[0]!.retained).toBe(1000);
  });
});
