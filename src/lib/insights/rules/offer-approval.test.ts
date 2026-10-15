import { describe, expect, it } from "vitest";
import {
  OFFER_EXPIRY_MAX_PER_USER,
  OFFER_EXPIRY_RULE_ID,
  evaluateOfferExpiry,
  evaluateOfferExpiryRun,
  type OfferExpiryFact,
} from "@/lib/insights/rules/offer-expiry";
import {
  APPROVAL_STALE_MAX_PER_USER,
  APPROVAL_STALE_RULE_ID,
  evaluateApprovalStale,
  evaluateApprovalStaleRun,
  type ApprovalDecider,
  type ApprovalStaleFact,
} from "@/lib/insights/rules/approval-stale";
import { INSIGHT_RULES } from "@/lib/insights/rules";

const NOW = Date.parse("2026-10-16T09:00:00Z");
const HOUR = 3_600_000;
const U1 = "00000000-0000-4000-8000-000000000001";
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const GM = "00000000-0000-4000-8000-0000000000b2";
const ADVISOR = "00000000-0000-4000-8000-0000000000c3";

const offer = (over: Partial<OfferExpiryFact> = {}): OfferExpiryFact => ({
  offerId: "o1",
  propertyCode: "EM-1024",
  customerName: "Ayşe Yılmaz",
  amount: 4_250_000,
  currency: "TRY",
  status: "submitted",
  validUntil: "2026-10-18",
  daysLeft: 2,
  advisorId: U1,
  ...over,
});

describe("offer_expiry@1: teklif geçerlilik bitimi", () => {
  it("2 gün kala: danışmana kart, teklif detayına gider, tarihli dedupe", () => {
    const [d] = evaluateOfferExpiry([offer()], NOW);
    expect(d.ruleId).toBe(OFFER_EXPIRY_RULE_ID);
    expect(d.kind).toBe("deadline");
    expect(d.severity).toBe("orta");
    expect(d.title).toContain("2 gün içinde");
    expect(d.title).toContain("EM-1024");
    expect(d.href).toBe("/app/teklifler/o1");
    expect(d.audience).toEqual({ type: "user", userId: U1 });
    expect(d.entityType).toBe("offer");
    expect(d.dedupeKey).toContain("2026-10-18");
    expect(d.evidence.some((e) => e.label === "Tutar" && e.value.includes("₺"))).toBe(true);
    expect(d.isForecast).toBe(false);
  });

  it("bugün ve yarın biten yüksek şiddet; bugün özel başlık", () => {
    const [today] = evaluateOfferExpiry([offer({ daysLeft: 0 })], NOW);
    expect(today.severity).toBe("yuksek");
    expect(today.title).toContain("bugün");
    expect(evaluateOfferExpiry([offer({ daysLeft: 1 })], NOW)[0].severity).toBe("yuksek");
  });

  it("pencere dışı (geçmiş ya da 3 günden uzak) kart üretmez", () => {
    expect(evaluateOfferExpiry([offer({ daysLeft: -1 })], NOW)).toEqual([]);
    expect(evaluateOfferExpiry([offer({ daysLeft: 4 })], NOW)).toEqual([]);
    expect(evaluateOfferExpiry([offer({ daysLeft: 3 })], NOW)).toHaveLength(1);
  });

  it("danışmansız teklif yönetime; alıcı başına tavan, canlı küme tavandan önce", () => {
    expect(evaluateOfferExpiry([offer({ advisorId: null })], NOW)[0].audience).toEqual({ type: "management" });
    const many = Array.from({ length: 8 }, (_, i) => offer({ offerId: `o${i}`, daysLeft: i % 4 }));
    const run = evaluateOfferExpiryRun(many, NOW);
    expect(run.drafts).toHaveLength(OFFER_EXPIRY_MAX_PER_USER);
    expect(run.liveEntityIds?.size).toBe(8);
  });
});

