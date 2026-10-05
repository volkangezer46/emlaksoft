import { describe, expect, it } from "vitest";
import { efAdminGrantSchema, examplePackPreset, packIdFromName } from "@/lib/ef-credits/admin-grant";
import { efPackWarnings, efPacksSchema } from "@/lib/ef-credits/config";
import { filterAndPage, normalizeLedgerRow, parseEfBalance, type EfMovement } from "@/lib/ef-credits/credit-view";

describe("kontör defter satırı", () => {
  it("satın alma, kullanım, iade; rezerve/serbest gizli", () => {
    expect(normalizeLedgerRow({ id: "1", kind: "grant_purchase", units: 25, created_at: "2026-10-01T10:00:00Z" })).toMatchObject({ category: "satin-alma", units: 25 });
    expect(normalizeLedgerRow({ id: "2", entry_type: "commit", amount: 5, item: "valuation_konut" })).toMatchObject({ category: "degerleme", units: -5 });
    expect(normalizeLedgerRow({ id: "3", kind: "commit", units: 2, item: "pdf_first" })).toMatchObject({ category: "pdf", units: -2 });
    expect(normalizeLedgerRow({ id: "4", kind: "grant_refund", units: 5 })).toMatchObject({ category: "iade", units: 5 });
    expect(normalizeLedgerRow({ id: "5", kind: "reserve", units: 5 })).toBeNull();
    expect(normalizeLedgerRow({ id: "6", kind: "release", units: 5 })).toBeNull();
    expect(normalizeLedgerRow({ id: "7", kind: "commit", units: 0 })).toBeNull();
  });
  it("kişisel veri alanları çıktıya taşınmaz", () => {
    const m = normalizeLedgerRow({ id: "1", kind: "commit", units: 5, item: "valuation_arsa", meta: { phone: "05551112233" }, request_ref: "x" })!;
    expect(JSON.stringify(m)).not.toContain("0555");
  });
  it("bakiye ayrıştırma", () => {
    expect(parseEfBalance({ available: 5, reserved: 0, granted_total: 10, committed_total: 5 })?.available).toBe(5);
    expect(parseEfBalance(null)).toBeNull();
    expect(parseEfBalance({ available: "x" })).toBeNull();
  });
  it("süzgeç ve sayfalama sınırlara kıstırılır", () => {
    const rows: EfMovement[] = Array.from({ length: 45 }, (_, i) => ({
      id: String(i), at: null, category: i % 2 ? "pdf" : "degerleme", label: "x", units: -1, userId: i % 3 ? "u1" : "u2", balanceAfter: null,
    }));
    expect(filterAndPage(rows, { page: 99 }).page).toBe(3);
    expect(filterAndPage(rows, { category: "pdf" }).total).toBe(22);
    expect(filterAndPage(rows, { userId: "u2" }).rows.every((r) => r.userId === "u2")).toBe(true);
    expect(filterAndPage([], {}).pages).toBe(1);
  });
});

describe("admin manuel yükleme doğrulaması", () => {
  const ok = { tenantId: "3f1c9c2e-1f43-4b0e-9a3c-0d2b5c7e8f10", units: 10, kind: "admin", reason: "Müşteri şikayeti telafisi" };
  it("geçerli", () => expect(efAdminGrantSchema.safeParse(ok).success).toBe(true));
  it("gerekçesiz/kısa gerekçe reddedilir", () => {
    expect(efAdminGrantSchema.safeParse({ ...ok, reason: "" }).success).toBe(false);
    expect(efAdminGrantSchema.safeParse({ ...ok, reason: "kısa" }).success).toBe(false);
  });
  it("negatif, sıfır, kesirli, aşırı kontör ve bilinmeyen tür reddedilir", () => {
    for (const units of [-5, 0, 1.5, 100001]) expect(efAdminGrantSchema.safeParse({ ...ok, units }).success).toBe(false);
    expect(efAdminGrantSchema.safeParse({ ...ok, kind: "purchase" }).success).toBe(false);
  });
});

describe("örnek ön ayar", () => {
  it("4 paket, geçerli şema, azalan kontör başı fiyat, uyarısız", () => {
    const p = examplePackPreset();
    expect(p).toHaveLength(4);
    expect(efPacksSchema.safeParse(p).success).toBe(true);
    expect(efPackWarnings(p)).toEqual([]);
    expect(p.filter((x) => x.popular).map((x) => x.id)).toEqual(["standart"]);
  });
  it("paket kimliği", () => {
    expect(packIdFromName("Çok Büyük Paket!")).toBe("cok-buyuk-paket");
    expect(packIdFromName("!")).toMatch(/^[a-z0-9][a-z0-9-]{1,31}$/);
  });
});
