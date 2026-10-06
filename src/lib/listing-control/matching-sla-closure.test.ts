import { describe, expect, it } from "vitest";
import { normalizeUrlKey, rankCandidates, scoreMatch, type MatchProbe } from "./matching";
import { leakSeverity, planSlaEscalation, slaNotificationKind } from "./sla-plan";
import { evaluateClosureChecklist, suggestCrmClosure, validateExplanation, type ClosureFacts } from "./closure-checklist";
import { buildChainStats, unionMs } from "./chain";
import { compareInventory } from "./bulk-mismatch";
import { aggregateMarketSignals, type MarketSignalRow } from "./market-signals";
import { normalizeListingControlConfig } from "./config";

describe("eşleştirme güveni", () => {
  const prop: MatchProbe = { address: "Atatürk Mahallesi Gül Sokak No 5 Kadıköy", title: "Kadıköy 3+1 daire", price: 5_000_000, sqm: 120, rooms: "3+1", block: "101", lot: "7", districtKey: "kadikoy" };

  it("ilan no ya da URL birebir → kesin eşleşme 100", () => {
    expect(scoreMatch({ portal: "sahibinden", externalId: "123456" }, { portal: "Sahibinden", externalId: " 123456 " })).toMatchObject({ score: 100, decisive: true });
    expect(scoreMatch({ url: "https://www.sahibinden.com/ilan/x-1/detay?a=1" }, { url: "http://sahibinden.com/ilan/x-1/detay/" }).score).toBe(100);
    expect(normalizeUrlKey("not a url")).toBeNull();
  });

  it("farklı portalda aynı ilan no kesin eşleşme SAYILMAZ", () => {
    expect(scoreMatch({ portal: "sahibinden", externalId: "123456" }, { portal: "emlakjet", externalId: "123456" }).decisive).toBe(false);
  });

  it("benzer ilan yüksek, farklı ilan düşük skor; sinyaller açıklanır", () => {
    const same = scoreMatch(prop, { ...prop, price: 5_050_000, sqm: 121 });
    expect(same.score).toBeGreaterThanOrEqual(90);
    expect(same.signals.map((s) => s.key)).toContain("parcel");
    const other = scoreMatch(prop, { address: "Bağdat Caddesi 99 Maltepe", title: "Maltepe villa", price: 12_000_000, sqm: 300, rooms: "5+2", block: "5", lot: "1", districtKey: "maltepe" });
    expect(other.score).toBeLessThan(30);
  });

  it("yetersiz ölçüm güvenilir skor üretmez (ölçülemedi)", () => {
    const r = scoreMatch({ price: 1_000_000 }, { price: 1_000_000 });
    expect(r.score).toBe(0);
    expect(r.unmeasured).toContain("address");
  });

  it("fotoğraf benzerliği sağlayıcı arayüzü takılabilir", () => {
    const withPhoto = scoreMatch(prop, { ...prop, price: 9_000_000 }, { photoSimilarity: () => 1 });
    const without = scoreMatch(prop, { ...prop, price: 9_000_000 });
    expect(withPhoto.signals.some((s) => s.key === "photo")).toBe(true);
    expect(without.signals.some((s) => s.key === "photo")).toBe(false);
  });

  it("adaylar skora göre sıralanır, eşik altı atılır", () => {
    const ranked = rankCandidates(prop, [
      { id: "a", probe: { ...prop, price: 5_100_000 } },
      { id: "b", probe: { address: "Başka", title: "Başka", price: 1, sqm: 10, rooms: "1+0" } },
    ]);
    expect(ranked.map((r) => r.candidate.id)).toEqual(["a"]);
  });
});

