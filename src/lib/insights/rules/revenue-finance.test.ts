import { describe, expect, it } from "vitest";
import {
  evaluateAuthorityRenewal,
  evaluateHomeValue,
  evaluatePriceRevision,
  evaluateReferralInvites,
  evaluateUnshownMatches,
  inLifecycleWindow,
  type AuthorityRenewalFact,
  type HomeValueFact,
  type PriceRevisionFact,
  type ReferralInviteFact,
  type UnshownMatchFact,
} from "@/lib/insights/rules/revenue";
import { evaluatePriceAction, type StaleListingFact } from "@/lib/insights/rules/price-action";
import { evaluateExpenseBudgets, evaluatePortalRoi, evaluateSubscriptions, shortHash, type BudgetFact } from "@/lib/insights/rules/finance";
import { dedupeDrafts } from "@/lib/insights/dedupe";
import { computePortalRoi, pickLeastEfficientPortal, unusedPortalSubscriptions } from "@/lib/finance/portal-roi";
import { buildRecurringSeries } from "@/lib/finance/recurring-expenses";

// 2026-10-08 12:00 TR (UTC 09:00): kurallar nowMs enjekte eder.
const NOW = Date.UTC(2026, 9, 8, 9, 0, 0);
const DAY = 86_400_000;
const U1 = "11111111-1111-4111-8111-111111111111";

function expectWellFormed(drafts: { href: string; why: string; title: string; dedupeKey: string; evidence: unknown[] }[]) {
  for (const d of drafts) {
    expect(d.href.startsWith("/")).toBe(true);
    expect(d.title.length).toBeGreaterThan(0);
    expect(d.title.length).toBeLessThanOrEqual(200);
    expect(d.why.length).toBeLessThanOrEqual(600);
    expect(d.dedupeKey.length).toBeGreaterThanOrEqual(3);
    expect(d.dedupeKey.length).toBeLessThanOrEqual(200);
    expect(d.evidence.length).toBeGreaterThan(0);
  }
}

describe("authority_renewal: yetki 16-30 gün", () => {
  const base: AuthorityRenewalFact = { propertyId: "p1", assignedTo: U1, label: "Moda 3+1", endDate: "2026-11-01", daysLeft: 24, listPrice: 5_000_000, commissionRate: 3 };

  it("16-30 gün aralığında kanıtlı kart; risk altındaki komisyon hesaplanır", () => {
    const [d] = evaluateAuthorityRenewal([base], NOW);
    expect(d.kind).toBe("deadline");
    expect(d.href).toBe("/app/portfoyler/p1");
    expect(d.audience).toEqual({ type: "user", userId: U1 });
    expect(d.evidence.find((e) => e.label.startsWith("Risk"))?.value).toContain("150.000");
    expectWellFormed([d]);
  });

  it("sınırlar: 15 gün (deadline kuralının alanı) ve 31 gün üretmez; 16 ve 30 üretir", () => {
    expect(evaluateAuthorityRenewal([{ ...base, daysLeft: 15 }], NOW)).toEqual([]);
    expect(evaluateAuthorityRenewal([{ ...base, daysLeft: 31 }], NOW)).toEqual([]);
    expect(evaluateAuthorityRenewal([{ ...base, daysLeft: 16 }], NOW)).toHaveLength(1);
    expect(evaluateAuthorityRenewal([{ ...base, daysLeft: 30 }], NOW)).toHaveLength(1);
  });

  it("fiyat/oran yoksa risk satırı yok, atanan yoksa kart yok", () => {
    const [d] = evaluateAuthorityRenewal([{ ...base, listPrice: null }], NOW);
    expect(d.evidence.some((e) => e.label.startsWith("Risk"))).toBe(false);
    expect(evaluateAuthorityRenewal([{ ...base, assignedTo: "" }], NOW)).toEqual([]);
  });
});

