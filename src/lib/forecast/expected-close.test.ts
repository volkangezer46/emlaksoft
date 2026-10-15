import { describe, expect, it } from "vitest";
import { expectedCloseStatus, parseExpectedCloseDate } from "./expected-close";

describe("beklenen kapanış", () => {
  it("boş değer temizler; geçersiz tarih reddedilir", () => {
    expect(parseExpectedCloseDate(" ")).toEqual({ ok: true, value: null });
    expect(parseExpectedCloseDate("2026-11-30")).toEqual({ ok: true, value: "2026-11-30" });
    expect(parseExpectedCloseDate("2026-02-30").ok).toBe(false);
    expect(parseExpectedCloseDate("30.11.2026").ok).toBe(false);
    expect(parseExpectedCloseDate("1999-01-01").ok).toBe(false);
  });

  it("durum: geçmiş gecikti, 7 gün içi yakın", () => {
    expect(expectedCloseStatus("2026-10-14", "2026-10-15")).toBe("gecikti");
    expect(expectedCloseStatus("2026-10-22", "2026-10-15")).toBe("yakin");
    expect(expectedCloseStatus("2026-10-23", "2026-10-15")).toBe("ileride");
    expect(expectedCloseStatus(null, "2026-10-15")).toBeNull();
  });
});
