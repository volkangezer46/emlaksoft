import { describe, expect, it } from "vitest";
import { buildReceivedInvoiceEvent, buildSubscriptionEvent, subscriptionSuggestions, type PlatformInvoice } from "./received-invoice";
import { postingRule } from "./posting/rules";
import { isPostingKey } from "./posting/keys";

const REQ = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

describe("gelen fatura olayı (invoice.received)", () => {
  it("KDV dahil tutardan indirilecek KDV ayrılır; tedarikçi carisi; anahtar istek kimliğinden", () => {
    const r = buildReceivedInvoiceEvent({ requestId: REQ, vendor: "  Ofis   Kırtasiye ", invoiceNo: "ABC2026000123", date: "2026-10-05", dueDate: "2026-11-05", amount: 1200, vatRate: 20, category: "ofis" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event).toMatchObject({
      eventType: "invoice.received", postingKey: `invoice_in:${REQ}`, date: "2026-10-05", partyName: "Ofis Kırtasiye", partyKind: "tedarikci",
      item: { amount: 1200, vatRate: 20, vatAmount: 200, category: "ofis", dueDate: "2026-11-05" },
    });
    expect(isPostingKey(r.event.postingKey, "invoice.received")).toBe(true);
    expect(postingRule("invoice.received").itemDirection).toBe("payable");
    expect(r.event.entries).toBeUndefined(); // nakit bu olayda yazılmaz
  });

  it("geçersiz girdi reddedilir (maaş kategorisi, vade < tarih, tutar, KDV oranı, istek kimliği)", () => {
    const base = { requestId: REQ, vendor: "Firma", date: "2026-10-05", amount: 100, vatRate: 20, category: "ofis" };
    expect(buildReceivedInvoiceEvent({ ...base, category: "maas" }).ok).toBe(false);
    expect(buildReceivedInvoiceEvent({ ...base, dueDate: "2026-10-01" }).ok).toBe(false);
    expect(buildReceivedInvoiceEvent({ ...base, amount: 0 }).ok).toBe(false);
    expect(buildReceivedInvoiceEvent({ ...base, vatRate: 18 }).ok).toBe(false);
    expect(buildReceivedInvoiceEvent({ ...base, requestId: "x" }).ok).toBe(false);
    expect(buildReceivedInvoiceEvent({ ...base, date: "2026-02-30" }).ok).toBe(false);
  });
});

describe("abonelik faturası önerisi (otomatik kayıt yok)", () => {
  const inv = (o: Partial<PlatformInvoice>): PlatformInvoice => ({
    id: "11111111-2222-4333-8444-555555555555", invoice_no: "ES-2026-0001", status: "paid", total_try: "1200", tax_try: "200", paid_at: null,
    created_at: "2026-09-30T22:30:00Z", ...o,
  });

  it("kaydedilmiş, taslak/iptal ve sıfır tutarlı faturayı önermez; tarih İstanbul günü", () => {
    const list = subscriptionSuggestions(
      [inv({}), inv({ id: "a", status: "void" }), inv({ id: "b", status: "draft" }), inv({ id: "c", total_try: 0 }), inv({ id: "d", status: "open", created_at: "2026-08-01T10:00:00Z" })],
      new Set(["d"]),
    );
    expect(list).toEqual([{ id: "11111111-2222-4333-8444-555555555555", invoiceNo: "ES-2026-0001", amount: 1200, vat: 200, date: "2026-10-01", paid: true }]);
  });

  it("onaylanınca yazılım gideri borcu: subscription:{id}, kaynak fatura", () => {
    const [s] = subscriptionSuggestions([inv({})], new Set());
    const ev = buildSubscriptionEvent(s!);
    expect(ev).toMatchObject({ eventType: "subscription.invoiced", postingKey: `subscription:${s!.id}`, sourceId: s!.id, date: "2026-10-01", item: { amount: 1200, vatAmount: 200 } });
    expect(isPostingKey(ev.postingKey, "subscription.invoiced")).toBe(true);
    expect(postingRule("subscription.invoiced")).toMatchObject({ itemDirection: "payable", itemCategory: "yazilim", cashMode: "none" });
  });
});
