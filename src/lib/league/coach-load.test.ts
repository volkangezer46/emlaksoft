import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Lig koçu hız sözleşmesi: yalnız sıralama okunur, 120 sn önbellekli; ayar ayrı tur atmaz. */
describe("loadCoachPlan (sözleşme)", () => {
  const src = readFileSync("src/lib/league/coach-load.ts", "utf8");
  it("rankingOnly + lig-hafta önbelleği", () => {
    expect(src).toContain("rankingOnly: true");
    expect(src).toContain('"lig-hafta"');
    expect(src).toContain("120");
  });
  it("ayar okuması ardışık beklenmez", () => {
    expect(src).not.toMatch(/await loadLeagueSettings/);
  });
});
