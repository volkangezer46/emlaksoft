import { describe, expect, it } from "vitest";
import { resolvePeriod } from "./period";
import {
  classifyInvoiceKind,
  isOverdue,
  matchesLedger,
  paymentMethodOf,
  parseLedgerFilter,
  parseTlToKurus,
  refundSplit,
  summarizeLedger,
  summarizeOffice,
  toKurus,
  toLedgerInvoice,
  vatRatePercent,
  type RawInvoiceRow,
} from "./ledger";

const NOW = Date.parse("2026-10-15T09:00:00Z");
const PERIOD = resolvePeriod({}, NOW); // Ekim 2026 (TR)

let n = 0;
function raw(over: Partial<RawInvoiceRow> & { meta?: Record<string, unknown> } = {}): RawInvoiceRow {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    tenant_id: "11111111-1111-4111-8111-111111111111",
    subscription_id: null,
    invoice_no: `ES-${n}`,
    status: "paid",
    amount_try: "1000.00",
    tax_try: "200.00",
    total_try: "1200.00",
    currency: "TRY",
    due_at: null,
    paid_at: "2026-10-10T10:00:00Z",
    created_at: "2026-10-09T10:00:00Z",
    iyzico_payment_id: "pay_1",
    meta: { plan: "office", source: "checkout" },
    tenant: { id: "t", name: "Örnek Emlak", tax_office: "Kadıköy", tax_number: "1234567890" },
    ...over,
  };
}
const inv = (over: Parameters<typeof raw>[0] = {}, coupon?: { code: string | null; discountKurus: number }) => toLedgerInvoice(raw(over), coupon);

describe("kuruş ve KDV", () => {
  it("PostgREST numeric string değerlerini kuruşa çevirir", () => {
    expect(toKurus("1200.00")).toBe(120000);
    expect(toKurus(0.1 + 0.2)).toBe(30);
    expect(toKurus(null)).toBe(0);
    expect(toKurus("abc")).toBe(0);
  });

  it("KDV oranı net üzerinden hesaplanır", () => {
    expect(vatRatePercent(inv())).toBe(20);
    expect(vatRatePercent(inv({ amount_try: "0", tax_try: "0", total_try: "0" }))).toBe(0);
    expect(vatRatePercent(inv({ amount_try: "100", tax_try: "18", total_try: "118" }))).toBe(18);
  });

  it("net + KDV = brüt (kuruş tamsayı)", () => {
    const i = inv({ amount_try: "833.33", tax_try: "166.67", total_try: "1000.00" });
    expect(i.netKurus + i.taxKurus).toBe(i.grossKurus);
  });
});

describe("tür ve yöntem", () => {
  it("meta.kind ile tür ayrılır", () => {
    expect(classifyInvoiceKind({ kind: "extra_seats" })).toBe("extra_seats");
    expect(classifyInvoiceKind({ kind: "credit_pack", packId: "x" })).toBe("credit_pack");
    expect(classifyInvoiceKind({ plan: "office", cycle: "monthly" })).toBe("plan");
    expect(classifyInvoiceKind({}, "sub-id")).toBe("plan");
    expect(classifyInvoiceKind({})).toBe("other");
    expect(classifyInvoiceKind({ kind: "bilinmeyen" })).toBe("other");
    expect(classifyInvoiceKind(null)).toBe("other");
  });

  it("ödeme yöntemi: elle kayıt > iyzico > belirsiz", () => {
    expect(paymentMethodOf({ manual_payment: { method: "havale" } }, "pay")).toBe("havale");
    expect(paymentMethodOf({ manual_payment: { method: "garip" } }, null)).toBe("diger");
    expect(paymentMethodOf({}, "pay_1")).toBe("iyzico");
    expect(paymentMethodOf({}, null)).toBe("belirsiz");
  });
});

