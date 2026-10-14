import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GP2: otomatik kesilen faturalar sabit %20 yerine kesim anında geçerli KDV oranını (ayar defteri `billing.vat_rate`,
 * getBillingVatRate) kullanır, oranı faturaya (meta.vatRate) ve invoice_lines satırına yazar. Eski faturalar değişmez.
 */
const h = vi.hoisted(() => ({
  rate: 0.2,
  ready: true,
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  updates: [] as { table: string; row: Record<string, unknown> }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/vat-rate", () => ({ getBillingVatRate: async () => h.rate }));
vi.mock("@/lib/growth/engine", () => ({ registerClaimSafe: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string) => (name === "billing_vat_rate_ready" ? { data: h.ready, error: null } : { data: null, error: null }),
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.insert = (row: Record<string, unknown>) => {
        h.inserts.push({ table, row });
        const done = { data: { id: `${table}-${h.inserts.length}` }, error: null };
        const sel: Record<string, unknown> = { select: () => sel, single: async () => done, then: (r: (v: unknown) => unknown) => r({ error: null }) };
        return sel;
      };
      chain.update = (row: Record<string, unknown>) => {
        h.updates.push({ table, row });
        const u: Record<string, unknown> = {};
        for (const m of ["eq", "in"]) u[m] = () => u;
        u.then = (r: (v: unknown) => unknown) => r({ error: null });
        return u;
      };
      return chain;
    },
  }),
}));

import { createCheckoutInvoice, markCheckoutInvoiceFailed, VAT_RATE_NOT_READY_MESSAGE } from "./fulfillment";
import { createSeatInvoice } from "./seat-purchase";
import { createCreditPackInvoice } from "./credit-pack-purchase";
import { autoInvoiceLineRow, invoiceAmountsTry, invoiceVatRateOf } from "./invoice-amounts";
import { quoteCreditPack } from "./credit-pack-purchase-core";

const invoiceInserts = () => h.inserts.filter((i) => i.table === "invoices").map((i) => i.row);
const lineInserts = () => h.inserts.filter((i) => i.table === "invoice_lines").map((i) => i.row);
const base = { tenantId: "t1", subscriptionId: "s1", plan: "office", cycle: "monthly" as const };

describe("tutar kuralı (saf)", () => {
  it("oran parametresi: varsayılan %20, verilen oranla KDV/toplam; geçersiz oran reddedilir", () => {
    expect(invoiceAmountsTry(2490)).toEqual({ amountTry: 2490, taxTry: 498, totalTry: 2988 });
    expect(invoiceAmountsTry(2490, 0.18)).toEqual({ amountTry: 2490, taxTry: 448.2, totalTry: 2938.2 });
    expect(invoiceAmountsTry(999.99, 0.01)).toEqual({ amountTry: 999.99, taxTry: 10, totalTry: 1009.99 });
    expect(() => invoiceAmountsTry(100, 1)).toThrow();
    expect(() => invoiceAmountsTry(100, -0.1)).toThrow();
  });

  it("faturanın oranı meta.vatRate'ten; yoksa/bozuksa %20 (eski faturalar)", () => {
    expect(invoiceVatRateOf({ vatRate: 0.18 })).toBe(0.18);
    expect(invoiceVatRateOf({ vatRate: 0 })).toBe(0);
    expect(invoiceVatRateOf({})).toBe(0.2);
    expect(invoiceVatRateOf({ vatRate: "0.18" })).toBe(0.2);
    expect(invoiceVatRateOf({ vatRate: 1.2 })).toBe(0.2);
    expect(invoiceVatRateOf(null)).toBe(0.2);
  });

  it("satır AD2 biçiminde: açıklama meta'dan, miktar 1, tutarlar faturayla aynı", () => {
    expect(
      autoInvoiceLineRow({ invoiceId: "i1", tenantId: "t1", meta: { kind: "extra_seats" }, amounts: invoiceAmountsTry(300, 0.18), vatRate: 0.18 }),
    ).toEqual({
      invoice_id: "i1",
      tenant_id: "t1",
      position: 1,
      description: "Ek kullanıcı",
      quantity: 1,
      unit_net_try: 300,
      vat_rate: 0.18,
      net_try: 300,
      tax_try: 54,
      total_try: 354,
    });
  });

  it("analiz paketi ön izlemesi verilen oranla hesaplanır", () => {
    const pack = { id: "p", units: 1000, months: 12 as const, priceNetTry: 1000 };
    expect(quoteCreditPack(pack).totalTry).toBe(1200);
    expect(quoteCreditPack(pack, 0.1).totalTry).toBe(1100);
  });
});

