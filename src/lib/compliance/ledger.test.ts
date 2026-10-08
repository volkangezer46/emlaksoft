import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEDGER_THRESHOLDS,
  computeLedgerFlags,
  computeRetainUntil,
  isThresholdFlagged,
  isValidIsoDate,
  parseAmountTry,
  parseLedgerFilters,
  parseLedgerForm,
  parseRetentionYears,
  parseThreshold,
} from "./ledger";

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}
const valid = {
  transaction_type: "sale",
  transaction_date: "2026-10-01",
  party_name: "Ayşe Yılmaz",
  party_role: "buyer",
  amount_try: "1.250.000,50",
  payment_method: "bank_transfer",
};

describe("parseAmountTry", () => {
  it("Türkçe ve düz biçimleri okur", () => {
    expect(parseAmountTry("1.250.000,50")).toBe(1250000.5);
    expect(parseAmountTry("1250000")).toBe(1250000);
    expect(parseAmountTry("1.250.000")).toBe(1250000);
    expect(parseAmountTry("250 000 TL")).toBe(250000);
    expect(parseAmountTry("0")).toBe(0);
  });
  it("negatif, harf ve boşu reddeder", () => {
    expect(parseAmountTry("-5")).toBeNull();
    expect(parseAmountTry("abc")).toBeNull();
    expect(parseAmountTry("")).toBeNull();
    expect(parseAmountTry(undefined)).toBeNull();
  });
});

describe("ayar ayrıştırma", () => {
  it("eşik boşsa varsayılan, geçersizse null", () => {
    expect(parseThreshold("", 5)).toBe(5);
    expect(parseThreshold("0", 5)).toBe(0);
    expect(parseThreshold("x", 5)).toBeNull();
  });
  it("saklama yılı 1-30 aralığında", () => {
    expect(parseRetentionYears("")).toBe(DEFAULT_LEDGER_THRESHOLDS.retentionYears);
    expect(parseRetentionYears("10")).toBe(10);
    expect(parseRetentionYears("0")).toBeNull();
    expect(parseRetentionYears("31")).toBeNull();
    expect(parseRetentionYears("1.5")).toBeNull();
  });
});

describe("computeLedgerFlags", () => {
  const t = { cashThresholdTry: 100_000, amountThresholdTry: 1_000_000, retentionYears: 5 };
  it("nakit eşiği yalnız nakitte işaretler", () => {
    expect(computeLedgerFlags({ amountTry: 100_000, method: "cash", identityChecked: true }, t)).toEqual([
      "cash_over_threshold",
    ]);
    expect(computeLedgerFlags({ amountTry: 99_999, method: "cash", identityChecked: true }, t)).toEqual([]);
    expect(computeLedgerFlags({ amountTry: 500_000, method: "bank_transfer", identityChecked: true }, t)).toEqual([]);
  });
  it("tutar eşiği ve kimlik eksikliği birlikte işaretlenir", () => {
    expect(computeLedgerFlags({ amountTry: 2_000_000, method: "cash", identityChecked: false }, t)).toEqual([
      "cash_over_threshold",
      "amount_over_threshold",
      "identity_not_checked",
    ]);
  });
  it("eşik 0 işaretlemeyi kapatır", () => {
    const off = { ...t, cashThresholdTry: 0, amountThresholdTry: 0 };
    expect(computeLedgerFlags({ amountTry: 9e9, method: "cash", identityChecked: true }, off)).toEqual([]);
  });
  it("kimlik eksikliği eşik üstü sayılmaz", () => {
    expect(isThresholdFlagged(["identity_not_checked"])).toBe(false);
    expect(isThresholdFlagged(["amount_over_threshold"])).toBe(true);
  });
});

describe("computeRetainUntil / tarih", () => {
  it("yıl ekler, 29 Şubat'ı artık olmayan yılda 28'e çeker", () => {
    expect(computeRetainUntil("2026-10-01", 5)).toBe("2031-10-01");
    expect(computeRetainUntil("2024-02-29", 1)).toBe("2025-02-28");
    expect(computeRetainUntil("2024-02-29", 4)).toBe("2028-02-29");
    expect(computeRetainUntil("bozuk", 5)).toBeNull();
  });
  it("geçersiz takvim tarihini reddeder", () => {
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-10-01")).toBe(true);
  });
});

describe("parseLedgerForm", () => {
  it("geçerli girdiyi okur", () => {
    const r = parseLedgerForm(form({ ...valid, identity_checked: "on" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.kind).toBe("entry");
      expect(r.value.amountTry).toBe(1250000.5);
      expect(r.value.identityChecked).toBe(true);
    }
  });
  it("corrects_entry_id düzeltme kaydı üretir", () => {
    const r = parseLedgerForm(form({ ...valid, corrects_entry_id: "11111111-1111-4111-8111-111111111111" }));
    expect(r.ok && r.value.kind).toBe("correction");
    expect(parseLedgerForm(form({ ...valid, corrects_entry_id: "x" })).ok).toBe(false);
  });
  it("eksik/geçersiz alanları reddeder", () => {
    expect(parseLedgerForm(form({ ...valid, transaction_type: "x" })).ok).toBe(false);
    expect(parseLedgerForm(form({ ...valid, transaction_date: "2026-13-01" })).ok).toBe(false);
    expect(parseLedgerForm(form({ ...valid, party_name: " " })).ok).toBe(false);
    expect(parseLedgerForm(form({ ...valid, amount_try: "-1" })).ok).toBe(false);
    expect(parseLedgerForm(form({ ...valid, payment_method: "x" })).ok).toBe(false);
  });
  it("TC kimlik numarası benzeri 11 haneyi ad ve nota yazdırmaz", () => {
    const a = parseLedgerForm(form({ ...valid, party_name: "Ali 12345678901" }));
    expect(a.ok).toBe(false);
    const b = parseLedgerForm(form({ ...valid, note: "TC: 123 456 789 01" }));
    expect(b.ok).toBe(false);
  });
});

describe("filtre", () => {
  it("bilinmeyen filtre ve bozuk sayfa temizlenir", () => {
    expect(parseLedgerFilters({ filtre: "x", tur: "y", sayfa: "-3" })).toEqual({ filtre: "", tur: "", sayfa: 1 });
    expect(parseLedgerFilters({ filtre: "suredoldu", tur: "sale", sayfa: "4" })).toEqual({
      filtre: "suredoldu",
      tur: "sale",
      sayfa: 4,
    });
  });
});
