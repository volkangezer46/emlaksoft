import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  consentCandidateIds,
  describeMatchBulkPlan,
  MATCH_BULK_SEND_CAP,
  planMatchBulkSend,
  strictIysAllowedIds,
  type MatchBulkRecipient,
} from "./match-bulk-send";

const r = (i: number, over: Partial<MatchBulkRecipient> = {}): MatchBulkRecipient => ({
  demandId: `d${i}`,
  customerId: `c${i}`,
  fullName: `Müşteri ${i}`,
  phone: `0532123${String(i).padStart(4, "0")}`,
  blacklist: false,
  isSample: false,
  ...over,
});

describe("eşleşme toplu gönderim planı", () => {
  it("engelli / örnek / telefonsuz / müşterisiz / tekrar müşteri ayıklanır, sıra korunur", () => {
    const list = [r(1), r(2, { blacklist: true }), r(3, { isSample: true }), r(4, { phone: null }), r(5, { phone: "123" }), r(6, { customerId: null }), r(7, { demandId: "d7b", customerId: "c1" }), r(8)];
    const plan = planMatchBulkSend(list, null);
    expect(plan.send.map((x) => x.customerId)).toEqual(["c1", "c8"]);
    expect(plan.counts).toEqual({ no_customer: 1, duplicate: 1, already_sent: 0, blacklist: 1, sample: 1, no_phone: 2, no_consent: 0 });
    expect(consentCandidateIds(list)).toEqual(["c1", "c8"]);
  });

  it("İYS izni olmayan atlanır ve 'izni yok' sayılır", () => {
    const plan = planMatchBulkSend([r(1), r(2), r(3)], new Set(["c2"]));
    expect(plan.send.map((x) => x.customerId)).toEqual(["c2"]);
    expect(plan.counts.no_consent).toBe(2);
  });

  it("tavan: en fazla cap kişi gönderilir, fazlası raporlanır", () => {
    const list = Array.from({ length: MATCH_BULK_SEND_CAP + 7 }, (_, i) => r(i + 1));
    const plan = planMatchBulkSend(list, new Set(list.map((x) => x.customerId as string)), MATCH_BULK_SEND_CAP);
    expect(plan.send).toHaveLength(MATCH_BULK_SEND_CAP);
    expect(plan.overCap).toHaveLength(7);
    expect(plan.send[0].customerId).toBe("c1");
  });

  it("katı İYS: 'yalnız uyar' modunda uyarılan alıcı izinsiz sayılır", () => {
    const allowed = strictIysAllowedIds({ allowed: ["a", "b", "c"], warned: [{ customerId: "b", reason: "no_record" }] });
    expect([...allowed]).toEqual(["a", "c"]);
    expect([...strictIysAllowedIds({ allowed: ["a"] })]).toEqual(["a"]);
  });

  it("onay metni gönderilecek ve izni yok sayısını her zaman gösterir", () => {
    const text = describeMatchBulkPlan({ send: 3, overCap: 0, counts: { no_customer: 0, duplicate: 0, already_sent: 0, blacklist: 1, sample: 0, no_phone: 0, no_consent: 2 } });
    expect(text).toContain("Gönderilecek: 3");
    expect(text).toContain("İzni yok: 2");
    expect(text).toContain("İletişim engelli: 1");
    expect(text).not.toContain("Tavan");
  });
});

describe("toplu gönderim eylemi sözleşmesi", () => {
  const src = readFileSync("src/app/actions/matching-bulk.ts", "utf8");
  it("tekil gönderimle aynı kapılar, paylaşım yardımcısı ve denetim kaydı", () => {
    expect(src).toContain('requirePermission("matching", "create")');
    expect(src).toContain('requirePermission("properties", "edit")');
    expect(src).toContain("insertPropertyShareLink(");
    expect(src).toContain("buildMatchShareMessage(");
    expect(src).toContain('action: "match.sent"');
    expect(src).toContain('action: "match.bulk_sent"');
    expect(src).toMatch(/\.eq\("tenant_id", gate\.tenantId\)/);
  });
  it("İYS kapısı (bulk_message, katı) gönderimden önce, tavanla sıralı gönderim", () => {
    expect(src).toContain('kind: "bulk_message"');
    expect(src).toContain("strictIysAllowedIds(");
    expect(src.indexOf("gateIysRecipients(")).toBeLessThan(src.indexOf("await sender("));
    expect(src).toContain("MATCH_BULK_SEND_CAP");
    expect(src).not.toContain("Promise.all(planned.plan.send");
  });
  it("eşleştirme ekranı yalnız tek portföy süzgecinde 'Tümüne gönder' çizer", () => {
    const view = readFileSync("src/app/app/talepler/matching-view.tsx", "utf8");
    expect(view).toContain("<BulkSendMatches");
    expect(view).toMatch(/bulkDemandIds\.length > 0 && propertyF/);
    const ui = readFileSync("src/app/app/talepler/bulk-send-matches.tsx", "utf8");
    expect(ui).toContain("previewBulkMatchSend(");
    expect(ui).toContain("<ConfirmDialog");
    expect(ui).toContain("Tümüne gönder (");
  });
});

describe("planMatchBulkSend: daha önce gönderilen (CRM-G4)", () => {
  it("alreadySent alıcı atlanır ve sayılır", () => {
    const plan = planMatchBulkSend(
      [
        { demandId: "d1", customerId: "c1", fullName: "A", phone: "05321234567", blacklist: false, isSample: false, alreadySent: true },
        { demandId: "d2", customerId: "c2", fullName: "B", phone: "05321234568", blacklist: false, isSample: false },
      ],
      null,
    );
    expect(plan.send.map((r) => r.customerId)).toEqual(["c2"]);
    expect(plan.counts.already_sent).toBe(1);
  });
});