describe("unshown_match: eşleşme var, gösterim yok", () => {
  const base: UnshownMatchFact = { demandId: "d1", propertyId: "11111111-aaaa", customerName: "Ayşe", propertyLabel: "Kadıköy 2+1", assignedTo: U1, score: 82, pairAgeDays: 5, hasAppointment: false };

  it("güçlü ve en az 3 gündür ortada olan çift için kart", () => {
    const [d] = evaluateUnshownMatches([base], NOW);
    expect(d.kind).toBe("match_suggestion");
    expect(d.href).toBe("/app/talepler?sekme=eslesme&demand=d1&property=11111111-aaaa");
    expect(d.evidence.map((e) => e.label)).toEqual(["Uyum", "Çift yaşı", "Randevu"]);
    expectWellFormed([d]);
  });

  it("sınırlar: skor 74 / yaş 2 gün / randevu var → kart yok; 75 ve 3 gün → var", () => {
    expect(evaluateUnshownMatches([{ ...base, score: 74 }], NOW)).toEqual([]);
    expect(evaluateUnshownMatches([{ ...base, pairAgeDays: 2 }], NOW)).toEqual([]);
    expect(evaluateUnshownMatches([{ ...base, hasAppointment: true }], NOW)).toEqual([]);
    expect(evaluateUnshownMatches([{ ...base, score: 75, pairAgeDays: 3 }], NOW)).toHaveLength(1);
  });

  it("alıcı başına en çok 5, en yüksek skor önde", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...base, demandId: `d${i}`, score: 76 + i }));
    const out = evaluateUnshownMatches(many, NOW);
    expect(out).toHaveLength(5);
    expect(out[0]!.href).toContain("demand=d8");
  });
});

describe("home_value: evinizin güncel değeri (yalnız emsal varsa)", () => {
  const base: HomeValueFact = {
    dealId: "deal1", customerId: "c1", customerName: "Mehmet", propertyLabel: "Bahçelievler 3+1", assignedTo: U1,
    boughtAt: "2025-04-10", low: 4_000_000, high: 4_600_000, compCount: 8, confidence: "orta",
  };

  it("1+ yıllık alım + emsal aralığı → TAHMİN etiketli kart", () => {
    const [d] = evaluateHomeValue([base], NOW);
    expect(d.isForecast).toBe(true);
    expect(d.confidence).toBe("orta");
    expect(d.why).toContain("TAHMİN");
    expect(d.evidence.find((e) => e.label === "Tahmini değer aralığı")?.value).toContain("4.000.000");
    expect(d.href).toBe("/app/musteriler/c1");
    expectWellFormed([d]);
  });

  it("1 yıldan yeni alım, emsal yetersiz veya ters aralık → kart yok", () => {
    expect(evaluateHomeValue([{ ...base, boughtAt: "2025-10-09" }], NOW)).toEqual([]);
    expect(evaluateHomeValue([{ ...base, compCount: 2 }], NOW)).toEqual([]);
    expect(evaluateHomeValue([{ ...base, low: 0, high: 0 }], NOW)).toEqual([]);
    expect(evaluateHomeValue([{ ...base, low: 5, high: 4 }], NOW)).toEqual([]);
  });

  it("tam 1 yıl sınırı: 365 gün üretir, 364 üretmez", () => {
    expect(evaluateHomeValue([{ ...base, boughtAt: "2025-10-08" }], NOW)).toHaveLength(1);
    expect(evaluateHomeValue([{ ...base, boughtAt: "2025-10-09" }], NOW)).toHaveLength(0);
  });

  it("3. yıl yıldönümü penceresinde lifecycle kuralına bırakılır", () => {
    expect(inLifecycleWindow("2023-10-10", "2026-10-08")).toBe(true);
    expect(evaluateHomeValue([{ ...base, boughtAt: "2023-10-10" }], NOW)).toEqual([]);
    expect(evaluateHomeValue([{ ...base, boughtAt: "2023-06-01" }], NOW)).toHaveLength(1);
  });
});

