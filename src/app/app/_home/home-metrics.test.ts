import { describe, expect, it } from "vitest";
import {
  FUNNEL_SEQUENTIAL,
  buildAttentionItems,
  collectionRatePct,
  heroFocus,
  monthShortLabel,
  revenueSeries,
  type AttentionInput,
  comparedMetric,
  contextMetric,
  dedupeMetrics,
  funnelRows,
  hasContext,
  monthProgress,
  rankTeam,
  targetPace,
  teamStatus,
} from "./home-metrics";

describe("metrik bağlamı", () => {
  it("karşılaştırmalı metrik trend + bağlam cümlesi + gerçek seri taşır", () => {
    const m = comparedMetric({ key: "yeni-talep", label: "Yeni talep", value: 12, previous: 10, previousText: "Önceki 30 gün 10", href: "/app/talepler", series: [1, 3, 8], seriesLabel: "x" });
    expect(m.trend).toMatchObject({ dir: "up" });
    expect(m.series).toEqual([1, 3, 8]);
    expect(hasContext(m)).toBe(true);
  });
  it("tek noktalı seri çizilmez (uydurma çizim yok)", () => {
    const m = comparedMetric({ key: "a", label: "A", value: 1, previous: 1, previousText: "dün 1", href: "/x", series: [5], seriesLabel: "x" });
    expect(m.series).toBeNull();
  });
  it("bağlamsız metrik tanınır", () => {
    expect(hasContext({ trend: null, context: " ", series: null })).toBe(false);
    const c = contextMetric({ key: "teyit", label: "Teyit", value: 90, format: "percent", context: "3 ilan 7+ gün teyitsiz", href: "/app/portallar", seriesLabel: "x" });
    expect(hasContext(c)).toBe(true);
    expect(c.trend).toBeNull();
  });
  it("önceki dönem 0 iken sahte yüzde yerine 'yeni' döner", () => {
    const m = comparedMetric({ key: "a", label: "A", value: 4, previous: 0, previousText: "-", href: "/x", seriesLabel: "x" });
    expect(m.trend?.dir).toBe("new");
  });
  it("aynı anahtar bir kez", () => {
    expect(dedupeMetrics([{ key: "a" }, { key: "b" }, { key: "a" }])).toEqual([{ key: "a" }, { key: "b" }]);
  });
});

describe("collectionRatePct", () => {
  it("tahakkuk yoksa oran uydurulmaz", () => {
    expect(collectionRatePct(0, 0)).toBeNull();
    expect(collectionRatePct(30, 120)).toBe(25);
    expect(collectionRatePct(120, 120)).toBe(100);
  });
});

describe("monthProgress (TR takvimi)", () => {
  it("ayın ortasında ~%50 ve kalan gün", () => {
    // 16 Ekim 2026 12:00 TR (UTC+3) = 09:00 UTC; Ekim 31 gün
    const p = monthProgress(Date.UTC(2026, 9, 16, 9, 0));
    expect(p.elapsedPct).toBeGreaterThanOrEqual(48);
    expect(p.elapsedPct).toBeLessThanOrEqual(52);
    expect(p.daysLeft).toBe(16);
  });
  it("ay başında %0'a yakın, son günde en az 1 gün kalır", () => {
    expect(monthProgress(Date.UTC(2026, 9, 1, 0, 30)).elapsedPct).toBeLessThanOrEqual(5);
    expect(monthProgress(Date.UTC(2026, 9, 31, 20, 0)).daysLeft).toBe(1);
  });
});

describe("targetPace", () => {
  it("hedef yoksa null (yüzde uydurulmaz)", () => {
    expect(targetPace({ actual: 5, target: 0, elapsedPct: 50, daysLeft: 10 })).toBeNull();
  });
  it("gerekli hızı kalan günlere böler", () => {
    const p = targetPace({ actual: 40, target: 100, elapsedPct: 60, daysLeft: 12 })!;
    expect(p).toMatchObject({ pct: 40, expectedPct: 60, state: "behind", remaining: 60 });
    expect(p.requiredPerDay).toBeCloseTo(5);
  });
  it("tolerans içinde yolunda, aşılınca exceeded ve gerekli hız 0", () => {
    expect(targetPace({ actual: 55, target: 100, elapsedPct: 60, daysLeft: 12 })!.state).toBe("on-track");
    const e = targetPace({ actual: 120, target: 100, elapsedPct: 60, daysLeft: 12 })!;
    expect(e.state).toBe("exceeded");
    expect(e.pct).toBe(120);
    expect(e.requiredPerDay).toBe(0);
  });
  it("ay son günü: daysLeft en az 1", () => {
    expect(targetPace({ actual: 0, target: 10, elapsedPct: 100, daysLeft: 0 })!.requiredPerDay).toBe(10);
  });
});

describe("huni", () => {
  it("bağımsız sayımlarda dönüşüm oku kapalı; aşama payı yazılır", () => {
    expect(FUNNEL_SEQUENTIAL).toBe(false);
    const rows = funnelRows({ newDemand: 10, activeDemand: 20, matchedDemand: 5, won: 2 });
    expect(rows.map((r) => r.value)).toEqual([10, 20, 5, 2]);
    expect(rows[1]!.sub).toBe("En büyük aşama");
    expect(rows[0]!.sub).toBe("En büyük aşamanın %50'i");
    expect(rows.every((r) => r.href.startsWith("/app/"))).toBe(true);
  });
  it("tüm aşamalar 0 ise alt yazı boş", () => {
    expect(funnelRows({ newDemand: 0, activeDemand: 0, matchedDemand: 0, won: 0 }).every((r) => r.sub === "")).toBe(true);
  });
});

