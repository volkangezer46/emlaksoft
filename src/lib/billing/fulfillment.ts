import { createAdminClient } from "@/lib/supabase/admin";
import type { BillingCycle, PlanId } from "@/lib/billing/plans";
import { planAmountTry } from "@/lib/billing/plans";

export type FulfillInput = {
  tenantId: string;
  plan: PlanId;
  cycle: BillingCycle;
  conversationId: string;
  paymentId?: string | null;
  amountTry: number;
  source: "callback" | "webhook" | "demo";
};

function periodEnd(cycle: BillingCycle, from = new Date()) {
  const d = new Date(from);
  if (cycle === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

function invoiceNo(tenantId: string) {
  const stamp = new Date().toISOString().slice(0, 7).replace("-", "");
  const short = tenantId.replace(/-/g, "").slice(0, 6).toUpperCase();
  const rnd = Math.floor(Math.random() * 9000 + 1000);
  return `ES-${stamp}-${short}-${rnd}`;
}

/**
 * Ödeme başarılı olduğunda abonelik + fatura + tenant planını senkronlar.
 * Idempotent: aynı conversationId için ikinci çağrı no-op.
 */
export async function fulfillSuccessfulPayment(input: FulfillInput) {
  const admin = createAdminClient();
  const now = new Date();
  const end = periodEnd(input.cycle, now);

  const { data: existingPaid } = await admin
    .from("invoices")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .filter("meta->>conversationId", "eq", input.conversationId)
    .eq("status", "paid")
    .maybeSingle();

  if (existingPaid) {
    return { ok: true as const, already: true };
  }

  const { data: sub } = await admin
    .from("subscriptions")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .maybeSingle();

  const amount = input.amountTry || planAmountTry(input.plan, input.cycle);
  const tax = Math.round(amount * 0.2 * 100) / 100;
  const total = Math.round((amount + tax) * 100) / 100;

  if (sub) {
    await admin
      .from("subscriptions")
      .update({
        plan: input.plan,
        status: "active",
        billing_cycle: input.cycle,
        amount_try: planAmountTry(input.plan, "monthly"),
        current_period_start: now.toISOString(),
        current_period_end: end.toISOString(),
        trial_ends_at: null,
        cancelled_at: null,
        iyzico_subscription_ref: input.paymentId ?? input.conversationId,
        updated_at: now.toISOString(),
      })
      .eq("id", sub.id);
  } else {
    await admin.from("subscriptions").insert({
      tenant_id: input.tenantId,
      plan: input.plan,
      status: "active",
      billing_cycle: input.cycle,
      amount_try: planAmountTry(input.plan, "monthly"),
      current_period_start: now.toISOString(),
      current_period_end: end.toISOString(),
      iyzico_subscription_ref: input.paymentId ?? input.conversationId,
    });
  }

  const { data: openInvoice } = await admin
    .from("invoices")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .filter("meta->>conversationId", "eq", input.conversationId)
    .maybeSingle();

  if (openInvoice) {
    await admin
      .from("invoices")
      .update({
        status: "paid",
        amount_try: amount,
        tax_try: tax,
        total_try: total,
        paid_at: now.toISOString(),
        iyzico_payment_id: input.paymentId ?? null,
        meta: {
          conversationId: input.conversationId,
          plan: input.plan,
          cycle: input.cycle,
          source: input.source,
        },
      })
      .eq("id", openInvoice.id);
  } else {
    await admin.from("invoices").insert({
      tenant_id: input.tenantId,
      subscription_id: sub?.id ?? null,
      invoice_no: invoiceNo(input.tenantId),
      status: "paid",
      amount_try: amount,
      tax_try: tax,
      total_try: total,
      period_start: now.toISOString(),
      period_end: end.toISOString(),
      due_at: now.toISOString(),
      paid_at: now.toISOString(),
      iyzico_payment_id: input.paymentId ?? null,
      meta: {
        conversationId: input.conversationId,
        plan: input.plan,
        cycle: input.cycle,
        source: input.source,
      },
    });
  }

  await admin
    .from("tenants")
    .update({
      plan: input.plan,
      status: "active",
      updated_at: now.toISOString(),
    })
    .eq("id", input.tenantId);

  return { ok: true as const, already: false };
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
  const tax = Math.round(input.amountTry * 0.2 * 100) / 100;
  const total = Math.round((input.amountTry + tax) * 100) / 100;
  const now = new Date();
  const end = periodEnd(input.cycle, now);

  const { data, error } = await admin
    .from("invoices")
    .insert({
      tenant_id: input.tenantId,
      subscription_id: input.subscriptionId,
      invoice_no: invoiceNo(input.tenantId),
      status: "open",
      amount_try: input.amountTry,
      tax_try: tax,
      total_try: total,
      period_start: now.toISOString(),
      period_end: end.toISOString(),
      due_at: end.toISOString(),
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