describe("price_revision: fiyat revizyonu (yalnız emsal varsa)", () => {
  const base: PriceRevisionFact = { propertyId: "p9", assignedTo: U1, label: "Çankaya 2+1", listPrice: 3_300_000, daysListed: 75, daysSincePriceChange: null, appointmentsLast60: 0, peerCount: 8, peerMedian: 3_000_000 };

  it("60+ gün, fiyat sabit, randevu yok, emsal var → kart", () => {
    const [d] = evaluatePriceRevision([base], NOW);
    expect(d.kind).toBe("price_action");
    expect(d.severity).toBe("bilgi"); // %10 üstü
    expect(d.evidence.map((e) => e.label)).toContain("Emsal medyanı");
    expect(d.why).toContain("gerçekleşen satış değil");
    expectWellFormed([d]);
  });

  it("emsal yoksa fiyat önerisi yok", () => {
    expect(evaluatePriceRevision([{ ...base, peerMedian: null }], NOW)).toEqual([]);
    expect(evaluatePriceRevision([{ ...base, peerCount: 4 }], NOW)).toEqual([]);
    expect(evaluatePriceRevision([{ ...base, peerMedian: 0 }], NOW)).toEqual([]);
  });

  it("sınırlar: 59 gün, yakın zamanda fiyat değişmiş, randevu var, medyanın altında → yok", () => {
    expect(evaluatePriceRevision([{ ...base, daysListed: 59 }], NOW)).toEqual([]);
    expect(evaluatePriceRevision([{ ...base, daysSincePriceChange: 59 }], NOW)).toEqual([]);
    expect(evaluatePriceRevision([{ ...base, appointmentsLast60: 1 }], NOW)).toEqual([]);
    expect(evaluatePriceRevision([{ ...base, listPrice: 2_900_000 }], NOW)).toEqual([]);
    expect(evaluatePriceRevision([{ ...base, daysListed: 60 }], NOW)).toHaveLength(1);
    expect(evaluatePriceRevision([{ ...base, listPrice: 3_000_000 }], NOW)).toHaveLength(1);
  });

  it("price_action ile aynı dedupe anahtarı: aynı ilan için tek kart", () => {
    const stale: StaleListingFact = { propertyId: "p9", assignedTo: U1, propertyCode: "P9", title: "Çankaya 2+1", listPrice: 3_600_000, daysListed: 75, peerCount: 8, peerMedian: 3_000_000 };
    const a = evaluatePriceAction([stale], NOW)[0]!;
    const b = evaluatePriceRevision([{ ...base, listPrice: 3_600_000 }], NOW)[0]!;
    expect(a.dedupeKey).toBe(b.dedupeKey);
    const merged = dedupeDrafts([a, b].map((draft) => ({ recipientUserId: U1, draft })));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.draft.ruleId).toBe("price_action@1");
  });
});

describe("referral_invite: memnun müşteri tavsiye daveti", () => {
  const base: ReferralInviteFact = { customerId: "c7", customerName: "Fatma", assignedTo: U1, score: 10, answeredAt: "2026-09-20T10:00:00Z", hasReferralLink: false };

  it("9-10 puan ve bağlantısı olmayan müşteri için kart", () => {
    const [d] = evaluateReferralInvites([base], NOW);
    expect(d.href).toBe("/app/tavsiyeler");
    expect(d.evidence.find((e) => e.label === "Anket puanı")?.value).toBe("10/10");
    expectWellFormed([d]);
  });

  it("sınırlar: 8 puan, bağlantısı var, atanan yok → kart yok; 9 → var; aynı müşteri tekrarlanmaz", () => {
    expect(evaluateReferralInvites([{ ...base, score: 8 }], NOW)).toEqual([]);
    expect(evaluateReferralInvites([{ ...base, hasReferralLink: true }], NOW)).toEqual([]);
    expect(evaluateReferralInvites([{ ...base, assignedTo: "" }], NOW)).toEqual([]);
    expect(evaluateReferralInvites([{ ...base, score: 9 }], NOW)).toHaveLength(1);
    expect(evaluateReferralInvites([base, { ...base, score: 9 }], NOW)).toHaveLength(1);
  });
});

