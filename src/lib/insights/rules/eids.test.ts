import { describe, expect, it } from "vitest";
import type { EidsPropertyFact } from "@/lib/insights/eids-facts";
import { evaluateEidsRevokedStillLive, EIDS_REVOKED_LIVE_RULE_ID } from "@/lib/insights/rules/eids-revoked-still-live";
import { evaluateEidsUnknownLive } from "@/lib/insights/rules/eids-unknown-live";
import { evaluateEidsNoEmailSeen } from "@/lib/insights/rules/eids-no-email-seen";
import { evaluateEidsMailSilent } from "@/lib/insights/rules/eids-mail-silent";
import { INSIGHT_RULES } from "@/lib/insights/rules";

const NOW = Date.UTC(2026, 9, 13, 9, 0, 0);
const DAY = 86_400_000;
const TODAY = "2026-10-13";
const U1 = "11111111-1111-4111-8111-111111111111";
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const fact = (over: Partial<EidsPropertyFact> = {}): EidsPropertyFact => ({
  propertyId: "p1",
  assignedTo: U1,
  label: "Kadıköy 2+1",
  status: "live",
  eidsStatus: "approved",
  eidsNo: "123456789",
  authorizationEnd: "2027-06-01",
  approvedAt: iso(30 * DAY),
  lastConfirmationAt: iso(30 * DAY),
  liveListings: 1,
  ...over,
});

describe("eids_revoked_still_live@1", () => {
  it("iptal edilmiş ve portalda canlı: yüksek şiddet, danışmana", () => {
    const { drafts, liveEntityIds } = evaluateEidsRevokedStillLive([fact({ eidsStatus: "revoked" })], TODAY, NOW);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].ruleId).toBe(EIDS_REVOKED_LIVE_RULE_ID);
    expect(drafts[0].severity).toBe("yuksek");
    expect(drafts[0].why).toContain("14/2-h");
    expect(drafts[0].audience).toEqual({ type: "user", userId: U1 });
    expect(liveEntityIds?.has("p1")).toBe(true);
  });
  it("bitiş tarihi geçmiş de yakalanır; canlı kayıt yoksa ya da yetki geçerliyse kart yok", () => {
    expect(evaluateEidsRevokedStillLive([fact({ authorizationEnd: "2026-10-01" })], TODAY, NOW).drafts).toHaveLength(1);
    expect(evaluateEidsRevokedStillLive([fact({ eidsStatus: "revoked", liveListings: 0 })], TODAY, NOW).drafts).toHaveLength(0);
    expect(evaluateEidsRevokedStillLive([fact()], TODAY, NOW).drafts).toHaveLength(0);
  });
});

describe("eids_unknown_live@1", () => {
  it("durum bilinmiyor ya da no yok + canlı", () => {
    expect(evaluateEidsUnknownLive([fact({ eidsStatus: null })], NOW).drafts).toHaveLength(1);
    expect(evaluateEidsUnknownLive([fact({ eidsStatus: "unknown" })], NOW).drafts).toHaveLength(1);
    expect(evaluateEidsUnknownLive([fact({ eidsNo: null })], NOW).drafts[0].title).toContain("taşınmaz no");
  });
  it("canlı değilse ya da iptal/dolmuşsa (öteki kural) kart yok", () => {
    expect(evaluateEidsUnknownLive([fact({ eidsStatus: null, liveListings: 0 })], NOW).drafts).toHaveLength(0);
    expect(evaluateEidsUnknownLive([fact({ eidsStatus: "revoked", eidsNo: null })], NOW).drafts).toHaveLength(0);
    expect(evaluateEidsUnknownLive([fact()], NOW).drafts).toHaveLength(0);
  });
});

describe("eids_no_email_seen@1", () => {
  it("onaylı + 120 gündür teyit yok", () => {
    const d = evaluateEidsNoEmailSeen([fact({ lastConfirmationAt: iso(130 * DAY), approvedAt: iso(200 * DAY) })], NOW).drafts;
    expect(d).toHaveLength(1);
    expect(d[0].title).toContain("130 gündür");
  });
  it("teyit hiç yoksa onay tarihi esas; yeni onay ve onaysız durum kart üretmez", () => {
    expect(evaluateEidsNoEmailSeen([fact({ lastConfirmationAt: null, approvedAt: iso(121 * DAY) })], NOW).drafts).toHaveLength(1);
    expect(evaluateEidsNoEmailSeen([fact({ lastConfirmationAt: null, approvedAt: iso(30 * DAY) })], NOW).drafts).toHaveLength(0);
    expect(evaluateEidsNoEmailSeen([fact({ eidsStatus: "pending", lastConfirmationAt: iso(300 * DAY) })], NOW).drafts).toHaveLength(0);
    expect(evaluateEidsNoEmailSeen([fact({ status: "draft", liveListings: 0, lastConfirmationAt: iso(300 * DAY) })], NOW).drafts).toHaveLength(0);
  });
});

describe("eids_mail_silent@1", () => {
  it("90 gün sessiz + 3 elle yetki: yönetime tek kart", () => {
    const d = evaluateEidsMailSilent({ addressCreatedAt: iso(200 * DAY), lastReceivedAt: iso(95 * DAY), manualGrants90d: 3 }, NOW);
    expect(d).toHaveLength(1);
    expect(d[0].audience).toEqual({ type: "management" });
    expect(d[0].href).toBe("/app/ayarlar?sekme=entegrasyon");
  });
  it("adres yok, yeni adres, az elle giriş ya da yakın e-posta: kart yok", () => {
    expect(evaluateEidsMailSilent(null, NOW)).toHaveLength(0);
    expect(evaluateEidsMailSilent({ addressCreatedAt: iso(20 * DAY), lastReceivedAt: null, manualGrants90d: 9 }, NOW)).toHaveLength(0);
    expect(evaluateEidsMailSilent({ addressCreatedAt: iso(200 * DAY), lastReceivedAt: null, manualGrants90d: 2 }, NOW)).toHaveLength(0);
    expect(evaluateEidsMailSilent({ addressCreatedAt: iso(200 * DAY), lastReceivedAt: iso(10 * DAY), manualGrants90d: 9 }, NOW)).toHaveLength(0);
  });
});

describe("kayıt", () => {
  it("dört kural kayıt listesinde ve Türkçe adlı", () => {
    const ids = INSIGHT_RULES.map((r) => r.id);
    for (const id of ["eids_revoked_still_live@1", "eids_unknown_live@1", "eids_no_email_seen@1", "eids_mail_silent@1"]) {
      expect(ids).toContain(id);
    }
  });
});
