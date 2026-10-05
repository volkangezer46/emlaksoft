import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildValuationRequest,
  parseValuationResponse,
  tenantRef,
  toValuationSource,
  valuationSubjectSchema,
} from "./contract";

const subject = { province: "İstanbul", district: "Kadıköy", propertyType: "Daire", transactionType: "sale" as const, grossSqm: 120 };

describe("Emlakfiyati sözleşmesi (sahte yanıtlarla)", () => {
  it("istek kişisel veri taşımaz: ham tenantId yok, bilinmeyen alan reddedilir", () => {
    const req = buildValuationRequest({ requestId: "req-12345678", tenantId: "11111111-1111-1111-1111-111111111111", subject });
    const json = JSON.stringify(req);
    expect(json).not.toContain("11111111-1111");
    expect(req.tenantRef).toBe(tenantRef("11111111-1111-1111-1111-111111111111"));
    expect(req.tenantRef).toMatch(/^[0-9a-f]{32}$/);
    expect(() => valuationSubjectSchema.parse({ ...subject, customerName: "Ali Veli" })).toThrow();
    expect(() => valuationSubjectSchema.parse({ ...subject, phone: "05321234567" })).toThrow();
  });

  const good = {
    estimate: { low: 4_000_000, mid: 4_500_000, high: 5_000_000, currency: "TRY" },
    confidence: { sampleSize: 12 },
    asOf: "2026-09-30",
    provider: { name: "x" },
    methodologyNote: "Not",
    unknownField: 1,
  };

  it("geçerli yanıt kaynağa eşlenir; bilinmeyen alan atılır", () => {
    const r = parseValuationResponse(good);
    expect(r).not.toBeNull();
    expect(r && "unknownField" in r).toBe(false);
    expect(toValuationSource(r!, 0.2)).toMatchObject({ name: "Emlakfiyati", weight: 0.2, value: 4_500_000 });
  });

  it("zorunlu alan eksik, TRY dışı, tutarsız aralık: kaynak atlanır (null)", () => {
    expect(parseValuationResponse({ ...good, estimate: { currency: "TRY" } })).toBeNull();
    expect(parseValuationResponse({ ...good, estimate: { mid: 1, currency: "USD" } })).toBeNull();
    expect(parseValuationResponse({ ...good, estimate: { low: 9, mid: 5, currency: "TRY" } })).toBeNull();
    expect(parseValuationResponse(null)).toBeNull();
  });

  it("ağırlık verilmezse/geçersizse kaynak üretilmez; az örneklem nota yazılır", () => {
    const r = parseValuationResponse({ ...good, confidence: { sampleSize: 2 } })!;
    expect(toValuationSource(r, 0)).toBeNull();
    expect(toValuationSource(r, Number.NaN)).toBeNull();
    expect(toValuationSource(r, 0.1)?.note).toContain("güven düşük");
  });

  it("istemci iskeleti etkin değil ve dış çağrı içermez", () => {
    const src = readFileSync(resolve(__dirname, "client.ts"), "utf8");
    expect(src).not.toMatch(/https?:\/\//);
    expect(src).not.toMatch(/fetch\(|fetchExternal/);
  });
});
