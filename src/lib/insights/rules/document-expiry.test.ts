import { describe, expect, it } from "vitest";
import {
  DOCUMENT_EXPIRED_MAX_DAYS,
  DOCUMENT_EXPIRY_MAX_PER_USER,
  DOCUMENT_EXPIRY_RULE_ID,
  evaluateDocumentExpiry,
  evaluateDocumentExpiryRun,
  type DocumentExpiryFact,
} from "@/lib/insights/rules/document-expiry";

const NOW = Date.parse("2026-10-16T09:00:00Z");
const U1 = "00000000-0000-4000-8000-000000000001";

const fact = (over: Partial<DocumentExpiryFact> = {}): DocumentExpiryFact => ({
  fileId: "f1",
  customerId: "c1",
  customerName: "Ayşe Yılmaz",
  fileName: "kimlik.pdf",
  label: "Kimlik fotokopisi",
  validUntil: "2026-10-26",
  daysLeft: 10,
  assignedTo: U1,
  ...over,
});

describe("document_expiry@1: belge geçerlilik tarihi", () => {
  it("yaklaşan belge: danışmana kart, kanıt + filtreli hedef + tarihli dedupe", () => {
    const [d] = evaluateDocumentExpiry([fact()], NOW);
    expect(d.ruleId).toBe(DOCUMENT_EXPIRY_RULE_ID);
    expect(d.kind).toBe("deadline");
    expect(d.severity).toBe("bilgi");
    expect(d.title).toContain("10 gün içinde");
    expect(d.title).toContain("Kimlik fotokopisi");
    expect(d.href).toBe("/app/belgeler?gecerlilik=yaklasan");
    expect(d.audience).toEqual({ type: "user", userId: U1 });
    expect(d.entityType).toBe("customer_file");
    expect(d.entityId).toBe("f1");
    expect(d.dedupeKey).toContain("2026-10-26");
    expect(d.isForecast).toBe(false);
  });

  it("şiddet: geçmiş yüksek, ≤7 gün orta; bugün biten özel başlık", () => {
    expect(evaluateDocumentExpiry([fact({ daysLeft: -3 })], NOW)[0].severity).toBe("yuksek");
    expect(evaluateDocumentExpiry([fact({ daysLeft: -3 })], NOW)[0].href).toBe("/app/belgeler?gecerlilik=gecmis");
    expect(evaluateDocumentExpiry([fact({ daysLeft: 7 })], NOW)[0].severity).toBe("orta");
    expect(evaluateDocumentExpiry([fact({ daysLeft: 0 })], NOW)[0].title).toContain("bugün");
  });

  it("pencere dışı: 30 günden uzak ya da 30 günden eski gecikme kart üretmez", () => {
    expect(evaluateDocumentExpiry([fact({ daysLeft: 31 })], NOW)).toEqual([]);
    expect(evaluateDocumentExpiry([fact({ daysLeft: -DOCUMENT_EXPIRED_MAX_DAYS - 1 })], NOW)).toEqual([]);
    expect(evaluateDocumentExpiry([fact({ daysLeft: -DOCUMENT_EXPIRED_MAX_DAYS })], NOW)).toHaveLength(1);
  });

  it("danışmansız müşteri: yönetime gider; alıcı başına tavan ve canlı küme tavandan önce", () => {
    expect(evaluateDocumentExpiry([fact({ assignedTo: null })], NOW)[0].audience).toEqual({ type: "management" });
    const many = Array.from({ length: 8 }, (_, i) => fact({ fileId: `f${i}`, daysLeft: 20 - i }));
    const run = evaluateDocumentExpiryRun(many, NOW);
    expect(run.drafts).toHaveLength(DOCUMENT_EXPIRY_MAX_PER_USER);
    expect(run.drafts[0].urgencyDays).toBe(13);
    expect(run.liveEntityIds?.size).toBe(8);
    const mgmt = evaluateDocumentExpiryRun(many.map((f) => ({ ...f, assignedTo: null })), NOW);
    expect(mgmt.drafts).toHaveLength(DOCUMENT_EXPIRY_MAX_PER_USER);
  });
});