describe("iade", () => {
  it("iade BRÜT tutardır; net/KDV fatura oranında bölünür", () => {
    const i = inv({ meta: { plan: "office", refund: { amount_try: 600, reason: "x", at: "2026-10-12T10:00:00Z" } } });
    expect(i.refundKurus).toBe(60000);
    const s = refundSplit(i);
    expect(s).toEqual({ net: 50000, tax: 10000, gross: 60000 });
  });

  it("iade yoksa sıfır", () => {
    expect(refundSplit(inv())).toEqual({ net: 0, tax: 0, gross: 0 });
  });
});

describe("summarizeLedger", () => {
  const rows = [
    inv({ paid_at: "2026-10-02T10:00:00Z" }), // plan, iyzico, 1200 brüt
    inv({ paid_at: "2026-10-03T10:00:00Z", meta: { kind: "extra_seats" }, amount_try: "100", tax_try: "20", total_try: "120", iyzico_payment_id: null }), // yöntem belirsiz
    inv({ paid_at: "2026-10-04T10:00:00Z", meta: { kind: "credit_pack", manual_payment: { method: "havale" } }, amount_try: "500", tax_try: "100", total_try: "600", iyzico_payment_id: null }, { code: "YAZ25", discountKurus: 5000 }),
    // dönem DIŞI ödeme (Eylül) tahsilata girmez
    inv({ paid_at: "2026-09-20T10:00:00Z", created_at: "2026-09-19T10:00:00Z" }),
    // dönem sonu sınırı: 1 Kasım 00:00 TR = hariç
    inv({ paid_at: "2026-10-31T21:00:00Z" }),
    // dönem alt sınırı: 1 Ekim 00:00 TR = dahil
    inv({ paid_at: "2026-09-30T21:00:00Z", amount_try: "10", tax_try: "2", total_try: "12" }),
    // iade (dönemde) — önceki ay ödenmiş fatura
    inv({
      paid_at: "2026-09-10T10:00:00Z",
      created_at: "2026-09-09T10:00:00Z",
      meta: { plan: "office", refund: { amount_try: 600, at: "2026-10-05T10:00:00Z" } },
    }),
    inv({ status: "void", paid_at: null }),
  ];
  const open = [
    inv({ status: "open", paid_at: null, due_at: "2026-10-20T00:00:00Z" }), // bekleyen
    inv({ status: "open", paid_at: null, due_at: "2026-10-01T00:00:00Z", amount_try: "50", tax_try: "10", total_try: "60" }), // gecikmiş
    inv({ status: "draft", paid_at: null }), // taslak: borç değil
  ];
  const s = summarizeLedger(rows, open, PERIOD, NOW);

  it("tahsilat: yalnız dönemde ödenenler (sınırlar dahil/hariç doğru)", () => {
    expect(s.collected.count).toBe(4);
    expect(s.collected.gross).toBe(120000 + 12000 + 60000 + 1200);
    expect(s.collected.net).toBe(100000 + 10000 + 50000 + 1000);
    expect(s.collected.tax).toBe(s.collected.gross - s.collected.net);
  });

  it("tür kırılımı toplamı tahsilata eşit", () => {
    const kinds = Object.values(s.byKind);
    expect(kinds.reduce((a, k) => a + k.gross, 0)).toBe(s.collected.gross);
    expect(s.byKind.extra_seats.gross).toBe(12000);
    expect(s.byKind.credit_pack.net).toBe(50000);
    expect(s.byKind.plan.count).toBe(2);
  });

  it("yöntem kırılımı toplamı tahsilata eşit", () => {
    const methods = Object.values(s.byMethod);
    expect(methods.reduce((a, k) => a + k.gross, 0)).toBe(s.collected.gross);
    expect(s.byMethod.havale.count).toBe(1);
    expect(s.byMethod.belirsiz.count).toBe(1);
  });

  it("iade: iade tarihi dönemde olanlar; net tahsilat brüt-iade", () => {
    expect(s.refunds.count).toBe(1);
    expect(s.refunds.gross).toBe(60000);
    expect(s.refunds.net + s.refunds.tax).toBe(60000);
    expect(s.netOfRefundsGross).toBe(s.collected.gross - 60000);
  });

  it("kupon indirimi yalnız tahsil edilen kuponlu faturalardan", () => {
    expect(s.coupon).toEqual({ count: 1, discountKurus: 5000 });
  });

  it("bekleyen/gecikmiş: anlık, taslak hariç", () => {
    expect(s.pending).toEqual({ count: 1, gross: 120000 });
    expect(s.overdue).toEqual({ count: 1, gross: 6000 });
  });

  it("tüm zamanlar dönemi sınırsız toplar", () => {
    const all = summarizeLedger(rows, [], resolvePeriod({ donem: "tumu" }, NOW), NOW);
    expect(all.collected.count).toBe(rows.filter((r) => r.status === "paid").length);
  });
});

