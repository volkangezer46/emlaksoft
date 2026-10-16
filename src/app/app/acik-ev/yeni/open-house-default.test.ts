import { describe, expect, it } from "vitest";
import { defaultOpenHouseStart } from "./open-house-default";

describe("açık ev varsayılan zamanı", () => {
  it("sıradaki Cumartesi 13:00 (TR)", () => {
    // 2026-10-16 Cuma 12:00 TR
    expect(defaultOpenHouseStart(Date.parse("2026-10-16T09:00:00Z"))).toBe("2026-10-17T13:00");
    // 2026-10-12 Pazartesi
    expect(defaultOpenHouseStart(Date.parse("2026-10-12T09:00:00Z"))).toBe("2026-10-17T13:00");
  });
  it("Cumartesi ise bir sonraki hafta; TR gece yarısı sınırı doğru", () => {
    expect(defaultOpenHouseStart(Date.parse("2026-10-17T09:00:00Z"))).toBe("2026-10-24T13:00");
    // UTC'de Cuma 22:30 = TR Cumartesi 01:30 → sonraki Cumartesi
    expect(defaultOpenHouseStart(Date.parse("2026-10-16T22:30:00Z"))).toBe("2026-10-24T13:00");
  });
});
