import { describe, expect, it } from "vitest";
import { csvDate } from "./csv";

describe("muhasebe tarih biçimi", () => {
  it("gg.aa.yyyy ve TR takvim günü (UTC gece yarısı sonrası ertesi gün)", () => {
    expect(csvDate("2026-10-07T21:30:00Z")).toBe("08.10.2026");
    expect(csvDate("2026-03-05T10:00:00Z")).toBe("05.03.2026");
    expect(csvDate(null)).toBe("");
    expect(csvDate("geçersiz")).toBe("");
  });
});