describe("otomatik fatura kesimi: geçerlilik tarihli KDV", () => {
  beforeEach(() => {
    h.rate = 0.2;
    h.ready = true;
    h.inserts.length = 0;
    h.updates.length = 0;
  });

  it("KDV ayarı değişince yeni fatura yeni oranla, önceki fatura eski oranıyla kalır; ikisine de satır yazılır", async () => {
    const first = await createCheckoutInvoice({ ...base, conversationId: "c1", amountTry: 2490 });
    h.rate = 0.18; // ayar defteri: yeni dönem kaydı yürürlüğe girdi
    const second = await createCheckoutInvoice({ ...base, conversationId: "c2", amountTry: 2490 });

    expect(first).toMatchObject({ totalTry: 2988, vatRate: 0.2 });
    expect(second).toMatchObject({ totalTry: 2938.2, vatRate: 0.18 });
    const [a, b] = invoiceInserts();
    expect(a).toMatchObject({ amount_try: 2490, tax_try: 498, total_try: 2988, meta: { vatRate: 0.2, conversationId: "c1" } });
    expect(b).toMatchObject({ amount_try: 2490, tax_try: 448.2, total_try: 2938.2, meta: { vatRate: 0.18, conversationId: "c2" } });
    // Eski faturaya dokunulmaz (oran değişimi geriye dönük güncelleme yapmaz).
    expect(h.updates.filter((u) => u.table === "invoices")).toHaveLength(0);
    expect(lineInserts()).toEqual([
      expect.objectContaining({ description: "Abonelik: office", vat_rate: 0.2, net_try: 2490, tax_try: 498, total_try: 2988 }),
      expect.objectContaining({ description: "Abonelik: office", vat_rate: 0.18, net_try: 2490, tax_try: 448.2, total_try: 2938.2 }),
    ]);
  });

  it("ek kullanıcı ve analiz paketi faturaları da kesim anındaki oranı yazar", async () => {
    h.rate = 0.1;
    const seat = await createSeatInvoice({
      ...base,
      conversationId: "c3",
      chargeNetTry: 300,
      fromExtraSeats: 0,
      toExtraSeats: 1,
      targetTotalSeats: 11,
      quotedPeriodTry: 300,
    });
    const pack = await createCreditPackInvoice({ tenantId: "t1", pack: { id: "p", units: 1000, months: 12, priceNetTry: 1000 }, conversationId: "c4" });
    expect(seat.totalTry).toBe(330);
    expect(pack.totalTry).toBe(1100);
    const [s, p] = invoiceInserts();
    expect(s).toMatchObject({ tax_try: 30, meta: { kind: "extra_seats", vatRate: 0.1 } });
    expect(p).toMatchObject({ tax_try: 100, meta: { kind: "credit_pack", vatRate: 0.1 } });
    expect(lineInserts().map((l) => l.description)).toEqual(["Ek kullanıcı", "EmlakFiyatı analiz bakiyesi paketi"]);
  });

  it("oran %20'den farklıyken DB hazır değilse (fulfill sabit %20) fatura açılmaz: fail-closed", async () => {
    h.rate = 0.18;
    h.ready = false;
    await expect(createCheckoutInvoice({ ...base, conversationId: "c5", amountTry: 2490 })).rejects.toThrow(VAT_RATE_NOT_READY_MESSAGE);
    expect(invoiceInserts()).toHaveLength(0);
  });

  it("kart reddi metni faturanın checkout_error alanına yazılır", async () => {
    await markCheckoutInvoiceFailed({ invoiceId: "i1", tenantId: "t1", checkoutError: "10051: Kart limiti yetersiz" });
    expect(h.updates[0]).toEqual({
      table: "invoices",
      row: { checkout_status: "initialization_failed", checkout_error: "10051: Kart limiti yetersiz" },
    });
  });
});
