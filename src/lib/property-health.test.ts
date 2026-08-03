import { describe, expect, it } from "vitest";
import { computePropertyHealth } from "./property-health";

const BASE = {
  title: "Deniz manzaralı 3+1 daire",
  description: "A".repeat(120),
  property_type: "apartment",
  transaction_type: "sale",
  list_price: 5_000_000,
  address_line: "Örnek Mah. Örnek Sok. No:1",
  province_id: "province-1",
  parcel_block: "12",
  parcel_lot: "34",
  commission_rate: 2,
  features: { rooms: "3+1", net_sqm: 120, floor: 3, heating: "central" },
  authorization_start: "2026-01-01",
  authorization_end: "2030-01-01",
  authorization_type: "exclusive",
  mediaCount: 8,
  hasActivePortal: true,
};

describe("computePropertyHealth", () => {
  it("her kontrolü karşılayan bir portföyde tüm maddeler geçer", () => {
    const result = computePropertyHealth(BASE);
    expect(result.passed).toBe(result.total);
    expect(result.score).toBe(100);
    expect(result.criticalMissing).toEqual([]);
  });

  it("100 karakterden kısa açıklamayı eksik sayar ama başka maddeyi etkilemez", () => {
    const result = computePropertyHealth({ ...BASE, description: "kısa açıklama" });
    const item = result.items.find((i) => i.key === "description");
    expect(item?.passed).toBe(false);
    expect(result.passed).toBe(result.total - 1);
  });

  it("null açıklamayı eksik sayar", () => {
    const result = computePropertyHealth({ ...BASE, description: null });
    expect(result.items.find((i) => i.key === "description")?.passed).toBe(false);
  });

  it("yetki tarihleri hiç girilmemişse hem 'girildi' hem 'geçerli' kontrolü başarısız olur", () => {
    const result = computePropertyHealth({ ...BASE, authorization_start: null, authorization_end: null });
    expect(result.items.find((i) => i.key === "authorization")?.passed).toBe(false);
    expect(result.items.find((i) => i.key === "authorization_valid")?.passed).toBe(false);
  });

  it("süresi dolmuş yetki belgesinde 'girildi' geçer ama 'geçerli' kritik eksik olarak düşer", () => {
    const result = computePropertyHealth({ ...BASE, authorization_end: "2020-01-01" });
    expect(result.items.find((i) => i.key === "authorization")?.passed).toBe(true);
    const validItem = result.items.find((i) => i.key === "authorization_valid");
    expect(validItem?.passed).toBe(false);
    expect(validItem?.weight).toBe(3);
    expect(result.criticalMissing).toContain("Yetki belgesi süresi geçerli");
  });

  it("gelecekteki bitiş tarihi ile yetki belgesi geçerli sayılır", () => {
    const result = computePropertyHealth({ ...BASE, authorization_end: "2099-01-01" });
    expect(result.items.find((i) => i.key === "authorization_valid")?.passed).toBe(true);
  });
});