describe("expense_budget: bütçe uyarıları (yönetim)", () => {
  const row = (category: string, budget: number, spent: number, prev = 0): BudgetFact => ({
    category, label: category === "reklam" ? "Reklam & Pazarlama" : category, budget, spent, ratio: spent / budget,
    status: spent / budget >= 1 ? "over" : spent / budget >= 0.8 ? "warn" : "ok",
    remaining: budget - spent, prevSpent: prev, deltaVsPrev: spent - prev, deltaPctVsPrev: prev > 0 ? Math.round(((spent - prev) / prev) * 100) : null,
  });
  const facts = (rows: BudgetFact[]) => ({ monthKey: "2026-10", monthStart: "2026-10-01", monthEnd: "2026-10-31", rows });
  const END = Date.UTC(2026, 10, 1, 0, 0, 0) - 3 * 3_600_000;

  it("%80 → orta, %100 → yüksek; yönetim alıcısı; filtreli href", () => {
    const out = evaluateExpenseBudgets(facts([row("reklam", 10_000, 8_000, 5_000), row("ofis", 5_000, 6_000)]), NOW, END);
    expect(out).toHaveLength(2);
    expect(out[0]!.severity).toBe("yuksek"); // aşım önde
    expect(out[0]!.audience).toEqual({ type: "management" });
    expect(out[0]!.href).toBe("/app/giderler?kategori=ofis&from=2026-10-01&to=2026-10-31#butce");
    const warn = out.find((d) => d.severity === "orta")!;
    expect(warn.evidence.find((e) => e.label === "Önceki aya göre")?.value).toBe("+%60");
    expectWellFormed(out);
  });

  it("sınır: %79,9 yok; tam %80 var; tam %100 yüksek", () => {
    expect(evaluateExpenseBudgets(facts([row("a", 1000, 799)]), NOW, END)).toEqual([]);
    expect(evaluateExpenseBudgets(facts([row("a", 1000, 800)]), NOW, END)[0]!.severity).toBe("orta");
    expect(evaluateExpenseBudgets(facts([row("a", 1000, 1000)]), NOW, END)[0]!.severity).toBe("yuksek");
  });

  it("eşik geçişi farklı dedupe anahtarı (warn → over yeni zil)", () => {
    const warn = evaluateExpenseBudgets(facts([row("a", 1000, 850)]), NOW, END)[0]!;
    const over = evaluateExpenseBudgets(facts([row("a", 1000, 1100)]), NOW, END)[0]!;
    expect(warn.dedupeKey).not.toBe(over.dedupeKey);
    expect(warn.dedupeKey).toBe(evaluateExpenseBudgets(facts([row("a", 1000, 900)]), NOW, END)[0]!.dedupeKey);
  });

  it("bütçe 0 veya satır yoksa kart yok; önceki ay yoksa yüzde uydurulmaz", () => {
    expect(evaluateExpenseBudgets(facts([]), NOW, END)).toEqual([]);
    expect(evaluateExpenseBudgets(facts([{ ...row("a", 1000, 900), budget: 0 }]), NOW, END)).toEqual([]);
    const [d] = evaluateExpenseBudgets(facts([row("a", 1000, 900, 0)]), NOW, END);
    expect(d.evidence.find((e) => e.label === "Önceki aya göre")?.value).toBe("önceki ay gider yok");
  });

  it("kısa özet kararlı ve kategori başına farklı", () => {
    expect(shortHash("reklam")).toBe(shortHash("reklam"));
    expect(shortHash("reklam")).not.toBe(shortHash("ofis"));
  });
});

