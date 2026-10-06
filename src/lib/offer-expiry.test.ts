import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { addDaysToKey, daysUntilOfferExpiry, offerExpiryDedupeKey, offerExpiryTargetDay } from "./offer-expiry";

describe("offer-expiry", () => {
  it("hedef gün bugünden 2 gün sonra (ay/yıl sınırı dahil)", () => {
    expect(offerExpiryTargetDay("2026-10-07")).toBe("2026-10-09");
    expect(offerExpiryTargetDay("2026-12-31")).toBe("2027-01-02");
    expect(addDaysToKey("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("kalan gün ve dedupe anahtarı", () => {
    expect(daysUntilOfferExpiry("2026-10-09", "2026-10-07")).toBe(2);
    expect(daysUntilOfferExpiry("2026-10-01", "2026-10-07")).toBe(-6);
    expect(daysUntilOfferExpiry(null, "2026-10-07")).toBeNull();
    expect(offerExpiryDedupeKey("abc", "2026-10-09")).toBe("offer-exp:abc:2026-10-09");
  });

  it("adım mevcut günlük cron'a bağlı (yeni cron yok)", () => {
    const route = readFileSync("src/app/api/cron/abonelik-kontrol/route.ts", "utf8");
    expect(route).toContain("runOfferExpiryReminders(admin, trDayKey(nowMs))");
  });
});
