import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getPlatformSetting = vi.fn();
vi.mock("@/lib/platform-settings", () => ({ getPlatformSetting: (k: string) => getPlatformSetting(k) }));
const chargeStoredCard = vi.fn();
vi.mock("@/lib/billing/iyzico", async (orig) => ({
  ...(await orig<typeof import("@/lib/billing/iyzico")>()),
  isIyzicoConfigured: () => true,
  chargeStoredCard: (...a: unknown[]) => chargeStoredCard(...a),
  verifyStoredCardPayment: () => ({ paymentId: "pay-1", amountTry: 120, currency: "TRY" }),
}));
const order: string[] = [];
const createCheckoutInvoice = vi.fn();
const fulfillSuccessfulPayment = vi.fn();
const markCheckoutInvoiceFailed = vi.fn();
const markCheckoutInvoiceInitialized = vi.fn();
vi.mock("@/lib/billing/fulfillment", () => {
  class DuplicateAutoRenewAttemptError extends Error {}
  return {
    DuplicateAutoRenewAttemptError,
    createCheckoutInvoice: (...a: unknown[]) => createCheckoutInvoice(...a),
    fulfillSuccessfulPayment: (...a: unknown[]) => fulfillSuccessfulPayment(...a),
    invoiceAmountsTry: () => ({ amountTry: 100, taxTry: 20, totalTry: 120 }),
    markCheckoutInvoiceFailed: (...a: unknown[]) => markCheckoutInvoiceFailed(...a),
    markCheckoutInvoiceInitialized: (...a: unknown[]) => markCheckoutInvoiceInitialized(...a),
  };
});
vi.mock("@/lib/billing/buyer", () => ({
  validateCheckoutBuyer: () => ({ buyer: {}, billingAddress: {} }),
}));
vi.mock("@/lib/notify-batch", () => ({ insertNotifications: vi.fn() }));

import { autoRenewAttemptKeyOf, runAutoRenewPass } from "./auto-renew";
import { DuplicateAutoRenewAttemptError } from "@/lib/billing/fulfillment";

/** Tabloya göre sabit yanıt veren zincir (select/eq/filter/gte/order/not/limit/maybeSingle hepsi zincirler). */
function fakeAdmin(over: { prior?: unknown[] } = {}) {
  const tables: Record<string, unknown> = {
    tenant_payment_profiles: [
      {
        tenant_id: "t1",
        provider_card_user_key: "cuk-12345678",
        auto_renew_card_id: "c1",
        auto_renew_consent_by: "u1",
        auto_renew_consent_ip: "1.2.3.4",
      },
    ],
    subscriptions: { id: "s1", plan: "office", billing_cycle: "monthly", amount_try: 100, status: "past_due", current_period_end: "2026-09-01T00:00:00Z" },
    invoices: over.prior ?? [],
    payment_cards: { provider_card_token: "tok-12345678" },
    tenants: { tax_number: "1", phone: "p", address_line: "a", city: "c" },
    profiles: { full_name: "Ali", phone: "p" },
  };
  const from = (table: string) => {
    const data = tables[table];
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "filter", "gte", "order"]) chain[m] = () => chain;
    chain.limit = async () => ({ data, error: null });
    chain.maybeSingle = async () => ({ data, error: null });
    chain.then = (res: (v: unknown) => unknown) => res({ data, error: null });
    return chain;
  };
  return { from, auth: { admin: { getUserById: async () => ({ data: { user: { email: "a@b.co" } } }) } } } as never;
}

