import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  REFERRAL_CONVERTED_OR,
  parseReferralFilter,
  referralFilterValue,
} from "./referral-filters";

describe("tavsiye süzgeçleri", () => {
  it("geçerli durum, sanal 'donen' ve geçersiz değer ayrışır", () => {
    expect(parseReferralFilter("kazanildi")).toEqual({ kind: "status", status: "kazanildi" });
    expect(parseReferralFilter("donen")).toEqual({ kind: "converted" });
    expect(parseReferralFilter("x")).toEqual({ kind: "none" });
    expect(parseReferralFilter(undefined)).toEqual({ kind: "none" });
    expect(referralFilterValue(parseReferralFilter("donen"))).toBe("donen");
    expect(referralFilterValue(parseReferralFilter(""))).toBe("");
  });

  it("'Müşteriye dönen' kazanılmış ve kaydı oluşmuş tavsiyeleri birlikte kapsar", () => {
    expect(REFERRAL_CONVERTED_OR).toContain("created_customer_id.not.is.null");
    expect(REFERRAL_CONVERTED_OR).toContain("kazanildi");
  });

  it("KPI kartı sayısı ve hedefi aynı süzgeci kullanır", () => {
    const src = readFileSync(path.join(import.meta.dirname, "page.tsx"), "utf8");
    expect(src).toContain('supabase.from("referrals").select("id", { count: "exact", head: true }).or(REFERRAL_CONVERTED_OR)');
    expect(src).toContain('listQuery = listQuery.or(REFERRAL_CONVERTED_OR)');
    expect(src).toContain("href={`/app/tavsiyeler?durum=${REFERRAL_CONVERTED_FILTER}`}");
    expect(src).not.toContain('href="/app/tavsiyeler?durum=musteri"');
  });
});
