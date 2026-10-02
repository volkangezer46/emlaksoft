import { randomUUID } from "node:crypto";
import { fulfillBillingPaymentAtomic } from "@/lib/billing/fulfillment";
import { IYZICO_CURRENCY } from "@/lib/billing/iyzico";
import { isPlanId, type BillingCycle } from "@/lib/billing/plans";
import { createAdminClient } from "@/lib/supabase/admin";

type CaptureRow = {
  id: string;
  conversation_id: string;
  payment_id: string;
  source: "callback" | "webhook";
  target_type: "subscription" | "payment_link";
  tenant_id: string;
  invoice_id: string | null;
  payment_link_id: string | null;
  amount_try: number | string;
  currency: string;
  status: "captured_pending" | "retry_pending";
  reconciliation_attempt_count: number;
};

export type BillingReconciliationSummary = {
  expiredCheckouts: number;
  inspected: number;
  fulfilled: number;
  retryPending: number;
  manualReview: number;
  refundRequired: number;
};

async function transitionCapture(
  captureId: string,
  status: "retry_pending" | "manual_review" | "refund_required",
  errorCode: string,
) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("transition_billing_payment_capture", {
    p_capture_id: captureId,
    p_status: status,
    p_error_code: errorCode,
  });
  if (error) {
    throw new Error(`capture transition failed: ${error.code || "unknown"}`);
  }
}

async function reconcileCapture(capture: CaptureRow): Promise<"fulfilled" | "retry_pending" | "manual_review" | "refund_required"> {
  const amountTry = Number(capture.amount_try);
  if (
    !capture.payment_id?.trim() ||
    !capture.conversation_id?.trim() ||
    !Number.isFinite(amountTry) ||
    amountTry <= 0 ||
    capture.currency !== IYZICO_CURRENCY
  ) {
    await transitionCapture(capture.id, "refund_required", "invalid_capture_contract");
    return "refund_required";
  }

  const admin = createAdminClient();
  let fulfillmentStarted = false;

  try {
    if (capture.target_type === "subscription") {
      if (!capture.invoice_id || capture.conversation_id.startsWith("plink-")) {
        await transitionCapture(capture.id, "refund_required", "invoice_identity_missing");
        return "refund_required";
      }

      const { data: invoice, error } = await admin
        .from("invoices")
        .select("id, tenant_id, meta")
        .eq("id", capture.invoice_id)
        .eq("tenant_id", capture.tenant_id)
        .filter("meta->>conversationId", "eq", capture.conversation_id)
        .maybeSingle();

      if (error) throw new Error(`invoice lookup failed: ${error.code || "unknown"}`);
      const meta = (invoice?.meta ?? {}) as { plan?: string; cycle?: string };
      const plan = meta.plan ?? "";
      const cycle = meta.cycle ?? "";
      if (!invoice || !isPlanId(plan) || !["monthly", "yearly"].includes(cycle)) {
        await transitionCapture(capture.id, "refund_required", "invoice_contract_missing");
        return "refund_required";
      }

      fulfillmentStarted = true;
      await fulfillBillingPaymentAtomic({
        provider: "iyzico",
        conversationId: capture.conversation_id,
        paymentId: capture.payment_id,
        source: capture.source,
        targetType: "subscription",
        expectedTenantId: capture.tenant_id,
        expectedPlan: plan,
        expectedCycle: cycle as BillingCycle,
        expectedAmountTry: amountTry,
        expectedCurrency: IYZICO_CURRENCY,
      });
      return "fulfilled";
    }

    const token = capture.conversation_id.startsWith("plink-")
      ? capture.conversation_id.slice("plink-".length)
      : "";
    if (!capture.payment_link_id || !token) {
      await transitionCapture(capture.id, "refund_required", "payment_link_identity_missing");
      return "refund_required";
    }

    const { data: link, error } = await admin
      .from("payment_links")
      .select("id")
      .eq("id", capture.payment_link_id)
      .eq("tenant_id", capture.tenant_id)
      .eq("token", token)
      .maybeSingle();
    if (error) throw new Error(`payment link lookup failed: ${error.code || "unknown"}`);
    if (!link) {
      await transitionCapture(capture.id, "refund_required", "payment_link_contract_missing");
      return "refund_required";
    }

    fulfillmentStarted = true;
    await fulfillBillingPaymentAtomic({
      provider: "iyzico",
      conversationId: capture.conversation_id,
      paymentId: capture.payment_id,
      source: capture.source,
      targetType: "payment_link",
      expectedTenantId: capture.tenant_id,
      expectedPlan: null,
      expectedCycle: null,
      expectedAmountTry: amountTry,
      expectedCurrency: IYZICO_CURRENCY,
    });
    return "fulfilled";
  } catch (error) {
    // fulfillBillingPaymentAtomic classifies and persists the provider capture
    // state. Lookup/network errors remain retryable for the next bounded run.
    console.error("billing capture reconciliation", {
      captureId: capture.id,
      targetType: capture.target_type,
      error: error instanceof Error ? error.message : "unknown",
    });
    if (!fulfillmentStarted) {
      await transitionCapture(capture.id, "retry_pending", "worker_lookup_error");
      return "retry_pending";
    }

    // The fulfillment boundary already persisted a precise classification.
    // Read it back so the heartbeat summary does not mislabel refund/manual work.
    const { data: persisted } = await admin
      .from("billing_payment_captures")
      .select("status")
      .eq("id", capture.id)
      .maybeSingle();
    if (persisted?.status === "manual_review" || persisted?.status === "refund_required") {
      return persisted.status;
    }
    return "retry_pending";
  }
}

/**
 * Bounded service-role repair loop for captures that were provider-verified but
 * could not be fulfilled locally. It never issues a refund: refund_required is
 * an explicit operations queue requiring the provider refund workflow.
 */
export async function runBillingReconciliation(limit = 50): Promise<BillingReconciliationSummary> {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 200));
  const admin = createAdminClient();
  const workerId = randomUUID();

  const [{ data: expired, error: expireError }, { data, error }] = await Promise.all([
    admin.rpc("expire_stale_billing_checkouts", { p_limit: 500 }),
    admin.rpc("claim_billing_payment_captures", {
      p_limit: safeLimit,
      p_worker_id: workerId,
    }),
  ]);

  if (expireError) throw new Error(`checkout cleanup failed: ${expireError.code || "unknown"}`);
  if (error) throw new Error(`capture queue lookup failed: ${error.code || "unknown"}`);

  const summary: BillingReconciliationSummary = {
    expiredCheckouts: Number(expired ?? 0),
    inspected: 0,
    fulfilled: 0,
    retryPending: 0,
    manualReview: 0,
    refundRequired: 0,
  };

  for (const capture of (data ?? []) as CaptureRow[]) {
    summary.inspected += 1;
    const status = await reconcileCapture(capture);
    if (status === "fulfilled") summary.fulfilled += 1;
    else if (status === "retry_pending") summary.retryPending += 1;
    else if (status === "manual_review") summary.manualReview += 1;
    else summary.refundRequired += 1;
  }

  return summary;
}
