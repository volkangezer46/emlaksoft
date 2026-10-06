import { describe, expect, it } from "vitest";
import { ageText, freshnessLevel } from "./freshness";

describe("freshness", () => {
  it("eşikler", () => {
    expect(freshnessLevel(0)).toBe("taze");
    expect(freshnessLevel(4 * 60_000)).toBe("taze");
    expect(freshnessLevel(5 * 60_000)).toBe("guncel");
    expect(freshnessLevel(59 * 60_000)).toBe("guncel");
    expect(freshnessLevel(60 * 60_000)).toBe("bayat");
    expect(freshnessLevel(-5)).toBe("taze");
  });
  it("yaş metni", () => {
    expect(ageText(10_000)).toBe("az önce");
    expect(ageText(12 * 60_000)).toBe("12 dk önce");
    expect(ageText(3 * 3_600_000)).toBe("3 sa önce");
    expect(ageText(50 * 3_600_000)).toBe("2 gün önce");
  });
});
