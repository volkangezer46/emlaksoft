import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/clock";
import { canVoteOn, npsCategory, npsEligible, npsPending, requestVisibleTo, summarizeNps, validateRequestInput, type NpsShownRow } from "./model";

const NOW = Date.parse("2026-10-14T09:00:00.000Z");
const ago = (days: number) => new Date(NOW - days * DAY_MS).toISOString();

describe("NPS sıklık sınırı", () => {
  it("hiç gösterilmeyen kullanıcıya sorulur", () => {
    expect(npsEligible(null, NOW, 90)).toBe(true);
  });

  it("ayardaki aralık dolmadan yeniden sorulmaz; dolunca sorulur", () => {
    expect(npsEligible(ago(1), NOW, 90)).toBe(false);
    expect(npsEligible(ago(89.9), NOW, 90)).toBe(false);
    expect(npsEligible(ago(90), NOW, 90)).toBe(true);
    expect(npsEligible(ago(8), NOW, 7)).toBe(true);
    expect(npsEligible(ago(6), NOW, 7)).toBe(false);
  });

  it("365 günlük pencerede 90 günlük ayarla en fazla 5 gösterim (günlük ziyaret simülasyonu)", () => {
    let last: string | null = null;
    let shown = 0;
    for (let d = 0; d < 365; d++) {
      const t = NOW + d * DAY_MS;
      if (npsEligible(last, t, 90)) {
        shown++;
        last = new Date(t).toISOString();
      }
    }
    expect(shown).toBe(5); // 0, 90, 180, 270, 360. gün
  });
});

describe("NPS bekleyen gösterim", () => {
  const row = (over: Partial<NpsShownRow> = {}): NpsShownRow => ({ survey_id: "s", shown_at: new Date(NOW - 3_600_000).toISOString(), score: null, dismissed_at: null, ...over });

  it("yanıtsız ve kapatılmamış son gösterim 24 saat boyunca açık kalır", () => {
    expect(npsPending(row(), NOW)).toBe(true);
    expect(npsPending(row({ shown_at: new Date(NOW - 25 * 3_600_000).toISOString() }), NOW)).toBe(false);
  });

  it("yanıtlanan ya da kapatılan anket yeniden gösterilmez", () => {
    expect(npsPending(row({ score: 8 }), NOW)).toBe(false);
    expect(npsPending(row({ dismissed_at: new Date(NOW).toISOString() }), NOW)).toBe(false);
    expect(npsPending(null, NOW)).toBe(false);
  });
});

describe("NPS puanı", () => {
  it("kategori sınırları 0-6 / 7-8 / 9-10", () => {
    expect(npsCategory(6)).toBe("detractor");
    expect(npsCategory(7)).toBe("passive");
    expect(npsCategory(8)).toBe("passive");
    expect(npsCategory(9)).toBe("promoter");
  });

  it("NPS = destekçi% − eleştiren%; yanıt yoksa skor yok", () => {
    expect(summarizeNps([]).nps).toBeNull();
    const s = summarizeNps([10, 9, 9, 8, 7, 3, 0, 11, -1]);
    expect(s.responses).toBe(7);
    expect(s.promoters).toBe(3);
    expect(s.detractors).toBe(2);
    expect(s.nps).toBe(Math.round(((3 - 2) / 7) * 100));
    expect(s.distribution[9]).toBe(2);
  });
});

describe("özellik istek panosu görünürlüğü", () => {
  const A = "a";
  const B = "b";

  it("yeni ve reddedilen öneri yalnız öneren ofise görünür; açık durumlar herkese", () => {
    expect(requestVisibleTo({ status: "yeni", tenant_id: A }, A)).toBe(true);
    expect(requestVisibleTo({ status: "yeni", tenant_id: A }, B)).toBe(false);
    expect(requestVisibleTo({ status: "reddedildi", tenant_id: A }, B)).toBe(false);
    expect(requestVisibleTo({ status: "planlandi", tenant_id: A }, B)).toBe(true);
  });

  it("yayındaki öneriye oy verilmez; başka ofisin incelemedeki önerisine de", () => {
    expect(canVoteOn({ status: "yayinda", tenant_id: A }, B)).toBe(false);
    expect(canVoteOn({ status: "yeni", tenant_id: A }, B)).toBe(false);
    expect(canVoteOn({ status: "degerlendiriliyor", tenant_id: A }, B)).toBe(true);
  });

  it("başlık 5-120, açıklama en çok 2000 karakter", () => {
    expect(validateRequestInput("abc", "")).not.toBeNull();
    expect(validateRequestInput("Toplu SMS şablonu", "")).toBeNull();
    expect(validateRequestInput("Toplu SMS şablonu", "x".repeat(2001))).not.toBeNull();
  });
});
