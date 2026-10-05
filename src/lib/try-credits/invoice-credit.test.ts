import { describe, expect, it } from "vitest";
import { parseMaxShare } from "./config";
import {
  creditRestoreForRefund,
  fromKurus,
  fullCreditEnabled,
  maxCreditForInvoice,
  planInvoiceCredit,
  toKurus,
} from "./invoice-credit";

describe("kuruş matematiği", () => {
  it("float tuzaklarında bile tam kuruş verir", () => {
    expect(toKurus(0.1 + 0.2)).toBe(30);
    expect(toKurus(1234.56)).toBe(123456);
    expect(fromKurus(123456)).toBe(1234.56);
  });
});

describe("parseMaxShare", () => {
  it("varsayılan %50; yüzde ve oran biçimlerini kabul eder; geçersizde varsayılan", () => {
    expect(parseMaxShare(null)).toBe(0.5);
    expect(parseMaxShare("")).toBe(0.5);
    expect(parseMaxShare("0.3")).toBe(0.3);
    expect(parseMaxShare("0,3")).toBe(0.3);
    expect(parseMaxShare("30")).toBe(0.3);
    expect(parseMaxShare("1")).toBe(1);
    expect(parseMaxShare("100")).toBe(1);
    expect(parseMaxShare("0")).toBe(0.5);
    expect(parseMaxShare("-1")).toBe(0.5);
    expect(parseMaxShare("abc")).toBe(0.5);
    expect(parseMaxShare("150")).toBe(0.5);
  });
});

describe("maxCreditForInvoice (tek faturada en fazla %50, bakiye ile sınırlı)", () => {
  it("bakiye bol: yarı tutar (kuruş aşağı yuvarlanır)", () => {
    expect(maxCreditForInvoice({ totalTry: 1000, availableTry: 5000 })).toBe(500);
    expect(maxCreditForInvoice({ totalTry: 1234.57, availableTry: 5000 })).toBe(617.28);
    expect(maxCreditForInvoice({ totalTry: 0.03, availableTry: 5000 })).toBe(0.01);
  });
  it("bakiye az: bakiye kadar", () => {
    expect(maxCreditForInvoice({ totalTry: 1000, availableTry: 120.5 })).toBe(120.5);
  });
  it("eksi/sıfır bakiye ve geçersiz girdi: kredi yok", () => {
    expect(maxCreditForInvoice({ totalTry: 1000, availableTry: 0 })).toBe(0);
    expect(maxCreditForInvoice({ totalTry: 1000, availableTry: -50 })).toBe(0);
    expect(maxCreditForInvoice({ totalTry: 0, availableTry: 100 })).toBe(0);
    expect(maxCreditForInvoice({ totalTry: -5, availableTry: 100 })).toBe(0);
    expect(maxCreditForInvoice({ totalTry: 100, availableTry: 100, maxShare: 0 })).toBe(0);
    expect(maxCreditForInvoice({ totalTry: 100, availableTry: 100, maxShare: 1.5 })).toBe(0);
  });
  it("pay yapılandırılabilir", () => {
    expect(maxCreditForInvoice({ totalTry: 1000, availableTry: 5000, maxShare: 0.3 })).toBe(300);
    expect(maxCreditForInvoice({ totalTry: 1000, availableTry: 5000, maxShare: 1 })).toBe(1000);
  });
});

describe("planInvoiceCredit", () => {
  it("kısmi kredi: nakit = toplam - kredi, fatura toplamı korunur", () => {
    const p = planInvoiceCredit({ totalTry: 2988, availableTry: 10000 });
    expect(p).toEqual({ creditTry: 1494, cashTry: 1494, fullCredit: false });
    expect(p.creditTry + p.cashTry).toBe(2988);
  });
  it("tam kredi yalnız pay=1 ve bakiye yeterliyken", () => {
    expect(planInvoiceCredit({ totalTry: 600, availableTry: 600, maxShare: 1 })).toEqual({
      creditTry: 600,
      cashTry: 0,
      fullCredit: true,
    });
    expect(planInvoiceCredit({ totalTry: 600, availableTry: 10000 }).fullCredit).toBe(false);
    expect(planInvoiceCredit({ totalTry: 600, availableTry: 599.99, maxShare: 1 }).fullCredit).toBe(false);
  });
  it("istenen tutar sınırı aşamaz; sıfır/negatif istek = kredi yok", () => {
    expect(planInvoiceCredit({ totalTry: 1000, availableTry: 5000, requestedTry: 200 }).creditTry).toBe(200);
    expect(planInvoiceCredit({ totalTry: 1000, availableTry: 5000, requestedTry: 900 }).creditTry).toBe(500);
    expect(planInvoiceCredit({ totalTry: 1000, availableTry: 5000, requestedTry: 0 }).creditTry).toBe(0);
    expect(planInvoiceCredit({ totalTry: 1000, availableTry: 5000, requestedTry: -10 }).creditTry).toBe(0);
  });
  it("bakiye yok: nakit toplamın tamamı", () => {
    expect(planInvoiceCredit({ totalTry: 1000, availableTry: 0 })).toEqual({ creditTry: 0, cashTry: 1000, fullCredit: false });
  });
  it("fullCreditEnabled yalnız pay=1", () => {
    expect(fullCreditEnabled(1)).toBe(true);
    expect(fullCreditEnabled(0.5)).toBe(false);
  });
});

describe("creditRestoreForRefund (iade önce nakit, artan kredi)", () => {
  it("nakit kısmı kadar iade krediye dokunmaz", () => {
    expect(creditRestoreForRefund({ refundTry: 1000, cashPaidTry: 1494, creditUsedTry: 1494 })).toBe(0);
  });
  it("tam iade: tüm kredi geri yazılır", () => {
    expect(creditRestoreForRefund({ refundTry: 2988, cashPaidTry: 1494, creditUsedTry: 1494 })).toBe(1494);
  });
  it("kısmi: artan kısım, harcanan krediyi aşamaz, daha önce geri yazılan düşülür", () => {
    expect(creditRestoreForRefund({ refundTry: 2000, cashPaidTry: 1494, creditUsedTry: 1494 })).toBe(506);
    expect(creditRestoreForRefund({ refundTry: 9999, cashPaidTry: 1494, creditUsedTry: 1494 })).toBe(1494);
    expect(creditRestoreForRefund({ refundTry: 2988, cashPaidTry: 1494, creditUsedTry: 1494, alreadyRestoredTry: 494 })).toBe(1000);
    expect(creditRestoreForRefund({ refundTry: 2988, cashPaidTry: 1494, creditUsedTry: 1494, alreadyRestoredTry: 1494 })).toBe(0);
  });
  it("kredi kullanılmamış fatura: 0", () => {
    expect(creditRestoreForRefund({ refundTry: 500, cashPaidTry: 600, creditUsedTry: 0 })).toBe(0);
  });
});