describe("buildAttentionItems", () => {
  const base: AttentionInput = {
    overdueTasks: null,
    approvals: null,
    overdueRent: null,
    staleDeals: null,
    staleDays: 14,
    unconfirmedListings: null,
    expiringAuthority: null,
    expiringCapped: false,
    pendingCommission: null,
    pendingCommissionText: "",
    passiveAdvisors: null,
    passiveDays: 30,
    mine: false,
    userId: "u1",
  };
  it("yalnız gerçek sayı > 0 olan kalemler, önem sırasıyla ve filtrelenmiş hedefle", () => {
    const items = buildAttentionItems({ ...base, approvals: 2, overdueRent: 0, passiveAdvisors: 1, expiringAuthority: 3, overdueTasks: 4, staleDeals: 2 });
    expect(items.map((i) => i.id)).toEqual(["gorev", "onay", "riskli-anlasma", "yetki", "pasif"]);
    expect(items.map((i) => i.level)).toEqual(["acil", "yuksek", "yuksek", "orta", "dusuk"]);
    // Hareketsiz danışman ekip listesine gider (ekipte süzgeç yok); diğerleri süzgeçli liste.
    expect(items.filter((i) => i.id !== "pasif").every((i) => i.href.startsWith("/app/") && i.href.includes("?"))).toBe(true);
    expect(items.find((i) => i.id === "yetki")?.href).toBe("/app/portfoyler?yetki=bitiyor");
    expect(items.find((i) => i.id === "riskli-anlasma")?.href).toBe("/app/anlasmalar?bayat=1");
  });
  it("'Ben' kapsamı hedef bağlantıya taşınır", () => {
    const items = buildAttentionItems({ ...base, mine: true, overdueTasks: 1, staleDeals: 1, expiringAuthority: 1 });
    expect(items.find((i) => i.id === "gorev")?.href).toBe("/app/gorevler?filter=overdue&mine=1");
    expect(items.find((i) => i.id === "riskli-anlasma")?.href).toBe("/app/anlasmalar?bayat=1&danisman=u1");
    expect(items.find((i) => i.id === "yetki")?.href).toBe("/app/portfoyler?yetki=bitiyor&danisman=u1");
  });
  it("tavanlı sayı ve tutar kalemi sayı göstermez (yanlış sayı yok)", () => {
    const items = buildAttentionItems({ ...base, expiringAuthority: 12, expiringCapped: true, pendingCommission: 5000, pendingCommissionText: "₺5.000" });
    expect(items.find((i) => i.id === "yetki")?.count).toBeUndefined();
    expect(items.find((i) => i.id === "komisyon")?.count).toBeUndefined();
  });
  it("hiçbiri yoksa boş; kaçan komisyon dikkat listesinde YOK (risk bloğunda)", () => {
    expect(buildAttentionItems(base)).toEqual([]);
    expect(buildAttentionItems({ ...base, approvals: 1, overdueRent: 4 }).some((i) => i.id === "kacan")).toBe(false);
  });
  it("hero cümlesi en öncelikli kalemi söyler; kalem yoksa sakin durum + bağlantı", () => {
    const items = buildAttentionItems({ ...base, approvals: 1, overdueTasks: 3 });
    expect(heroFocus(items)).toMatchObject({ text: "3 gecikmiş görev", href: "/app/gorevler?filter=overdue", rest: 1 });
    expect(heroFocus([])).toMatchObject({ href: "/app/talepler?status=new", rest: 0 });
  });
});

describe("gelir eğrisi", () => {
  it("ay etiketi Türkçe kısaltma", () => {
    expect(monthShortLabel("2026-10")).toBe("Eki");
    expect(monthShortLabel("2026-01")).toBe("Oca");
  });
  it("hepsi sıfırsa eğri çizilmez", () => {
    expect(revenueSeries(["2026-09", "2026-10"], [0, 0])).toBeNull();
    expect(revenueSeries(["2026-09", "2026-10"], [0, 5])).toEqual([
      { label: "Eyl", value: 0 },
      { label: "Eki", value: 5 },
    ]);
  });
});

describe("ekip", () => {
  it("durum noktası: hedefsiz none, yolunda ok, geride warn, çok geride danger", () => {
    expect(teamStatus(null, 50)).toBe("none");
    expect(teamStatus(45, 50)).toBe("ok");
    expect(teamStatus(25, 60)).toBe("warn");
    expect(teamStatus(5, 60)).toBe("danger");
    expect(teamStatus(100, 100)).toBe("ok");
  });
  it("sıralama anlaşma > teklif > görüşme, sınır uygulanır", () => {
    const r = (id: string, d: number, o: number, c: number) => ({ id, fullName: id, callCount: c, appointCount: 0, offerCount: o, dealCount: d, targetPct: null });
    const ranked = rankTeam([r("a", 1, 5, 9), r("b", 3, 0, 0), r("c", 1, 6, 0), r("d", 1, 5, 20)], 3);
    expect(ranked.map((x) => x.id)).toEqual(["b", "c", "d"]);
  });
});
