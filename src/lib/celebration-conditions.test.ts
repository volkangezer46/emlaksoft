import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/clock";
import {
  isCreditPurchaseMoment,
  isFirstCollectionMoment,
  isFirstInviteRewardMoment,
  isTargetReachedMoment,
} from "./celebration-conditions";

const NOW = Date.parse("2026-10-15T09:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("kutlama koşulları (yalnız gerçek olay)", () => {
  it("ilk tahsilat: tam bir kayıt ve yakın tarih", () => {
    expect(isFirstCollectionMoment([iso(NOW - 2 * DAY_MS)], NOW)).toBe(true);
    expect(isFirstCollectionMoment([], NOW)).toBe(false);
    expect(isFirstCollectionMoment([iso(NOW - 2 * DAY_MS), iso(NOW - 30 * DAY_MS)], NOW)).toBe(false);
    expect(isFirstCollectionMoment([iso(NOW - 40 * DAY_MS)], NOW)).toBe(false);
    expect(isFirstCollectionMoment([iso(NOW + DAY_MS)], NOW)).toBe(false);
  });
  it("ilk davet ödülü yalnız tam 1", () => {
    expect(isFirstInviteRewardMoment(1)).toBe(true);
    expect(isFirstInviteRewardMoment(0)).toBe(false);
    expect(isFirstInviteRewardMoment(2)).toBe(false);
  });
  it("hedef %100: hedef sıfırsa asla", () => {
    expect(isTargetReachedMoment(100, 100)).toBe(true);
    expect(isTargetReachedMoment(99, 100)).toBe(false);
    expect(isTargetReachedMoment(5, 0)).toBe(false);
    expect(isTargetReachedMoment(Number.NaN, 10)).toBe(false);
  });
  it("kontör satın alma: ödenmiş ve yeni", () => {
    expect(isCreditPurchaseMoment({ status: "paid" }, true)).toBe(true);
    expect(isCreditPurchaseMoment({ status: "paid" }, false)).toBe(false);
    expect(isCreditPurchaseMoment({ status: "open" }, true)).toBe(false);
    expect(isCreditPurchaseMoment(null, true)).toBe(false);
  });
});
