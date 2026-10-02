import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BillingCycle, PlanId } from "@/lib/billing/plans";
import { IYZICO_CURRENCY } from "@/lib/billing/iyzico";

export type FulfillInput = {
  tenantId: string;
  plan: PlanId;
  cycle: BillingCycle;
  conversationId: string;
  paymentId?: string | null;
  expectedAmountTry: number;
  expectedCurrency: typeof IYZICO_CURRENCY;
  source: "callback" | "webhook" | "demo";
};

function invoiceNo(tenantId: string) {
  const stamp = new Date().toISOString().slice(0, 7).replace("-", "");
  const short = tenantId.replace(/-/g, "").slice(0, 6).toUpperCase();
  const nonce = randomBytes(6).toString("hex").toUpperCase();
  return `ES-${stamp}-${short}-${nonce}`;
}

export type FulfillmentTarget = "subscription" | "payment_link";

export type AtomicFulfillmentResult = {
  ok: true;
  already: boolean;
  targetType: FulfillmentTarget;
  tenantId?: string;
  invoiceId?: string;
  paymentLinkId?: string;
  plan?: PlanId;
  cycle?: BillingCycle;
  commissionUpdated?: boolean;
};

type AtomicFulfillmentInput = {
  provider: "iyzico" | "demo";
  conversationId: string;
  paymentId?: string | null;
  source: FulfillInput["source"];
  targetType: FulfillmentTarget;
  expectedTenantId?: string | null;
  expectedPlan?: PlanId | null;
  expectedCycle?: BillingCycle | null;
  expectedAmountTry?: number | null;
  expectedCurrency: typeof IYZICO_CURRENCY;
};

type CaptureTransition = "fulfilled" | "retry_pending" | "manual_review" | "refund_required";

export function captureFailureStatus(errorCode: string | null | undefined): CaptureTransition {
  const code = String(errorCode ?? "").toUpperCase();
  if (["22023", "23505", "P0002"].includes(code)) return "refund_required";
  if (code === "P0001") return "manual_review";
  return "retry_pending";
}

async function transitionCapture(
  captureId: string,
  status: CaptureTransition,
  errorCode?: string | null,
) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("transition_billing_payment_capture", {
    p_capture_id: captureId,
    p_status: status,
    p_error_code: errorCode ?? null,
  });
  if (error) {
    console.error("transitionCapture", {
      captureId,
      status,
      code: error.code,
      message: error.message,
    });
  }
}

export function invoiceAmountsTry(netAmountTry: number) {
  if (!Number.isFinite(netAmountTry) || netAmountTry <= 0) {
    throw new Error("Fatura tutarı geçersiz.");
  }
  const amountTry = Math.round(netAmountTry * 100) / 100;
  const taxTry = Math.round(amountTry * 0.2 * 100) / 100;
  const totalTry = Math.round((amountTry + taxTry) * 100) / 100;
  return { amountTry, taxTry, totalTry };
}

/** Service-role RPC is the only fulfillment write boundary. */
export async function fulfillBillingPaymentAtomic(
  input: AtomicFulfillmentInput,
): Promise<AtomicFulfillmentResult> {
  if (
    typeof input.expectedAmountTry !== "number" ||
    !Number.isFinite(input.expectedAmountTry) ||
    input.expectedAmountTry <= 0
  ) {
    throw new Error("Beklenen tahsilat tutarı geçersiz.");
  }

  const admin = createAdminClient();
  let captureId: string | null = null;
  if (input.provider === "iyzico") {
    const paymentId = input.paymentId?.trim();
    if (!paymentId) throw new Error("Sağlayıcı tahsilat kimliği bulunamadı.");

    // This RPC commits before fulfillment. If the following transaction fails,
    // operations still has an authoritative captured-payment reconciliation row.
    const { data: capture, error: captureError } = await admin.rpc(
      "record_billing_payment_capture",
      {
        p_provider: input.provider,
        p_conversation_id: input.conversationId,
        p_payment_id: paymentId,
        p_target_type: input.targetType,
        p_expected_tenant_id: input.expectedTenantId || null,
        p_expected_amount_try: input.expectedAmountTry,
        p_expected_currency: input.expectedCurrency,
        p_source: input.source,
      },
    );
    if (captureError) {
      console.error("recordBillingPaymentCapture", {
        source: input.source,
        targetType: input.targetType,
        code: captureError.code,
        message: captureError.message,
      });
      throw new Error("Ödeme doğrulandı ancak mutabakat kaydı oluşturulamadı.");
    }
    captureId = typeof capture === "object" && capture && !Array.isArray(capture)
      ? String(capture.captureId ?? "") || null
      : null;
    if (!captureId) throw new Error("Ödeme mutabakat kimliği doğrulanamadı.");
  }

  const { data, error } = await admin.rpc("fulfill_billing_payment_v2", {
    p_provider: input.provider,
    p_conversation_id: input.conversationId,
    p_payment_id: input.paymentId || null,
    p_source: input.source,
    p_target_type: input.targetType,
    p_expected_tenant_id: input.expectedTenantId || null,
    p_expected_plan: input.expectedPlan || null,
    p_expected_cycle: input.expectedCycle || null,
    p_expected_amount_try: input.expectedAmountTry ?? null,
    p_expected_currency: input.expectedCurrency,
  });

  if (error) {
    if (captureId) {
      await transitionCapture(
        captureId,
        captureFailureStatus(error.code),
        error.code || "rpc_error",
      );
    }
    console.error("fulfillBillingPaymentAtomic", {
      source: input.source,
      targetType: input.targetType,
      code: error.code,
      message: error.message,
    });
    throw new Error("Ödeme doğrulandı ancak güvenli tahsilat kaydı tamamlanamadı.");
  }

  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    data.ok !== true ||
    data.targetType !== input.targetType
  ) {
    if (captureId) await transitionCapture(captureId, "manual_review", "invalid_rpc_result");
    console.error("fulfillBillingPaymentAtomic invalid result", {
      source: input.source,
      targetType: input.targetType,
    });
    throw new Error("Ödeme tahsilat sonucu doğrulanamadı.");
  }

  if (captureId) await transitionCapture(captureId, "fulfilled");

  return {
    ...(data as AtomicFulfillmentResult),
    ok: true,
    already: data.already === true,
    targetType: input.targetType,
  };
}

