import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  rpc: vi.fn(),
  linkResult: {
    data: {
      id: "22222222-2222-2222-2222-222222222222",
      tenant_id: "11111111-1111-1111-1111-111111111111",
      amount_try: 12500,
    },
    error: null as { code?: string; message: string } | null,
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: db.rpc,
    from: (table: string) => {
      if (table !== "payment_links") throw new Error(`Unexpected table: ${table}`);
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve(db.linkResult),
      };
      return builder;
    },
  }),
}));

import { captureFailureStatus, fulfillSuccessfulPayment, invoiceAmountsTry } from "./fulfillment";
import { fulfillPaymentLinkByConversation } from "./payment-link-fulfill";

describe("atomic billing fulfillment adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("IYZICO_API_KEY", "sandbox-api-key");
    vi.stubEnv("IYZICO_SECRET_KEY", "merchant_secret_key");
    db.linkResult = {
      data: {
        id: "22222222-2222-2222-2222-222222222222",
        tenant_id: "11111111-1111-1111-1111-111111111111",
        amount_try: 12500,
      },
      error: null,
    };
    db.rpc.mockImplementation(async (name: string) => {
      if (name === "record_billing_payment_capture") {
        return { data: { ok: true, captureId: "33333333-3333-4333-8333-333333333333" }, error: null };
      }
      if (name === "transition_billing_payment_capture") {
        return { data: { ok: true }, error: null };
      }
      if (name === "try_credit_invoice_hold") return { data: { has_hold: false }, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("calculates the gross amount charged for VAT-exclusive plan prices", () => {
    expect(invoiceAmountsTry(2490)).toEqual({
      amountTry: 2490,
      taxTry: 498,
      totalTry: 2988,
    });
    expect(invoiceAmountsTry(57504)).toEqual({
      amountTry: 57504,
      taxTry: 11500.8,
      totalTry: 69004.8,
    });
  });

  it("routes permanent, capacity and transient failures to distinct reconciliation states", () => {
    expect(captureFailureStatus("22023")).toBe("refund_required");
    expect(captureFailureStatus("23505")).toBe("refund_required");
    expect(captureFailureStatus("P0002")).toBe("refund_required");
    expect(captureFailureStatus("P0001")).toBe("manual_review");
    expect(captureFailureStatus("55000")).toBe("retry_pending");
  });

  it("binds every verified subscription expectation to the service-role RPC", async () => {
    db.rpc.mockImplementation(async (name: string) => {
      if (name === "record_billing_payment_capture") {
        return { data: { ok: true, captureId: "33333333-3333-4333-8333-333333333333" }, error: null };
      }
      if (name === "fulfill_billing_payment_v2") return {
        data: {
          ok: true,
          already: false,
          targetType: "subscription",
          tenantId: "11111111-1111-1111-1111-111111111111",
        },
        error: null,
      };
      if (name === "transition_billing_payment_capture") return { data: { ok: true }, error: null };
      if (name === "try_credit_invoice_hold") return { data: { has_hold: false }, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await expect(
      fulfillSuccessfulPayment({
        tenantId: "11111111-1111-1111-1111-111111111111",
        plan: "professional",
        cycle: "yearly",
        conversationId: "subscription-conversation",
        paymentId: "provider-payment-1",
        expectedAmountTry: 69004.8,
        expectedCurrency: "TRY",
        source: "webhook",
      }),
    ).resolves.toMatchObject({ ok: true, already: false });

    expect(db.rpc).toHaveBeenCalledWith("fulfill_billing_payment_v2", {
      p_provider: "iyzico",
      p_conversation_id: "subscription-conversation",
      p_payment_id: "provider-payment-1",
      p_source: "webhook",
      p_target_type: "subscription",
      p_expected_tenant_id: "11111111-1111-1111-1111-111111111111",
      p_expected_plan: "professional",
      p_expected_cycle: "yearly",
      p_expected_amount_try: 69004.8,
      p_expected_currency: "TRY",
    });
  });

  it("binds payment-link tenant, amount and provider payment identity", async () => {
    db.rpc.mockImplementation(async (name: string) => {
      if (name === "record_billing_payment_capture") {
        return { data: { ok: true, captureId: "33333333-3333-4333-8333-333333333333" }, error: null };
      }
      if (name === "fulfill_billing_payment_v2") return {
        data: {
          ok: true,
          already: true,
          targetType: "payment_link",
          tenantId: "11111111-1111-1111-1111-111111111111",
        },
        error: null,
      };
      if (name === "transition_billing_payment_capture") return { data: { ok: true }, error: null };
      if (name === "try_credit_invoice_hold") return { data: { has_hold: false }, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await expect(
      fulfillPaymentLinkByConversation("plink-safe-token", "callback", {
        status: "success",
        paymentStatus: "SUCCESS",
        paymentId: "provider-payment-2",
        price: 12500,
        paidPrice: 12500,
        currency: "TRY",
        basketId: "22222222-2222-2222-2222-222222222222",
        conversationId: "plink-safe-token",
        token: "token-2",
        fraudStatus: 1,
        signature: "56322212e420a389a70c2985bde67592109bbaffb2d8136e376df17869b72743",
      }),
    ).resolves.toBe(true);

    expect(db.rpc).toHaveBeenCalledWith("fulfill_billing_payment_v2", {
      p_provider: "iyzico",
      p_conversation_id: "plink-safe-token",
      p_payment_id: "provider-payment-2",
      p_source: "callback",
      p_target_type: "payment_link",
      p_expected_tenant_id: "11111111-1111-1111-1111-111111111111",
      p_expected_plan: null,
      p_expected_cycle: null,
      p_expected_amount_try: 12500,
      p_expected_currency: "TRY",
    });
  });

  it("throws on RPC failure so callbacks and webhooks are retried", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.rpc.mockImplementation(async (name: string) => {
      if (name === "record_billing_payment_capture") {
        return { data: { ok: true, captureId: "33333333-3333-4333-8333-333333333333" }, error: null };
      }
      if (name === "fulfill_billing_payment_v2") {
        return { data: null, error: { code: "55000", message: "atomic write failed" } };
      }
      if (name === "transition_billing_payment_capture") return { data: { ok: true }, error: null };
      if (name === "try_credit_invoice_hold") return { data: { has_hold: false }, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await expect(
      fulfillSuccessfulPayment({
        tenantId: "11111111-1111-1111-1111-111111111111",
        plan: "office",
        cycle: "monthly",
        conversationId: "failed-conversation",
        paymentId: "provider-payment-3",
        expectedAmountTry: 2988,
        expectedCurrency: "TRY",
        source: "callback",
      }),
    ).rejects.toThrow("güvenli tahsilat kaydı tamamlanamadı");
    expect(consoleError).toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith("transition_billing_payment_capture", {
      p_capture_id: "33333333-3333-4333-8333-333333333333",
      p_status: "retry_pending",
      p_error_code: "55000",
    });
  });
});
