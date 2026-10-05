import { describe, expect, it } from "vitest";
import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  cleanUtm,
  formatRefCookie,
  generateReferralCode,
  hasAttribution,
  parseRefCookie,
  parseRefParam,
  parseShortCode,
  resolveAttributionInput,
  vitrinSignatureHref,
} from "./attribution";
import { GROWTH_SETTING_KEYS, describeRewardRule, isMissingTableError, parseGrowthFlags } from "./settings";

describe("atıf kodları", () => {
  it("kısa yol: vitrin imzası, davet kodu ve çöp değer", () => {
    expect(parseShortCode("v-ornek-ofis")).toEqual({ kind: "powered_by", code: "ornek-ofis" });
    expect(parseShortCode("ABCD2345")).toEqual({ kind: "referral", code: "abcd2345" });
    expect(parseShortCode("v-")).toBeNull();
    expect(parseShortCode("a b")).toBeNull();
    expect(parseShortCode("../etc")).toBeNull();
    expect(parseShortCode("x".repeat(40))).toBeNull();
  });

  it("çerez biçimi gidiş-dönüş yapar ve bozuk değeri reddeder", () => {
    for (const t of [
      { kind: "referral", code: "abcd2345" },
      { kind: "partner", code: "egitmen-ali" },
      { kind: "powered_by", code: "ornek-ofis" },
    ] as const) {
      expect(parseRefCookie(formatRefCookie(t))).toEqual(t);
    }
    expect(parseRefCookie("r:ab")).toBeNull();
    expect(parseRefCookie("z:abcdefgh")).toBeNull();
    expect(parseRefCookie("<script>")).toBeNull();
    expect(parseRefCookie(null)).toBeNull();
  });

  it("/kayit?ref yalnız davet kodu kabul eder", () => {
    expect(parseRefParam("abcd2345")).toEqual({ kind: "referral", code: "abcd2345" });
    expect(parseRefParam("v-ornek")).toBeNull();
    expect(parseRefParam("")).toBeNull();
  });

  it("UTM alanı güvenli karakterle sınırlıdır", () => {
    expect(cleanUtm("Instagram")).toBe("instagram");
    expect(cleanUtm("a b")).toBeNull();
    expect(cleanUtm("x".repeat(65))).toBeNull();
    expect(cleanUtm("<img>")).toBeNull();
  });

  it("çerez (ilk dokunuş) form değerinden üstündür; boşsa atıf yok sayılır", () => {
    const a = resolveAttributionInput({ cookie: "p:egitmen-ali", ref: "abcd2345", utm_source: "", utm_medium: "", utm_campaign: "" });
    expect(a.touch).toEqual({ kind: "partner", code: "egitmen-ali" });
    const b = resolveAttributionInput({ cookie: "", ref: "", utm_source: "", utm_medium: null, utm_campaign: undefined });
    expect(hasAttribution(b)).toBe(false);
    const c = resolveAttributionInput({ cookie: "", ref: "", utm_source: "ig", utm_medium: "", utm_campaign: "" });
    expect(hasAttribution(c)).toBe(true);
  });

  it("üretilen kod opaktır: sabit uzunluk, yalnız izinli alfabe, tahmin edilebilir sıra yok", () => {
    let i = 0;
    const seq = generateReferralCode(() => (i++ * 7) % REFERRAL_CODE_ALPHABET.length);
    expect(seq).toHaveLength(REFERRAL_CODE_LENGTH);
    expect([...seq].every((c) => REFERRAL_CODE_ALPHABET.includes(c))).toBe(true);
    expect(REFERRAL_CODE_ALPHABET).not.toMatch(/[01ilo]/);
    expect(parseRefParam(seq)).not.toBeNull();
  });

  it("bağlantı üreticileri", () => {
    expect(vitrinSignatureHref("ornek")).toBe("/r/v-ornek");
  });
});

describe("ayarlar ve ödül metni", () => {
  it("varsayılan KAPALI; yalnız açık değerler açar", () => {
    expect(parseGrowthFlags({})).toEqual({ referralEnabled: false, partnerEnabled: false, cashPayoutEnabled: false });
    expect(parseGrowthFlags({ [GROWTH_SETTING_KEYS.referralEnabled]: "on" }).referralEnabled).toBe(true);
    expect(parseGrowthFlags({ [GROWTH_SETTING_KEYS.partnerEnabled]: "kapali" }).partnerEnabled).toBe(false);
  });

  it("ödül cümlesi yalnız kuraldan üretilir; kural yoksa vaat yok", () => {
    expect(describeRewardRule(null)).toBeNull();
    expect(describeRewardRule({ reward_type: "fixed_try", reward_value: 0, duration_months: null, hold_days: 0 })).toBeNull();
    const t = describeRewardRule({ reward_type: "percent_of_payment", reward_value: 12.5, duration_months: 6, hold_days: 30 });
    expect(t).toContain("%12,5");
    expect(t).toContain("ilk 6 ay");
    expect(t).toContain("30 gün");
  });

  it("tablo yok hatasını tanır (etkin değil kipi)", () => {
    expect(isMissingTableError({ code: "42P01" })).toBe(true);
    expect(isMissingTableError({ code: "PGRST205", message: "x" })).toBe(true);
    expect(isMissingTableError({ message: "Could not find the table 'public.growth_partners' in the schema cache" })).toBe(true);
    expect(isMissingTableError({ code: "23505", message: "duplicate" })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});
