import { describe, expect, it } from "vitest";
import { initialsOf, toneIndexOf } from "./avatar";
import { clampPercent } from "./progress";

describe("avatar", () => {
  it("Türkçe büyük harf kuralıyla baş harf üretir (i → İ)", () => {
    expect(initialsOf("ilker ışık")).toBe("İI");
  });

  it("tek isimde tek harf, boşta soru işareti döner", () => {
    expect(initialsOf("Ayşe")).toBe("A");
    expect(initialsOf("   ")).toBe("?");
  });

  it("aynı isim her zaman aynı tonu alır", () => {
    expect(toneIndexOf("Volkan Gezer")).toBe(toneIndexOf("Volkan Gezer"));
    expect(toneIndexOf("Volkan Gezer")).toBeGreaterThanOrEqual(0);
  });
});

describe("progress", () => {
  it("değeri 0–100 aralığına sıkıştırır", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(42)).toBe(42);
    expect(clampPercent(Number.NaN)).toBe(0);
  });
});
