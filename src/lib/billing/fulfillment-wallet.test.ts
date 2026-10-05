import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rpc: vi.fn(), updates: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: db.rpc,
    from: () => {
      const builder = {
        update: (v: Record<string, unknown>) => {
          db.updates.push(v);
          return builder;
        },
        eq: () => builder,
        in: () => builder,
        then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
      };
      return builder;
    },
  }),
}));

import { fulfillInvoiceWithWalletCredit, fulfillSuccessfulPayment, markCheckoutInvoiceFailed } from "./fulfillment";

const TENANT = "11111111-1111-4111-8111-111111111111";
const INVOICE = "22222222-2222-4222-8222-222222222222";
const RES = "33333333-3333-4333-8333-333333333333";
const CAPTURE = "44444444-4444-4444-8444-444444444444";

const hold = (state: "reserved" | "committed" | "released" = "reserved") => ({
  has_hold: true,
  reservation_id: RES,
  invoice_id: INVOICE,
  state,
  amount: 1494,
  total_try: 2988,
  cash_try: 1494,
});

function wire(holdResult: unknown, fulfillResult?: unknown) {
  db.rpc.mockImplementation(async (name: string) => {
    if (name === "record_billing_payment_capture") return { data: { ok: true, captureId: CAPTURE }, error: null };
    if (name === "transition_billing_payment_capture") return { data: { ok: true }, error: null };
    if (name === "try_credit_invoice_hold") return holdResult;
    if (name === "try_credit_fulfill_invoice" || name === "fulfill_billing_payment_v2") {
      return fulfillResult ?? { data: { ok: true, already: false, targetType: "subscription", tenantId: TENANT }, error: null };
    }
    if (name === "try_credit_release_invoice") return { data: { ok: true, state: "released", already: false }, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });
}

const cardPayment = {
  tenantId: TENANT,
  plan: "office" as const,
  cycle: "monthly" as const,
  conversationId: "es-conv-1",
  paymentId: "pay-123",
  expectedCurrency: "TRY" as const,
  source: "callback" as const,
};

describe("kredi rezervli fatura: ödeme tamamlama yönlendirmesi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.updates.length = 0;
  });

  it("kısmi kredi: capture NAKİT tutarla yazılır, fulfill yerine try_credit_fulfill_invoice(p_cash_try=nakit) çağrılır", async () => {
    wire({ data: hold(), error: null });
    await expect(fulfillSuccessfulPayment({ ...cardPayment, expectedAmountTry: 1494 })).resolves.toMatchObject({ ok: true });

    expect(db.rpc).toHaveBeenCalledWith(
      "record_billing_payment_capture",
      expect.objectContaining({ p_expected_amount_try: 1494, p_payment_id: "pay-123" }),
    );
    expect(db.rpc).toHaveBeenCalledWith("try_credit_fulfill_invoice", {
      p_conversation_id: "es-conv-1",
      p_expected_tenant_id: TENANT,
      p_payment_id: "pay-123",
      p_source: "callback",
      p_expected_plan: "office",
      p_expected_cycle: "monthly",
      p_cash_try: 1494,
    });
    expect(db.rpc).not.toHaveBeenCalledWith("fulfill_billing_payment_v2", expect.anything());
    expect(db.rpc).toHaveBeenCalledWith("transition_billing_payment_capture", expect.objectContaining({ p_status: "fulfilled" }));
  });

  it("rezerv serbest kalmış olsa da kredi yolu seçilir (SQL reddeder → refund_required), düz fulfill'e DÜŞMEZ", async () => {
    wire(
      { data: hold("released"), error: null },
      { data: null, error: { code: "22023", message: "Wallet credit reservation is not active." } },
    );
    await expect(fulfillSuccessfulPayment({ ...cardPayment, expectedAmountTry: 1494 })).rejects.toThrow("güvenli tahsilat kaydı tamamlanamadı");
    expect(db.rpc).not.toHaveBeenCalledWith("fulfill_billing_payment_v2", expect.anything());
    expect(db.rpc).toHaveBeenCalledWith(
      "transition_billing_payment_capture",
      expect.objectContaining({ p_status: "refund_required", p_error_code: "22023" }),
    );
  });

  it("rezerv yok: mevcut davranış AYNEN (fulfill_billing_payment_v2, tam tutar)", async () => {
    wire({ data: { has_hold: false }, error: null });
    await fulfillSuccessfulPayment({ ...cardPayment, expectedAmountTry: 2988 });
    expect(db.rpc).toHaveBeenCalledWith(
      "fulfill_billing_payment_v2",
      expect.objectContaining({ p_provider: "iyzico", p_expected_amount_try: 2988, p_payment_id: "pay-123" }),
    );
    expect(db.rpc).not.toHaveBeenCalledWith("try_credit_fulfill_invoice", expect.anything());
  });

  it("eski şema (RPC yok): rezerv yok sayılır, mevcut akış sürer", async () => {
    wire({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    await fulfillSuccessfulPayment({ ...cardPayment, expectedAmountTry: 2988 });
    expect(db.rpc).toHaveBeenCalledWith("fulfill_billing_payment_v2", expect.anything());
  });

  it("FAIL-CLOSED: rezerv sorgusu belirsizse fulfill ÇAĞRILMAZ, capture retry_pending'e alınır", async () => {
    wire({ data: null, error: { code: "57014", message: "timeout" } });
    await expect(fulfillSuccessfulPayment({ ...cardPayment, expectedAmountTry: 1494 })).rejects.toThrow("kredi durumu doğrulanamadı");
    expect(db.rpc).not.toHaveBeenCalledWith("fulfill_billing_payment_v2", expect.anything());
    expect(db.rpc).not.toHaveBeenCalledWith("try_credit_fulfill_invoice", expect.anything());
    expect(db.rpc).toHaveBeenCalledWith("transition_billing_payment_capture", expect.objectContaining({ p_status: "retry_pending" }));
  });

  it("demo sağlayıcı kredi yoklamasına girmez", async () => {
    wire({ data: hold(), error: null });
    await fulfillSuccessfulPayment({ ...cardPayment, source: "demo", paymentId: "demo-1", expectedAmountTry: 2988 });
    expect(db.rpc).not.toHaveBeenCalledWith("try_credit_invoice_hold", expect.anything());
    expect(db.rpc).toHaveBeenCalledWith("fulfill_billing_payment_v2", expect.objectContaining({ p_provider: "demo" }));
  });
});

