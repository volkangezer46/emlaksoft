import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Komisyonum kartı kazanç gizliliğini korur: yalnız kendi payı, tahmin etiketli, tek pay kaynağı. */
describe("Komisyonum kartı (sözleşme)", () => {
  const src = readFileSync("src/app/app/performansim/komisyonum.tsx", "utf8");
  it("yalnız kendi satırları (seeAll: false) ve kendi anlaşmaları (assigned_to = ben)", () => {
    expect(src).toContain("seeAll: false");
    expect(src).not.toMatch(/seeAll:\s*(true|seeAll|canSeeAllEarnings)/);
    expect(src).toContain('.eq("assigned_to", userId)');
  });
  it("pay hesabı Cüzdan ile aynı yardımcılar; tahmin pipeline motorundan ve etiketli", () => {
    expect(src).toContain("summarizeAdvisorEarning(");
    expect(src).toContain("earningInRange(");
    expect(src).toContain("buildPipelineForecast(");
    expect(src).toContain("Tahmin");
  });
});
