import { describe, expect, it } from "vitest";
import { daysLeft, isKvkkStatus, isKvkkType, parseDueDays } from "./kvkk-requests";

describe("KVKK talepleri", () => {
  it("süre: boş 30, aralık 1-90", () => {
    expect(parseDueDays("")).toBe(30);
    expect(parseDueDays(undefined)).toBe(30);
    expect(parseDueDays("15")).toBe(15);
    expect(parseDueDays("0")).toBeNull();
    expect(parseDueDays("91")).toBeNull();
    expect(parseDueDays("abc")).toBeNull();
  });
  it("tür ve durum doğrulaması", () => {
    expect(isKvkkType("access")).toBe(true);
    expect(isKvkkType("drop")).toBe(false);
    expect(isKvkkStatus("open")).toBe(true);
    expect(isKvkkStatus("x")).toBe(false);
  });
  it("kalan gün", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(daysLeft("2026-01-11T00:00:00Z", now)).toBe(10);
    expect(daysLeft("2025-12-30T00:00:00Z", now)).toBe(-2);
  });
});
