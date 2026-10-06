import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HOME_VALUE_NOTE, homeValueDisplay, roundTo10k } from "./core";

describe("evinizin güncel değeri", () => {
  it("yalnız orta/yüksek güven + en az 3 emsal; aralık 10 bine yuvarlanır", () => {
    expect(homeValueDisplay({ lowValue: 4_812_345, highValue: 5_296_000, estimatedValue: 5_000_000, compCount: 6, confidence: "orta" })).toEqual({
      low: 4_810_000,
      high: 5_300_000,
      compCount: 6,
      confidence: "orta",
    });
    expect(homeValueDisplay({ lowValue: 1, highValue: 2, estimatedValue: 1, compCount: 9, confidence: "düşük" })).toBeNull();
    expect(homeValueDisplay({ lowValue: null, highValue: null, estimatedValue: null, compCount: 0, confidence: "yetersiz" })).toBeNull();
    expect(homeValueDisplay({ lowValue: 4_000_000, highValue: 5_000_000, estimatedValue: 4_500_000, compCount: 2, confidence: "yüksek" })).toBeNull();
    expect(homeValueDisplay(null)).toBeNull();
    expect(roundTo10k(14_999)).toBe(10_000);
  });

  it("not 'tahmin' der, resmî değerleme iddiası taşımaz; portal ayarla ve emsal motoruyla bağlı", () => {
    expect(HOME_VALUE_NOTE).toMatch(/TAHMİN/);
    expect(HOME_VALUE_NOTE).toMatch(/resmî değerleme değildir/);
    const page = readFileSync("src/app/musteri-portali/[token]/page.tsx", "utf8");
    expect(page).toContain("HOME_VALUE_SUMMARY_KEY");
    const load = readFileSync("src/lib/home-value/load.ts", "utf8");
    expect(load).toContain("estimateFromComparables");
    expect(load).toContain('.eq("is_sample", true)');
  });
});
