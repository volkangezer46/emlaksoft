import { describe, expect, it } from "vitest";
import { shouldShowFirstDealNudge } from "./program";

const NOW = Date.parse("2026-10-14T12:00:00Z");

describe("shouldShowFirstDealNudge", () => {
  it("yalnız tek gerçek kazanç ve 7 gün içinde", () => {
    expect(shouldShowFirstDealNudge({ realWonCount: 1, firstWonAt: "2026-10-12T09:00:00Z", nowMs: NOW })).toBe(true);
    expect(shouldShowFirstDealNudge({ realWonCount: 1, firstWonAt: "2026-10-07T12:00:00Z", nowMs: NOW })).toBe(true);
  });
  it("18 kazanımlı ofiste görünmez", () => {
    expect(shouldShowFirstDealNudge({ realWonCount: 18, firstWonAt: "2026-10-13T09:00:00Z", nowMs: NOW })).toBe(false);
  });
  it("7 günden eski, gelecek tarihli ya da tarihsiz kazançta görünmez", () => {
    expect(shouldShowFirstDealNudge({ realWonCount: 1, firstWonAt: "2026-10-01T09:00:00Z", nowMs: NOW })).toBe(false);
    expect(shouldShowFirstDealNudge({ realWonCount: 1, firstWonAt: "2026-12-01T09:00:00Z", nowMs: NOW })).toBe(false);
    expect(shouldShowFirstDealNudge({ realWonCount: 1, firstWonAt: null, nowMs: NOW })).toBe(false);
    expect(shouldShowFirstDealNudge({ realWonCount: 0, firstWonAt: null, nowMs: NOW })).toBe(false);
  });
});