describe("defter süzgeci", () => {
  const a = inv({ paid_at: "2026-10-02T10:00:00Z" });
  const b = inv({ status: "open", paid_at: null, due_at: "2026-10-01T00:00:00Z", created_at: "2026-10-03T10:00:00Z", tenant: { id: "t2", name: "Çiçek Gayrimenkul" } });
  const c = inv({ paid_at: "2026-09-10T10:00:00Z", meta: { plan: "x", refund: { amount_try: 100, at: "2026-10-05T10:00:00Z" } } });
  const m = (f: Parameters<typeof matchesLedger>[1]) => [a, b, c].filter((r) => matchesLedger(r, f, PERIOD, NOW));

  it("dönem muhasebe tarihine göre (ödenmiş: ödeme tarihi; açık: oluşturma)", () => {
    expect(m({})).toEqual([a, b]);
  });

  it("durum süzgeçleri", () => {
    expect(m({ durum: "paid" })).toEqual([a]);
    expect(m({ durum: "open" })).toEqual([b]);
    expect(m({ durum: "gecikmis" })).toEqual([b]);
    expect(m({ durum: "iade" })).toEqual([c]);
  });

  it("tutar aralığı (brüt, uçlar dahil) ve arama (Türkçe büyük/küçük harf)", () => {
    expect(m({ minKurus: 120000, maxKurus: 120000 })).toEqual([a, b]);
    expect(m({ minKurus: 120001 })).toEqual([]);
    expect(m({ q: "ÇİÇEK" })).toEqual([b]);
    expect(m({ q: a.invoiceNo })).toEqual([a]);
  });

  it("ofis ve tür süzgeci", () => {
    expect(m({ ofis: "11111111-1111-4111-8111-111111111111" }).length).toBe(2);
    expect(m({ tur: "credit_pack" })).toEqual([]);
  });

  it("parseLedgerFilter geçersiz değerleri atar, parseTlToKurus virgülü anlar", () => {
    expect(parseLedgerFilter({ durum: "x", tur: "plan", ofis: "bozuk", min: "1.234,50", max: "abc" })).toEqual({ tur: "plan", minKurus: 123450 });
    expect(parseTlToKurus("12,5")).toBe(1250);
    expect(parseTlToKurus("-5")).toBeUndefined();
    expect(parseTlToKurus("1,234")).toBeUndefined();
  });

  it("isOverdue yalnız vadesi geçmiş açık fatura", () => {
    expect(isOverdue(b, NOW)).toBe(true);
    expect(isOverdue(a, NOW)).toBe(false);
  });
});

describe("summarizeOffice", () => {
  it("toplam ödeme iade düşülmüş; son tahsilat en yeni ödeme", () => {
    const rows = [
      inv({ paid_at: "2026-08-01T10:00:00Z" }),
      inv({ paid_at: "2026-09-01T10:00:00Z", meta: { plan: "x", refund: { amount_try: 200, at: "2026-09-02T10:00:00Z" } } }),
      inv({ status: "open", paid_at: null, due_at: "2026-10-01T00:00:00Z" }),
      inv({ status: "void", paid_at: null }),
    ];
    const f = summarizeOffice(rows, NOW);
    expect(f.paidCount).toBe(2);
    expect(f.paidGross).toBe(240000);
    expect(f.netPaidGross).toBe(240000 - 20000);
    expect(f.lastPaidAt).toBe("2026-09-01T10:00:00Z");
    expect(f.openCount).toBe(1);
    expect(f.overdueCount).toBe(1);
  });
});
