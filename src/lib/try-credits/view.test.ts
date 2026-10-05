import { describe, expect, it } from "vitest";
import { normalizeMovementRow, type TryMovementRow } from "./reader";
import { describeMovement, expiryText, formatShare, formatTry, summarizeWallet } from "./view";
import type { TryOverview } from "./config";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const row = (p: Partial<TryMovementRow>): TryMovementRow => ({
  id: 1,
  entryType: "grant",
  amount: 100,
  source: "referral",
  feature: null,
  expiresAt: null,
  createdAt: "2026-10-01T10:00:00Z",
  ...p,
});

describe("hareket sunumu", () => {
  it("yükleme / harcama / geri alma / iade etiketleri", () => {
    expect(describeMovement(row({})).label).toBe("Tavsiye ödülü");
    expect(describeMovement(row({ source: "partner" })).label).toBe("Ortaklık ödülü");
    expect(describeMovement(row({ source: "campaign", expiresAt: "2026-11-01T00:00:00Z" })).detail).toBe("Vadeli kredi");
    const spend = describeMovement(row({ entryType: "spend", amount: -50, source: "usage" }));
    expect(spend).toMatchObject({ kind: "out", label: "Fatura ödemesinde kullanıldı", amountTry: -50 });
    expect(describeMovement(row({ entryType: "reverse", amount: -30, source: "referral" })).label).toBe("Kredi geri alındı");
    expect(describeMovement(row({ entryType: "reverse", amount: 30, source: "refund", feature: "invoice_refund" }))).toMatchObject({
      kind: "in",
      label: "İade: kullanılan kredi geri yazıldı",
    });
    expect(describeMovement(row({ entryType: "expire", amount: -5 })).label).toBe("Süresi dolan kredi");
  });

  it("satır normalleştirme: geçersiz satır düşer", () => {
    expect(normalizeMovementRow({ id: "5", amount: "12.5", created_at: "2026-10-01T10:00:00Z", entry_type: "grant", source: "manual" })).toMatchObject({
      id: 5,
      amount: 12.5,
    });
    expect(normalizeMovementRow({ id: "x", amount: 1, created_at: "2026-10-01T10:00:00Z" })).toBeNull();
    expect(normalizeMovementRow({ id: 1, amount: 1 })).toBeNull();
  });
});

describe("vade metni ve özet", () => {
  it("vade metni", () => {
    expect(expiryText(null, NOW)).toBeNull();
    expect(expiryText("2026-10-04T00:00:00Z", NOW)).toBe("süresi doldu");
    expect(expiryText("2026-10-05T20:00:00Z", NOW)).toBe("bugün/yarın sona erer");
    expect(expiryText("2026-10-20T12:00:00Z", NOW)).toBe("15 gün sonra sona erer");
  });

  it("özet: eksi bakiye işaretlenir, kullanılabilir 0 kalır", () => {
    const o: TryOverview = {
      available: 0,
      balance: -150,
      reserved: 0,
      debt: 150,
      granted_total: 100,
      spent_total: 250,
      next_expiry_at: null,
      expiring_amount: 0,
      expiring_buckets: [],
      open_reservations: [],
    };
    const s = summarizeWallet(o, NOW);
    expect(s.negative).toBe(true);
    expect(s.availableTry).toBe(0);
    expect(s.exampleCap(1000, 0.5)).toBe(0);
  });

  it("örnek tavan: bakiye ve pay ile sınırlı", () => {
    const o: TryOverview = {
      available: 300,
      balance: 300,
      reserved: 0,
      debt: 0,
      granted_total: 300,
      spent_total: 0,
      next_expiry_at: "2026-10-20T12:00:00Z",
      expiring_amount: 300,
      expiring_buckets: [{ amount: 300, expires_at: "2026-10-20T12:00:00Z" }],
      open_reservations: [],
    };
    const s = summarizeWallet(o, NOW);
    expect(s.exampleCap(1000, 0.5)).toBe(300);
    expect(s.exampleCap(400, 0.5)).toBe(200);
    expect(s.nextExpiryText).toBe("15 gün sonra sona erer");
  });

  it("biçimleyiciler", () => {
    expect(formatShare(0.5)).toBe("%50");
    expect(formatTry(1494)).toContain("1.494,00");
  });
});