/**
 * Ödeme başarılı olduğunda abonelik + fatura + tenant planını senkronlar.
 * Idempotent: aynı conversationId için ikinci çağrı no-op.
 */
export async function fulfillSuccessfulPayment(input: FulfillInput) {
  return fulfillBillingPaymentAtomic({
    provider: input.source === "demo" ? "demo" : "iyzico",
    conversationId: input.conversationId,
    paymentId: input.paymentId,
    source: input.source,
    targetType: "subscription",
    expectedTenantId: input.tenantId,
    expectedPlan: input.plan,
    expectedCycle: input.cycle,
    expectedAmountTry: input.expectedAmountTry,
    expectedCurrency: input.expectedCurrency,
  });
}

export async function createCheckoutInvoice(input: {
  tenantId: string;
  subscriptionId: string | null;
  plan: PlanId;
  cycle: BillingCycle;
  conversationId: string;
  amountTry: number;
}) {
  const admin = createAdminClient();
  const amounts = invoiceAmountsTry(input.amountTry);
  const now = new Date();
  const checkoutExpiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const { data, error } = await admin
    .from("invoices")
    .insert({
      tenant_id: input.tenantId,
      subscription_id: input.subscriptionId,
      invoice_no: invoiceNo(input.tenantId),
      status: "draft",
      checkout_status: "pending_checkout",
      checkout_expires_at: checkoutExpiresAt.toISOString(),
      amount_try: amounts.amountTry,
      tax_try: amounts.taxTry,
      total_try: amounts.totalTry,
      currency: IYZICO_CURRENCY,
      period_start: null,
      period_end: null,
      due_at: null,
      meta: {
        conversationId: input.conversationId,
        plan: input.plan,
        cycle: input.cycle,
        source: "checkout",
      },
    })
    .select("id")
    .single();

  if (error) {
    console.error("createCheckoutInvoice", error);
    throw new Error("Fatura oluşturulamadı.");
  }
  return data.id as string;
}

export async function markCheckoutInvoiceInitialized(input: {
  invoiceId: string;
  tenantId: string;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("invoices")
    .update({
      checkout_status: "initialized",
      checkout_initialized_at: new Date().toISOString(),
    })
    .eq("id", input.invoiceId)
    .eq("tenant_id", input.tenantId)
    .eq("status", "draft")
    .eq("checkout_status", "pending_checkout")
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.error("markCheckoutInvoiceInitialized", error);
    throw new Error("Ödeme oturumu fatura taslağıyla eşleştirilemedi.");
  }
}

export async function markCheckoutInvoiceFailed(input: {
  invoiceId: string;
  tenantId: string;
}) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("invoices")
    .update({ checkout_status: "initialization_failed" })
    .eq("id", input.invoiceId)
    .eq("tenant_id", input.tenantId)
    .eq("status", "draft")
    .in("checkout_status", ["pending_checkout", "initialized"]);
  if (error) console.error("markCheckoutInvoiceFailed", error);
}

export async function assertBillingPlanPreflight(tenantId: string, plan: PlanId) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("billing_plan_change_preflight", {
    p_tenant_id: tenantId,
    p_plan: plan,
  });
  if (error) {
    console.error("assertBillingPlanPreflight", { code: error.code, message: error.message });
    throw new Error("Paket kapasitesi güvenli şekilde doğrulanamadı.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data) || data.ok !== true) {
    const blockers = data && typeof data === "object" && !Array.isArray(data)
      ? data.blockers
      : null;
    const labels = Array.isArray(blockers)
      ? blockers
          .map((item) => item && typeof item === "object" ? String(item.metric ?? "") : "")
          .filter(Boolean)
      : [];
    const labelMap: Record<string, string> = {
      seats: "aktif kullanıcı",
      customers: "müşteri",
      active_properties: "aktif portföy",
      branches: "aktif şube",
    };
    const detail = labels.map((label) => labelMap[label] ?? label).join(", ");
    throw new Error(
      detail
        ? `Bu pakete geçmeden önce kapasite aşımını giderin: ${detail}.`
        : "Seçilen paket mevcut kullanımı karşılamıyor.",
    );
  }
}
