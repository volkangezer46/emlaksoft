import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MARK_PAID_STATUSES, parseMoneyTry, validatePaidDate, validateRefundAmount } from "./invoice-ops";

describe("validatePaidDate (SK6/B169)", () => {
  const opts = { todayKey: "2026-10-15", issuedKey: "2026-10-01" };
  it("geçersiz takvim günü ve biçim reddedilir (gidiş-dönüş)", () => {
    for (const bad of ["2026-13-01", "2026-02-31", "2026-02-29", "2026-1-5", "15.10.2026", "2026-10-15T00:00"]) {
      expect(validatePaidDate(bad, opts).ok, bad).toBe(false);
    }
    expect(validatePaidDate("2028-02-29", { todayKey: "2028-03-01", issuedKey: null })).toEqual({ ok: true, dateKey: "2028-02-29" });
  });
  it("İstanbul gününe göre gelecek tarih ve kesimden önceki tarih reddedilir", () => {
    expect(validatePaidDate("2099-01-01", opts)).toMatchObject({ ok: false, error: expect.stringContaining("ileri") });
    expect(validatePaidDate("2026-10-16", opts).ok).toBe(false);
    expect(validatePaidDate("2026-09-30", opts)).toMatchObject({ ok: false, error: expect.stringContaining("01.10.2026") });
    expect(validatePaidDate("2026-10-15", opts)).toEqual({ ok: true, dateKey: "2026-10-15" });
    expect(validatePaidDate("2026-10-01", opts)).toEqual({ ok: true, dateKey: "2026-10-01" });
  });
  it("boş tarih = verilmedi", () => {
    expect(validatePaidDate("  ", opts)).toEqual({ ok: true, dateKey: null });
  });
  it("ödendi işaretleme yalnız kesilmiş, ödenmemiş fatura (taslak yok)", () => {
    expect([...MARK_PAID_STATUSES]).toEqual(["open", "uncollectible"]);
  });
});

describe("markInvoicePaid sunucu kuralları (sözleşme)", () => {
  const src = readFileSync(resolve(process.cwd(), "src/app/actions/platform-billing.ts"), "utf8");
  const body = src.slice(src.indexOf("export async function markInvoicePaid"), src.indexOf("export async function voidInvoice"));
  it("durum kümesi daraltıldı; tarih katı doğrulanır; kesim tarihi sınırı uygulanır", () => {
    expect(body).not.toMatch(/\["open", "draft"/);
    expect(body).toMatch(/\.in\("status", \[\.\.\.MARK_PAID_STATUSES\]\)/);
    expect(body).toMatch(/validatePaidDate\(paidDateRaw, \{ todayKey: trDayKey\(nowMs\), issuedKey: issuedIso/);
  });
});

describe("parseMoneyTry", () => {
  it("TR ve nokta biçimlerini okur", () => {
    expect(parseMoneyTry("1.234,56")).toBe(1234.56);
    expect(parseMoneyTry("2490")).toBe(2490);
    expect(parseMoneyTry("2490.5 TL")).toBe(2490.5);
  });
  it("negatif, sıfır, harf, 3 ondalık ve aşırı değeri reddeder", () => {
    for (const bad of ["-5", "0", "abc", "1,234", "99999999", "", "1e5"]) expect(parseMoneyTry(bad), bad).toBeNull();
  });
});

describe("validateRefundAmount", () => {
  it("boş = tam tutar, fazlası reddedilir", () => {
    expect(validateRefundAmount("", 2988)).toEqual({ value: 2988 });
    expect(validateRefundAmount("500", 2988)).toEqual({ value: 500 });
    expect("error" in validateRefundAmount("3000", 2988)).toBe(true);
    expect("error" in validateRefundAmount("-1", 2988)).toBe(true);
  });
});