describe("tam kredi (iyzico'suz)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("capture YAZILMAZ; nakit 0 ve ödeme kimliği null ile kredi fulfill çağrılır", async () => {
    wire({ data: hold("reserved"), error: null });
    await expect(
      fulfillInvoiceWithWalletCredit({ tenantId: TENANT, plan: "office", cycle: "monthly", conversationId: "es-conv-2" }),
    ).resolves.toMatchObject({ ok: true });
    expect(db.rpc).not.toHaveBeenCalledWith("record_billing_payment_capture", expect.anything());
    expect(db.rpc).toHaveBeenCalledWith("try_credit_fulfill_invoice", {
      p_conversation_id: "es-conv-2",
      p_expected_tenant_id: TENANT,
      p_payment_id: null,
      p_source: "demo",
      p_expected_plan: "office",
      p_expected_cycle: "monthly",
      p_cash_try: 0,
    });
  });

  it("etkin rezerv yoksa REDDEDİLİR (kredisiz fatura asla ücretsiz tamamlanmaz)", async () => {
    wire({ data: { has_hold: false }, error: null });
    await expect(
      fulfillInvoiceWithWalletCredit({ tenantId: TENANT, plan: "office", cycle: "monthly", conversationId: "es-conv-3" }),
    ).rejects.toThrow("etkin bir kredi rezervi bulunamadı");
    expect(db.rpc).not.toHaveBeenCalledWith("try_credit_fulfill_invoice", expect.anything());
    expect(db.rpc).not.toHaveBeenCalledWith("fulfill_billing_payment_v2", expect.anything());
  });

  it("rezerv sorgusu belirsizse REDDEDİLİR", async () => {
    wire({ data: null, error: { code: "57014", message: "timeout" } });
    await expect(
      fulfillInvoiceWithWalletCredit({ tenantId: TENANT, plan: "office", cycle: "monthly", conversationId: "es-conv-4" }),
    ).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalledWith("try_credit_fulfill_invoice", expect.anything());
  });
});

describe("başarısız checkout kredi rezervini bırakır", () => {
  it("markCheckoutInvoiceFailed → try_credit_release_invoice (hata fırlatmaz)", async () => {
    vi.clearAllMocks();
    wire({ data: { has_hold: false }, error: null });
    await markCheckoutInvoiceFailed({ invoiceId: INVOICE, tenantId: TENANT });
    expect(db.rpc).toHaveBeenCalledWith("try_credit_release_invoice", {
      p_tenant: TENANT,
      p_invoice: INVOICE,
      p_reason: "checkout_failed",
    });
  });

  it("RPC yok (eski şema) iken de sessizce geçer", async () => {
    vi.clearAllMocks();
    db.rpc.mockImplementation(async () => ({ data: null, error: { code: "PGRST202", message: "x" } }));
    await expect(markCheckoutInvoiceFailed({ invoiceId: INVOICE, tenantId: TENANT })).resolves.toBeUndefined();
  });
});
