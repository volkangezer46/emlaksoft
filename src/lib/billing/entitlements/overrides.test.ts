import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/clock";
import {
  describeOverride,
  isOverrideActive,
  overrideFromRow,
  parseOverrideInput,
  resolveEntitlementLimit,
  resolveSeatLimit,
  type EntitlementOverride,
} from "./overrides";

const NOW = Date.UTC(2026, 9, 13, 9, 0, 0);
const o = (p: Partial<EntitlementOverride>): EntitlementOverride => ({
  id: p.id ?? "a",
  key: p.key ?? "seats",
  delta: p.delta ?? null,
  value: p.value ?? null,
  expiresAtMs: p.expiresAtMs ?? null,
  revokedAtMs: p.revokedAtMs ?? null,
  createdAtMs: p.createdAtMs ?? NOW - DAY_MS,
});

describe("ofise özel limit istisnası (saf çözücü, SQL tenant_entitlement_resolve ile aynı)", () => {
  it("+5 koltuk istisnası kullanıcı ekleme limitini 5 artırır; bitiş tarihinde eski hâline döner", () => {
    const grant = o({ delta: 5, expiresAtMs: NOW + 7 * DAY_MS });
    expect(resolveSeatLimit(10, 0, [grant], NOW)).toBe(15);
    // Bitişten bir an önce hâlâ geçerli, bitiş anında ve sonrasında eski limit.
    expect(resolveSeatLimit(10, 0, [grant], NOW + 7 * DAY_MS - 1)).toBe(15);
    expect(resolveSeatLimit(10, 0, [grant], NOW + 7 * DAY_MS)).toBe(10);
    expect(resolveSeatLimit(10, 0, [grant], NOW + 30 * DAY_MS)).toBe(10);
  });

  it("satın alınmış ek kullanıcı istisnanın üstüne eklenir; geri alınan istisna sayılmaz", () => {
    expect(resolveSeatLimit(10, 3, [o({ delta: 5 })], NOW)).toBe(18);
    expect(resolveSeatLimit(10, 3, [o({ delta: 5, revokedAtMs: NOW - 1 })], NOW)).toBe(13);
  });

  it("sabit değer plan limitinin yerine geçer (en yenisi), artışlar üstüne eklenir; başka anahtar etkilemez", () => {
    const list = [
      o({ id: "1", key: "customers", value: 2000, createdAtMs: NOW - 3 * DAY_MS }),
      o({ id: "2", key: "customers", value: 3000, createdAtMs: NOW - DAY_MS }),
      o({ id: "3", key: "customers", delta: 100 }),
      o({ id: "4", key: "branches", delta: 2 }),
    ];
    expect(resolveEntitlementLimit(1000, "customers", list, NOW)).toBe(3100);
    expect(resolveEntitlementLimit(1000, "active_properties", list, NOW)).toBe(1000);
    expect(resolveEntitlementLimit(2, "branches", list, NOW)).toBe(4);
  });

  it("sınırsız (null) plan limiti sınırsız kalır", () => {
    expect(resolveEntitlementLimit(null, "customers", [o({ key: "customers", delta: 10 })], NOW)).toBeNull();
    expect(resolveSeatLimit(null, 4, [o({ delta: 10 })], NOW)).toBeNull();
  });

  it("isOverrideActive: bitişsiz aktif, geri alınmış pasif", () => {
    expect(isOverrideActive({ expiresAtMs: null, revokedAtMs: null }, NOW)).toBe(true);
    expect(isOverrideActive({ expiresAtMs: NOW, revokedAtMs: null }, NOW)).toBe(false);
    expect(isOverrideActive({ expiresAtMs: null, revokedAtMs: NOW - 5 }, NOW)).toBe(false);
  });

  it("girdi doğrulama: tür, biçim ve sınırlar", () => {
    expect(parseOverrideInput({ key: "seats", kind: "delta", amount: "5" })).toEqual({ ok: true, key: "seats", delta: 5, value: null });
    expect(parseOverrideInput({ key: "customers", kind: "value", amount: "2500" })).toEqual({ ok: true, key: "customers", delta: null, value: 2500 });
    expect(parseOverrideInput({ key: "x", kind: "delta", amount: "5" }).ok).toBe(false);
    expect(parseOverrideInput({ key: "seats", kind: "delta", amount: "0" }).ok).toBe(false);
    expect(parseOverrideInput({ key: "seats", kind: "delta", amount: "-3" }).ok).toBe(false);
    expect(parseOverrideInput({ key: "seats", kind: "delta", amount: "10001" }).ok).toBe(false);
    expect(parseOverrideInput({ key: "seats", kind: "?", amount: "5" }).ok).toBe(false);
  });

  it("satır dönüştürme ve açıklama", () => {
    const row = overrideFromRow({ id: "x", key: "seats", delta: 5, value: null, expires_at: null, revoked_at: null, created_at: "2026-10-13T09:00:00Z" });
    expect(row).toMatchObject({ key: "seats", delta: 5, value: null });
    expect(describeOverride(row!)).toBe("+5 Kullanıcı (koltuk)");
    expect(overrideFromRow({ id: "x", key: "seats", delta: 5, value: 9 })).toBeNull();
    expect(overrideFromRow({ id: "x", key: "nope", delta: 5 })).toBeNull();
  });
});
