import { describe, expect, it } from "vitest";
import { canChangeTrial, cleanReason, extendPeriodEnd, resolveTrialEnd, trDateEndMs } from "./admin-billing-fixes";

const NOW = Date.parse("2026-10-13T09:00:00Z"); // 12:00 TR, 13 Ekim
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("resolveTrialEnd (denemeyi uzat/kısalt sınırları)", () => {
  it("+7: mevcut (ileri) bitişe eklenir", () => {
    const cur = iso(NOW + 3 * DAY);
    const r = resolveTrialEnd({ days: 7 }, cur, NOW);
    expect(r).toEqual({ ok: true, endIso: iso(NOW + 10 * DAY) });
  });
  it("bitiş geçmişteyse bugünden sayılır", () => {
    const r = resolveTrialEnd({ days: 14 }, iso(NOW - 5 * DAY), NOW);
    expect(r).toEqual({ ok: true, endIso: iso(NOW + 14 * DAY) });
  });
  it("bugün + 90 günü aşan değer reddedilir", () => {
    expect(resolveTrialEnd({ days: 30 }, iso(NOW + 70 * DAY), NOW).ok).toBe(false);
    expect(resolveTrialEnd({ date: "2027-01-12" }, null, NOW).ok).toBe(false); // 91. gün
    expect(resolveTrialEnd({ date: "2027-01-11" }, null, NOW).ok).toBe(true); // 90. gün
    expect(resolveTrialEnd({ days: 91 }, null, NOW).ok).toBe(false);
  });
  it("geçmiş tarih ve bugün reddedilir; en erken yarın", () => {
    expect(resolveTrialEnd({ date: "2026-10-01" }, null, NOW)).toMatchObject({ ok: false });
    expect(resolveTrialEnd({ date: "2026-10-13" }, null, NOW)).toMatchObject({ ok: false });
    expect(resolveTrialEnd({ date: "2026-10-14" }, null, NOW)).toEqual({ ok: true, endIso: "2026-10-14T20:59:59.000Z" });
  });
  it("kısaltma: negatif gün ya da daha erken tarih (yarından önce olamaz)", () => {
    expect(resolveTrialEnd({ days: -5 }, iso(NOW + 10 * DAY), NOW)).toEqual({ ok: true, endIso: iso(NOW + 5 * DAY) });
    expect(resolveTrialEnd({ days: -10 }, iso(NOW + 10 * DAY), NOW).ok).toBe(false);
  });
  it("bozuk girdi reddedilir", () => {
    expect(resolveTrialEnd({ days: 0 }, null, NOW).ok).toBe(false);
    expect(resolveTrialEnd({ days: 2.5 }, null, NOW).ok).toBe(false);
    expect(resolveTrialEnd({ date: "2026-02-30" }, null, NOW).ok).toBe(false);
    expect(trDateEndMs("13.10.2026")).toBeNull();
  });
});

describe("extendPeriodEnd (dönemi uzat 1..90)", () => {
  it("geçmiş bitişte şimdiden sayılır, 90 üstü reddedilir", () => {
    expect(extendPeriodEnd(iso(NOW - 10 * DAY), 30, NOW)).toEqual({ ok: true, endIso: iso(NOW + 30 * DAY) });
    expect(extendPeriodEnd(iso(NOW - 10 * DAY), 91, NOW).ok).toBe(false);
    expect(extendPeriodEnd(null, 0, NOW).ok).toBe(false);
  });
});

describe("kapı ve gerekçe", () => {
  it("deneme değişikliği: sales ya da tenants + yazma", () => {
    expect(canChangeTrial("super_admin")).toBe(true);
    expect(canChangeTrial("ops")).toBe(true);
    expect(canChangeTrial("support")).toBe(true);
    expect(canChangeTrial("billing")).toBe(true);
  });
  it("salt okunur özel rol (yalnız görüntüle) denemeyi değiştiremez", () => {
    const custom = (permissions: Record<string, string[]>) => ({
      role: "support" as const,
      customRole: { id: "r1", label: "Özel", baseRole: "support" as const, permissions: permissions as never },
    });
    expect(canChangeTrial(custom({ sales: ["view"] }))).toBe(false);
    expect(canChangeTrial(custom({ sales: ["view"], tenants: ["view"] }))).toBe(false);
    expect(canChangeTrial(custom({ tenants: ["view", "write"] }))).toBe(false);
    expect(canChangeTrial(custom({ sales: ["view", "write"] }))).toBe(true);
    expect(canChangeTrial(custom({ tenants: ["view", "write"], billing: ["view", "write"] }))).toBe(true);
  });
  it("gerekçe en az 10 karakter", () => {
    expect(cleanReason("kısa")).toBeNull();
    expect(cleanReason("  müşteri   ek süre istedi ")).toBe("müşteri ek süre istedi");
    expect(cleanReason(null)).toBeNull();
  });
});