describe("SLA yükseltme", () => {
  const opened = Date.parse("2026-03-10T08:00:00.000Z");
  const h = (n: number) => opened + n * 3_600_000;
  const recipients = { advisorId: "adv", teamLeadId: "tl", branchManagerId: "bm", ownerIds: ["own1", "own2"] };

  it("0 saat danışman, 4 takım lideri, 8 şube müdürü, 24 ofis sahibi", () => {
    const plan = (n: number, fired: number[] = []) => planSlaEscalation({ openedAtMs: opened, nowMs: h(n), firedStages: fired, recipients }).map((d) => d.stage);
    expect(plan(0)).toEqual([1]);
    expect(plan(3.9, [1])).toEqual([]);
    expect(plan(4, [1])).toEqual([2]);
    expect(plan(9, [1, 2])).toEqual([3]);
    expect(plan(25, [1, 2, 3])).toEqual([4]);
    expect(plan(25)).toEqual([1, 2, 3, 4]);
  });

  it("aynı aşama tekrar bildirilmez (tetiklenmiş aşamalar atlanır)", () => {
    expect(planSlaEscalation({ openedAtMs: opened, nowMs: h(100), firedStages: [1, 2, 3, 4], recipients })).toEqual([]);
  });

  it("alıcı yoksa aşama deliver=false döner (kayıt düşer, bildirim yok); sahip için tüm sahipler", () => {
    const d = planSlaEscalation({ openedAtMs: opened, nowMs: h(30), firedStages: [1], recipients: { ...recipients, teamLeadId: null } });
    expect(d.find((x) => x.stage === 2)).toMatchObject({ deliver: false, recipientIds: [] });
    expect(d.find((x) => x.stage === 4)?.recipientIds).toEqual(["own1", "own2"]);
  });

  it("süreler ofis ayarlıdır", () => {
    const sla = normalizeListingControlConfig({ sla: { teamLeadHours: 1, branchManagerHours: 2, ownerHours: 3 } }).sla;
    expect(planSlaEscalation({ openedAtMs: opened, nowMs: h(2), firedStages: [1], recipients, sla }).map((d) => d.stage)).toEqual([2, 3]);
  });

  it("bildirim önem düzeyi aşamayla yükselir", () => {
    expect(slaNotificationKind(1, "medium")).toBe("info");
    expect(slaNotificationKind(2, "medium")).toBe("warning");
    expect(slaNotificationKind(4, "low")).toBe("danger");
    expect(slaNotificationKind(1, "critical")).toBe("danger");
  });

  it("leak-sla önem derecesi davranışı değişmedi (taşınan eşikler)", () => {
    expect(leakSeverity(600_000, 30)).toBe("critical");
    expect(leakSeverity(400_000, 14)).toBe("high");
    expect(leakSeverity(150_000, 7)).toBe("medium");
    expect(leakSeverity(null, 99)).toBe("low");
  });
});

describe("kapanış kontrol listesi ve açıklama", () => {
  const full: ClosureFacts = {
    exitKind: "sold", portalsRemoved: true, hasReasonRecorded: true, dealRecorded: true, finalPriceRecorded: true, commissionRecorded: true,
    closedDateRecorded: true, counterpartyRecorded: true, contractRecorded: true, collectionRecorded: true, documentsComplete: true,
  };

  it("satışta tüm zorunlu maddeler tamam → complete", () => {
    expect(evaluateClosureChecklist(full)).toMatchObject({ complete: true, percent: 100, missing: [] });
  });

  it("eksik madde listelenir; ölçülemeyen eksik sayılmaz ama complete olmaz", () => {
    const r = evaluateClosureChecklist({ ...full, commissionRecorded: false, contractRecorded: null });
    expect(r.missing).toEqual(["Komisyon kaydı"]);
    expect(r.unmeasured).toEqual(["Sözleşme"]);
    expect(r.complete).toBe(false);
    expect(r.percent).toBe(80);
  });

  it("iptal/vazgeçme gibi çıkışlarda yalnız portal kaldırma + neden zorunlu", () => {
    const r = evaluateClosureChecklist({ ...full, exitKind: "owner_withdrew", dealRecorded: false, commissionRecorded: false });
    expect(r.complete).toBe(true);
    expect(r.items.filter((i) => i.required).map((i) => i.key)).toEqual(["portals_removed", "reason"]);
  });

  it("'Satıldı/Kiralandı' CRM kapanışı ÖNERİR (otomatik değil)", () => {
    expect(suggestCrmClosure("sold")).toMatchObject({ suggest: true, kind: "sold" });
    expect(suggestCrmClosure("rented").kind).toBe("rented");
    expect(suggestCrmClosure("mistake")).toEqual({ suggest: false, kind: null, label: null });
  });

  it("açıklama zorunlu: kodlu neden; 'diğer' için not", () => {
    expect(validateExplanation("", null)).toMatchObject({ ok: false });
    expect(validateExplanation("uydurma", null)).toMatchObject({ ok: false });
    expect(validateExplanation("other", " ")).toMatchObject({ ok: false });
    expect(validateExplanation("other", "Mal sahibi aradı")).toMatchObject({ ok: true, reason: "other" });
    expect(validateExplanation("sold", null)).toEqual({ ok: true, reason: "sold", note: null });
    expect(validateExplanation("sold", "x".repeat(501))).toMatchObject({ ok: false });
  });
});