describe("subscription: yenileme + kullanılmayan portal aboneliği", () => {
  const series = (date: string, recurrence: "monthly" | "yearly" = "monthly") =>
    buildRecurringSeries([{ id: "e1", title: "Zingat paketi", category: "reklam", amount: 2500, date, recurrence }]).map((s) => ({ ...s, categoryLabel: "Reklam" }));

  it("7 gün içinde yenilenen seri kart üretir; 8 gün kala üretmez", () => {
    // son ödeme 2026-09-14 → yenileme 2026-10-14 (6 gün kala)
    const [d] = evaluateSubscriptions({ todayKey: "2026-10-08", series: series("2026-09-14"), unusedPortals: [] }, NOW);
    expect(d.kind).toBe("deadline");
    expect(d.title).toContain("6 gün sonra");
    expect(d.audience).toEqual({ type: "management" });
    expectWellFormed([d]);
    expect(evaluateSubscriptions({ todayKey: "2026-10-08", series: series("2026-09-16"), unusedPortals: [] }, NOW)).toEqual([]);
  });

  it("vadesi geçmiş ve kayıt girilmemiş: orta şiddet; 14 günden eski bitmiş sayılır", () => {
    const [d] = evaluateSubscriptions({ todayKey: "2026-10-08", series: series("2026-09-05"), unusedPortals: [] }, NOW);
    expect(d.severity).toBe("orta");
    expect(d.title).toContain("Yenileme tarihi geçti");
    expect(evaluateSubscriptions({ todayKey: "2026-10-30", series: series("2026-09-05"), unusedPortals: [] }, NOW)).toEqual([]);
  });

  const roi = (leads: number, listings: number, inWindow = 0) =>
    computePortalRoi({
      expenses: [
        { portalKey: "sahibinden", amount: 3000, date: "2026-07-12", recurrence: null },
        { portalKey: "sahibinden", amount: 3000, date: "2026-08-12", recurrence: null },
      ],
      leads: { sahibinden: leads }, won: {}, liveListings: { sahibinden: listings }, listingsInWindow: { sahibinden: inWindow },
      windowStart: "2026-07-10", windowEnd: "2026-10-08",
    });

  it("kullanılmayan portal aboneliği: maliyet var, ilan yok, talep yok", () => {
    const [d] = evaluateSubscriptions({ todayKey: "2026-10-08", series: [], unusedPortals: unusedPortalSubscriptions(roi(0, 0)) }, NOW);
    expect(d.title).toContain("Sahibinden.com");
    expect(d.href).toBe("/app/giderler?portal=sahibinden#portal-getirisi");
    expectWellFormed([d]);
    expect(unusedPortalSubscriptions(roi(2, 0))).toEqual([]);
    expect(unusedPortalSubscriptions(roi(0, 1))).toEqual([]);
    expect(unusedPortalSubscriptions(roi(0, 0, 1))).toEqual([]);
  });
});

describe("portal_roi: en verimsiz portal uyarısı", () => {
  const rows = computePortalRoi({
    expenses: [
      { portalKey: "sahibinden", amount: 3000, date: "2026-07-12", recurrence: null },
      { portalKey: "sahibinden", amount: 3000, date: "2026-08-12", recurrence: null },
      { portalKey: "zingat", amount: 1000, date: "2026-07-12", recurrence: null },
      { portalKey: "zingat", amount: 1000, date: "2026-08-12", recurrence: null },
    ],
    leads: { sahibinden: 3, zingat: 10 }, won: {}, liveListings: { sahibinden: 3, zingat: 2 }, listingsInWindow: {},
    windowStart: "2026-07-10", windowEnd: "2026-10-08",
  });

  it("göreli verimsiz portal için yönetim kartı, kıyas kanıtta", () => {
    const [d] = evaluatePortalRoi(pickLeastEfficientPortal(rows), rows, NOW);
    expect(d.audience).toEqual({ type: "management" });
    expect(d.title).toContain("Sahibinden.com");
    expect(d.evidence).toHaveLength(3);
    expect(d.href).toBe("/app/giderler?portal=sahibinden#portal-getirisi");
    expectWellFormed([d]);
  });

  it("veri yetersizse kart yok", () => {
    expect(evaluatePortalRoi(null, rows, NOW)).toEqual([]);
    const thin = computePortalRoi({
      expenses: [{ portalKey: "sahibinden", amount: 3000, date: "2026-10-01", recurrence: null }],
      leads: {}, won: {}, liveListings: { sahibinden: 3 }, listingsInWindow: {}, windowStart: "2026-07-10", windowEnd: "2026-10-08",
    });
    expect(evaluatePortalRoi(pickLeastEfficientPortal(thin), thin, NOW)).toEqual([]);
  });

  it("talep yok uyarısı yalnız ilan yayındayken ve yeterli maliyette", () => {
    const noLeads = computePortalRoi({
      expenses: [
        { portalKey: "hepsiemlak", amount: 2000, date: "2026-07-12", recurrence: null },
        { portalKey: "hepsiemlak", amount: 2000, date: "2026-08-12", recurrence: null },
      ],
      leads: {}, won: {}, liveListings: { hepsiemlak: 4 }, listingsInWindow: {}, windowStart: "2026-07-10", windowEnd: "2026-10-08",
    });
    const [d] = evaluatePortalRoi(pickLeastEfficientPortal(noLeads), noLeads, NOW);
    expect(d.title).toContain("talep gelmiyor");
    expect(d.validUntilMs).toBe(NOW + 30 * DAY);
  });
});
