import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/clock";
import {
  evaluateFsboAging,
  evaluateFsboClaimExpiring,
  evaluateFsboFollowupDue,
  evaluateFsboPriceDrop,
  evaluateFsboRelisted,
  evaluateFsboUncalled,
  type FsboFact,
} from "./prospecting";
import { INSIGHT_RULES } from "./index";

const NOW = Date.UTC(2026, 9, 12, 9, 0, 0);
const fact = (over: Partial<FsboFact> = {}): FsboFact => ({
  id: "11111111-1111-4111-8111-111111111111",
  assignedTo: "22222222-2222-4222-8222-222222222222",
  assigneeName: "Ayşe Demir",
  status: "yeni",
  contactAttempts: 0,
  firstSeenMs: NOW - 2 * DAY_MS,
  listedAtMs: null,
  lastContactMs: null,
  nextActionMs: NOW - DAY_MS,
  lastPriceDropMs: null,
  lastPriceDropPct: null,
  relistOf: null,
  createdMs: NOW - 2 * DAY_MS,
  claimExpiresMs: null,
  districtName: "Kadıköy",
  rooms: "3+1",
  ...over,
});

const PII = /\d{10,}|@|\bTC\b/;

describe("sahibinden ilan içgörü kuralları", () => {
  it("veri yoksa kart yok", () => {
    for (const fn of [evaluateFsboUncalled, evaluateFsboFollowupDue, evaluateFsboPriceDrop, evaluateFsboRelisted, evaluateFsboAging, evaluateFsboClaimExpiring]) {
      expect(fn([], NOW).drafts).toEqual([]);
    }
  });

  it("fsbo_uncalled: kayıttan beri aranmayan yeni ilanlar danışman başına tek kart; 3 gün yüksek önem", () => {
    const run = evaluateFsboUncalled([fact(), fact({ id: "b", firstSeenMs: NOW - 4 * DAY_MS }), fact({ id: "c", firstSeenMs: NOW - 1000 })], NOW);
    expect(run.drafts).toHaveLength(1);
    expect(run.drafts[0]).toMatchObject({ ruleId: "fsbo_uncalled@1", kind: "call_priority", severity: "yuksek", href: "/app/portfoy-avi?durum=yeni&aranmadi=1" });
    expect(run.drafts[0].title).toContain("2 sahibinden ilan");
    expect(run.liveEntityIds?.has("22222222-2222-4222-8222-222222222222")).toBe(true);
  });

  it("fsbo_followup_due: tekrar arama günü gelen açık ilanlar; hiç aranmamışlar bu kurala girmez", () => {
    expect(evaluateFsboFollowupDue([fact({ contactAttempts: 0 })], NOW).drafts).toEqual([]);
    const run = evaluateFsboFollowupDue([fact({ contactAttempts: 1, status: "arandi" }), fact({ id: "b", contactAttempts: 2, status: "arandi", nextActionMs: NOW + DAY_MS })], NOW);
    expect(run.drafts).toHaveLength(1);
    expect(run.drafts[0]).toMatchObject({ ruleId: "fsbo_followup_due@1", href: "/app/portfoy-avi?gorunum=bugun" });
  });

  it("fsbo_price_drop: son 7 günde düşen ilan; temas kurulmuşsa ya da eskiyse kart yok", () => {
    const f = fact({ lastPriceDropMs: NOW - 2 * DAY_MS, lastPriceDropPct: 5.4 });
    const run = evaluateFsboPriceDrop([f], NOW);
    expect(run.drafts).toHaveLength(1);
    expect(run.drafts[0].title).toBe("Kadıköy 3+1 ilanında fiyat %5 düştü");
    expect(run.drafts[0].entityId).toBe(f.id);
    expect(evaluateFsboPriceDrop([{ ...f, lastContactMs: NOW - DAY_MS }], NOW).drafts).toEqual([]);
    expect(evaluateFsboPriceDrop([{ ...f, lastPriceDropMs: NOW - 9 * DAY_MS }], NOW).drafts).toEqual([]);
    expect(evaluateFsboPriceDrop([{ ...f, status: "randevu" }], NOW).drafts).toEqual([]);
  });

  it("fsbo_relisted: yeniden yayına çıkan ve henüz aranmayan kayıt, ilan sayfasına gider", () => {
    const f = fact({ relistOf: "99999999-9999-4999-8999-999999999999" });
    const run = evaluateFsboRelisted([f], NOW);
    expect(run.drafts[0]).toMatchObject({ ruleId: "fsbo_relisted@1", href: `/app/portfoy-avi/${f.id}`, title: "Önceden kaybettiğiniz ilan yeniden yayında" });
    expect(evaluateFsboRelisted([fact()], NOW).drafts).toEqual([]);
  });

  it("fsbo_aging: 45+ gün, arandı durumunda, son temas 14+ gün önce", () => {
    const old = fact({ status: "arandi", contactAttempts: 2, firstSeenMs: NOW - 50 * DAY_MS, lastContactMs: NOW - 20 * DAY_MS });
    expect(evaluateFsboAging([old], NOW).drafts[0]).toMatchObject({ ruleId: "fsbo_aging@1", href: "/app/portfoy-avi?yas=45&durum=arandi" });
    expect(evaluateFsboAging([{ ...old, lastContactMs: NOW - 3 * DAY_MS }], NOW).drafts).toEqual([]);
    expect(evaluateFsboAging([{ ...old, firstSeenMs: NOW - 10 * DAY_MS }], NOW).drafts).toEqual([]);
  });

  it("fsbo_claim_expiring: yöneticiye, 2 gün içinde düşecek sahiplik", () => {
    const f = fact({ claimExpiresMs: NOW + DAY_MS });
    const d = evaluateFsboClaimExpiring([f], NOW).drafts[0];
    expect(d.audience).toEqual({ type: "management" });
    expect(d.title).toContain("Ayşe Demir");
    expect(evaluateFsboClaimExpiring([fact({ claimExpiresMs: NOW + 5 * DAY_MS })], NOW).drafts).toEqual([]);
  });

  it("her kartın href'i filtrelenmiş hedeftir, kanıt/başlıkta telefon-ad-kimlik verisi yoktur", () => {
    const facts = [
      fact({ contactAttempts: 1, status: "arandi" }),
      fact({ id: "p", lastPriceDropMs: NOW - DAY_MS, lastPriceDropPct: 6 }),
      fact({ id: "r", relistOf: "x" }),
      fact({ id: "g", status: "arandi", firstSeenMs: NOW - 60 * DAY_MS }),
      fact({ id: "c", claimExpiresMs: NOW + DAY_MS }),
    ];
    const all = [evaluateFsboUncalled, evaluateFsboFollowupDue, evaluateFsboPriceDrop, evaluateFsboRelisted, evaluateFsboAging, evaluateFsboClaimExpiring].flatMap((fn) => fn(facts, NOW).drafts);
    expect(all.length).toBeGreaterThanOrEqual(5);
    for (const d of all) {
      expect(d.href.startsWith("/app/portfoy-avi")).toBe(true);
      expect(d.validUntilMs).toBeGreaterThan(NOW);
      expect(`${d.title} ${d.why} ${d.evidence.map((e) => `${e.label} ${e.value}`).join(" ")}`).not.toMatch(PII);
    }
  });

  it("kural kayıt listesinde: altı kural, hepsi call_priority (yeni tür/migration gerekmez)", () => {
    const ids = INSIGHT_RULES.filter((r) => r.id.startsWith("fsbo_")).map((r) => r.id);
    expect(ids.sort()).toEqual(["fsbo_aging@1", "fsbo_claim_expiring@1", "fsbo_followup_due@1", "fsbo_price_drop@1", "fsbo_relisted@1", "fsbo_uncalled@1"]);
    for (const r of INSIGHT_RULES.filter((x) => x.id.startsWith("fsbo_"))) expect(r.kind).toBe("call_priority");
  });
});