describe("ilan no zinciri ve toplam yayın süresi", () => {
  const D = 86_400_000;
  const T = Date.parse("2026-01-01T00:00:00Z");
  const iso = (d: number) => new Date(T + d * D).toISOString();

  it("birleşim: örtüşen aralıklar iki kez sayılmaz", () => {
    expect(unionMs([[0, 10 * D], [5 * D, 15 * D], [20 * D, 25 * D]])).toBe(20 * D);
    expect(unionMs([])).toBe(0);
  });

  it("ilan no değişimi: zincir, id değişim sayısı ve toplam gün", () => {
    const stats = buildChainStats(
      [
        { id: "a", portal: "sahibinden", externalId: "1", status: "superseded", publishedAt: iso(0), removedAt: iso(10), supersedesId: null },
        { id: "b", portal: "sahibinden", externalId: "2", status: "live", publishedAt: iso(10), removedAt: null, supersedesId: "a" },
        { id: "c", portal: "emlakjet", externalId: "9", status: "removed", publishedAt: iso(2), removedAt: iso(4), supersedesId: null },
      ],
      T + 30 * D,
    );
    const s = stats.find((x) => x.portal === "sahibinden")!;
    expect(s.idChanges).toBe(1);
    expect(s.totalPublishedDays).toBe(30);
    expect(s.currentLiveId).toBe("b");
    expect(stats.find((x) => x.portal === "emlakjet")!.totalPublishedDays).toBe(2);
  });
});

describe("toplu uyuşmazlık kırılımı", () => {
  const crm = [
    { listingId: "l1", propertyId: "p1", externalId: "100", price: 1 },
    { listingId: "l2", propertyId: "p2", externalId: "200", price: 1 },
    { listingId: "l3", propertyId: "p3", externalId: null, price: 1 },
  ];
  it("CRM 3 vs portal 2: eksik, kayıtsız ve ilan no'suz ayrı sayılır", () => {
    const r = compareInventory("sahibinden", crm, [{ externalId: "100", price: 1 }, { externalId: "999", price: 1 }], true)!;
    expect(r.difference).toBe(1);
    expect(r.missingOnPortal.map((x) => x.listingId)).toEqual(["l2"]);
    expect(r.unregisteredOnPortal.map((x) => x.externalId)).toEqual(["999"]);
    expect(r.crmWithoutExternalId.map((x) => x.listingId)).toEqual(["l3"]);
  });
  it("envanter yok ya da bayatsa sonuç üretilmez", () => {
    expect(compareInventory("x", crm, null, true)).toBeNull();
    expect(compareInventory("x", crm, [], false)).toBeNull();
  });
});

describe("Emlakfiyati agregat hazırlığı (k-anonimlik)", () => {
  const row = (tenantId: string, over: Partial<MarketSignalRow> = {}): MarketSignalRow => ({
    tenantId, districtId: "d1", propertyType: "daire", transactionType: "satilik", publishedMonth: "2026-01-01",
    publishedDays: 30, priceChangeCount: 1, priceDeltaPct: -5, outcome: "sold", daysToOutcome: 40, ...over,
  });
  it("k altındaki hücre atılır; çıktıda ofis kimliği yoktur", () => {
    const four = [row("t1"), row("t1"), row("t2"), row("t2")];
    expect(aggregateMarketSignals(four)).toEqual([]);
    const five = [...four, row("t3", { publishedDays: 90, priceDeltaPct: 12, outcome: "open_or_exited", daysToOutcome: null })];
    const cells = aggregateMarketSignals(five);
    expect(cells).toHaveLength(1);
    expect(JSON.stringify(cells)).not.toMatch(/t1|t2|t3|tenant/i);
    expect(cells[0]).toMatchObject({ listings: 5, medianPublishedDays: 30, closedCount: 4, medianDaysToOutcome: null });
    expect(cells[0].priceDeltaBands.down_0_10).toBe(4);
    expect(cells[0].priceDeltaBands.up_over_10).toBe(1);
  });
  it("yalnız opt-in ofisler ve asgari ofis sayısı", () => {
    const rows = Array.from({ length: 6 }, (_, i) => row(i < 3 ? "t1" : "t2"));
    expect(aggregateMarketSignals(rows, { optedInTenantIds: new Set(["t1"]) })).toEqual([]);
    expect(aggregateMarketSignals(rows, { minTenants: 3 })).toEqual([]);
    expect(aggregateMarketSignals(rows, { minTenants: 2 })).toHaveLength(1);
  });
});