describe("otomatik yenileme: çift tahsilat ve sıra", () => {
  beforeEach(() => {
    getPlatformSetting.mockReset().mockResolvedValue("true");
    chargeStoredCard.mockReset().mockImplementation(async () => {
      order.push("charge");
      return {};
    });
    createCheckoutInvoice.mockReset().mockResolvedValue({ invoiceId: "inv1", totalTry: 120, credit: null });
    fulfillSuccessfulPayment.mockReset().mockImplementation(async () => {
      order.push("fulfill");
    });
    markCheckoutInvoiceFailed.mockReset();
    markCheckoutInvoiceInitialized.mockReset().mockImplementation(async () => {
      order.push("init");
    });
    order.length = 0;
  });

  it("fatura tahsilattan ÖNCE initialized olur, sonra tahsilat, sonra fulfill", async () => {
    const res = await runAutoRenewPass(fakeAdmin(), 1_000);
    expect(order).toEqual(["init", "charge", "fulfill"]);
    expect(res.charged).toBe(1);
    expect(createCheckoutInvoice.mock.calls[0]![0]).toMatchObject({
      source: "auto_renew",
      autoRenewAttemptKey: autoRenewAttemptKeyOf("s1", "2026-09-01", 1),
    });
  });

  it("aynı denemenin faturası zaten varsa (eş zamanlı koşu) kart ÇEKİLMEZ", async () => {
    createCheckoutInvoice.mockRejectedValue(new DuplicateAutoRenewAttemptError());
    const res = await runAutoRenewPass(fakeAdmin(), 1_000);
    expect(chargeStoredCard).not.toHaveBeenCalled();
    expect(res.skipped).toBe(1);
    expect(res.attempted).toBe(0);
  });

  it("initialized yapılamazsa kart ÇEKİLMEZ ve fatura başarısız işaretlenir", async () => {
    markCheckoutInvoiceInitialized.mockRejectedValue(new Error("x"));
    const res = await runAutoRenewPass(fakeAdmin(), 1_000);
    expect(chargeStoredCard).not.toHaveBeenCalled();
    expect(markCheckoutInvoiceFailed).toHaveBeenCalled();
    expect(res.failed).toBe(1);
  });

  it("çözülmemiş (initialized) önceki deneme varsa yeni tahsilat YAPILMAZ", async () => {
    const prior = [{ created_at: "2020-01-01T00:00:00Z", status: "draft", checkout_status: "initialized" }];
    const res = await runAutoRenewPass(fakeAdmin({ prior }), Date.parse("2026-10-05T00:00:00Z"));
    expect(createCheckoutInvoice).not.toHaveBeenCalled();
    expect(chargeStoredCard).not.toHaveBeenCalled();
    expect(res.skipped).toBe(1);
  });

  it("tahsilat doğrulandıktan sonra fulfill hatası faturayı başarısız İŞARETLEMEZ", async () => {
    fulfillSuccessfulPayment.mockRejectedValue(new Error("rpc"));
    const res = await runAutoRenewPass(fakeAdmin(), 1_000);
    expect(markCheckoutInvoiceFailed).not.toHaveBeenCalled();
    expect(res.failed).toBe(1);
  });
});

describe("otomatik yenileme: KAPALI bayrak", () => {
  beforeEach(() => {
    getPlatformSetting.mockReset();
    chargeStoredCard.mockReset();
  });

  it.each([null, "", "false", "0", "yes"])("bayrak %j iken hiçbir sorgu/ödeme çağrısı yapılmaz", async (flag) => {
    getPlatformSetting.mockResolvedValue(flag);
    const from = vi.fn();
    const admin = { from, auth: { admin: { getUserById: vi.fn() } } } as never;
    const res = await runAutoRenewPass(admin, 1_000);
    expect(res).toEqual({ enabled: false, attempted: 0, charged: 0, failed: 0, skipped: 0 });
    expect(from).not.toHaveBeenCalled();
    expect(chargeStoredCard).not.toHaveBeenCalled();
    expect(getPlatformSetting).toHaveBeenCalledWith("billing.auto_renew_enabled");
  });

  it("bayrak açık ama rıza veren ofis yoksa ödeme çağrısı yapılmaz", async () => {
    getPlatformSetting.mockResolvedValue("true");
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not"]) chain[m] = () => chain;
    chain.limit = async () => ({ data: [], error: null });
    const admin = { from: () => chain } as never;
    const res = await runAutoRenewPass(admin, 1_000);
    expect(res.enabled).toBe(true);
    expect(res.attempted).toBe(0);
    expect(chargeStoredCard).not.toHaveBeenCalled();
  });
});
