import { describe, expect, it } from "vitest";
import { efPackClawbackUnits, efPackRefundIdem } from "./credit-pack-refund";

describe("credit-pack-refund", () => {
  it("tam iade tüm kontörü geri alır", () => {
    expect(efPackClawbackUnits(50, 1200, 1200)).toBe(50);
  });
  it("kısmi iade orantılı ve yukarı yuvarlanır", () => {
    expect(efPackClawbackUnits(10, 300, 1000)).toBe(3);
    expect(efPackClawbackUnits(10, 301, 1000)).toBe(4);
  });
  it("paket birimini aşmaz, geçersiz girdide 0", () => {
    expect(efPackClawbackUnits(10, 2000, 1000)).toBe(10);
    expect(efPackClawbackUnits(0, 100, 100)).toBe(0);
    expect(efPackClawbackUnits(10, 0, 100)).toBe(0);
    expect(efPackClawbackUnits(10, 100, 0)).toBe(0);
    expect(efPackClawbackUnits(Number.NaN, 100, 100)).toBe(0);
  });
  it("idem anahtarı geçerli biçimde ve birimle ilişkili", () => {
    const a = efPackRefundIdem("11111111-1111-1111-1111-111111111111", 5);
    expect(a).toMatch(/^[A-Za-z0-9_.:-]{8,128}$/);
    expect(a).not.toBe(efPackRefundIdem("11111111-1111-1111-1111-111111111111", 6));
  });
});