const req = (over: Partial<ApprovalStaleFact> = {}): ApprovalStaleFact => ({
  requestId: "r1",
  kind: "komisyon_indirimi",
  title: "Komisyon %2",
  requestedBy: ADVISOR,
  requesterName: "Mehmet Danışman",
  createdAtMs: NOW - 30 * HOUR,
  ...over,
});
const deciders: ApprovalDecider[] = [
  { id: OWNER, role: "owner" },
  { id: GM, role: "gm" },
];

describe("approval_stale@1: bekleyen onay hatırlatma / yükseltme", () => {
  it("24 saatten yeni talep kart üretmez", () => {
    expect(evaluateApprovalStale([req({ createdAtMs: NOW - 23 * HOUR })], deciders, NOW)).toEqual([]);
  });

  it("24-72 saat: tüm karar vericilere hatırlatma (sahip dahil), onaylar listesine gider", () => {
    const drafts = evaluateApprovalStale([req()], deciders, NOW);
    expect(drafts.map((d) => (d.audience.type === "user" ? d.audience.userId : "")).sort()).toEqual([OWNER, GM].sort());
    for (const d of drafts) {
      expect(d.ruleId).toBe(APPROVAL_STALE_RULE_ID);
      expect(d.severity).toBe("orta");
      expect(d.href).toBe("/app/onaylar?durum=bekliyor");
      expect(d.dedupeKey).toContain("hatirlat");
      expect(d.entityType).toBe("approval_request");
    }
    expect(drafts[0].title).toContain("30 saat");
    expect(drafts[0].evidence.find((e) => e.label === "Tür")?.value).toBe("Komisyon indirimi");
  });

  it("72 saat üstü: sahibe ayrı anahtarlı yükseltme, diğer karar vericilere yüksek şiddetli hatırlatma", () => {
    const drafts = evaluateApprovalStale([req({ createdAtMs: NOW - 80 * HOUR })], deciders, NOW);
    const owner = drafts.filter((d) => d.audience.type === "user" && d.audience.userId === OWNER);
    const gm = drafts.filter((d) => d.audience.type === "user" && d.audience.userId === GM);
    expect(owner).toHaveLength(1);
    expect(owner[0].dedupeKey).toContain("yukselt");
    expect(owner[0].severity).toBe("yuksek");
    expect(owner[0].title).toContain("3 gün");
    expect(gm).toHaveLength(1);
    expect(gm[0].dedupeKey).toContain("hatirlat");
    expect(gm[0].severity).toBe("yuksek");
  });

  it("talep sahibi alıcı değildir (sahibin kendi talebi yükseltilmez)", () => {
    const drafts = evaluateApprovalStale([req({ requestedBy: OWNER, createdAtMs: NOW - 100 * HOUR })], deciders, NOW);
    expect(drafts.every((d) => d.audience.type === "user" && d.audience.userId !== OWNER)).toBe(true);
    expect(drafts).toHaveLength(1);
  });

  it("karar verici yoksa kart ve canlı varlık yok; alıcı başına tavan", () => {
    const empty = evaluateApprovalStaleRun([req()], [], NOW);
    expect(empty.drafts).toEqual([]);
    expect(empty.liveEntityIds?.size).toBe(0);
    const many = Array.from({ length: 9 }, (_, i) => req({ requestId: `r${i}`, createdAtMs: NOW - (25 + i) * HOUR }));
    const run = evaluateApprovalStaleRun(many, [{ id: GM, role: "gm" }], NOW);
    expect(run.drafts).toHaveLength(APPROVAL_STALE_MAX_PER_USER);
    expect(run.liveEntityIds?.size).toBe(9);
  });

  it("iki kural kayıt listesinde, deadline türünde", () => {
    for (const id of [OFFER_EXPIRY_RULE_ID, APPROVAL_STALE_RULE_ID]) {
      const rule = INSIGHT_RULES.find((r) => r.id === id);
      expect(rule?.kind).toBe("deadline");
    }
  });
});
