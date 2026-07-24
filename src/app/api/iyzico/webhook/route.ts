import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isIyzicoConfigured, verifyWebhookSignatureV3 } from "@/lib/billing/iyzico";
import { fulfillSuccessfulPayment } from "@/lib/billing/fulfillment";
import { fulfillPaymentLinkByConversation } from "@/lib/billing/payment-link-fulfill";
import type { BillingCycle, PlanId } from "@/lib/billing/plans";

type WebhookBody = {
  iyziEventType?: string;
  iyziEventTime?: number;
  paymentId?: string | number;
  paymentConversationId?: string;
  status?: string;
  token?: string;
  merchantId?: string | number;
};

export async function POST(req: NextRequest) {
  if (!isIyzicoConfigured()) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  let body: WebhookBody;
  try {
    body = (await req.json()) as WebhookBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const signature =
    req.headers.get("x-iyz-signature-v3") ??
    req.headers.get("X-IYZ-SIGNATURE-V3");

  // İmza doğrulama — FAIL-CLOSED: geçersiz imzada her zaman reddet (kimliksiz tahsil engeli)
  const valid = verifyWebhookSignatureV3({
    headerSignature: signature,
    merchantId: body.merchantId != null ? String(body.merchantId) : undefined,
    iyziEventType: body.iyziEventType,
    token: body.token,
    paymentConversationId: body.paymentConversationId,
    status: body.status,
  });

  if (!valid) {
    console.warn("iyzico webhook signature reddedildi");
    return NextResponse.json({ ok: false, error: "bad_signature" }, { status: 401 });
  }

  const status = String(body.status ?? "").toUpperCase();
  if (status !== "SUCCESS") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const conversationId = String(body.paymentConversationId ?? "");
  if (!conversationId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (conversationId.startsWith("plink-")) {
    const paid = await fulfillPaymentLinkByConversation(conversationId, "webhook");
    return NextResponse.json({ ok: true, paymentLink: paid });
  }

  const admin = createAdminClient();
  const { data: invoice } = await admin
    .from("invoices")
    .select("tenant_id, amount_try, meta")
    .filter("meta->>conversationId", "eq", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!invoice) {
    return NextResponse.json({ ok: true, unmatched: true });
  }

  const meta = (invoice.meta ?? {}) as { plan?: PlanId; cycle?: BillingCycle };
  await fulfillSuccessfulPayment({
    tenantId: invoice.tenant_id,
    plan: meta.plan ?? "office",
    cycle: meta.cycle ?? "monthly",
    conversationId,
    paymentId: body.paymentId != null ? String(body.paymentId) : null,
    amountTry: Number(invoice.amount_try) || 0,
    source: "webhook",
  });

  return NextResponse.json({ ok: true });
}
