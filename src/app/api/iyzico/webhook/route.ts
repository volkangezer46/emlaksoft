import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  IYZICO_CURRENCY,
  isIyzicoConfigured,
  retrieveCheckoutForm,
  verifyCheckoutPayment,
  verifyWebhookSignatureV3,
} from "@/lib/billing/iyzico";
import { fulfillSuccessfulPayment, invoiceAmountsTry } from "@/lib/billing/fulfillment";
import { fulfillPaymentLinkByConversation } from "@/lib/billing/payment-link-fulfill";
import type { BillingCycle, PlanId } from "@/lib/billing/plans";
import { expectedProviderAmountTry } from "@/lib/try-credits/checkout";
import { tryInvoiceHold } from "@/lib/try-credits/wallet";
import { saveCardAfterVerifiedPayment } from "@/lib/billing/card-store";
import { reverseClaimsForInvoiceSafe } from "@/lib/growth/engine";
import {
  PUBLIC_REQUEST_MAX_BYTES,
  readRequestBodyLimited,
  requestBodyTooLarge,
} from "@/lib/public-request-security";

type WebhookBody = {
  iyziEventType?: string;
  iyziEventTime?: number;
  paymentId?: string | number;
  iyziPaymentId?: string | number;
  paymentConversationId?: string;
  status?: string;
  token?: string;
  merchantId?: string | number;
};

export async function POST(req: NextRequest) {
  if (!isIyzicoConfigured()) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  if (requestBodyTooLarge(req.headers, PUBLIC_REQUEST_MAX_BYTES)) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }

  let body: WebhookBody;
  try {
    const bytes = await readRequestBodyLimited(req, PUBLIC_REQUEST_MAX_BYTES);
    if (bytes === null) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    body = JSON.parse(new TextDecoder().decode(bytes)) as WebhookBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const iyziEventType = String(body.iyziEventType ?? "");
  const paymentConversationId = String(body.paymentConversationId ?? "");
  const status = String(body.status ?? "");
  const signatureInput = body.token
    ? {
        format: "hpp" as const,
        iyziEventType,
        iyziPaymentId: String(body.iyziPaymentId ?? ""),
        token: String(body.token),
        paymentConversationId,
        status,
      }
    : {
        format: "direct" as const,
        iyziEventType,
        paymentId: String(body.paymentId ?? ""),
        paymentConversationId,
        status,
      };

  // Fail closed. Direct and HPP have different official canonical field order;
  // merchantId and undocumented fallback variants are intentionally rejected.
  const valid = verifyWebhookSignatureV3(
    req.headers.get("x-iyz-signature-v3"),
    signatureInput,
  );

  if (!valid) {
    console.warn("iyzico webhook signature reddedildi");
    return NextResponse.json({ ok: false, error: "bad_signature" }, { status: 401 });
  }

  // Tek service_role istemcisi (imza doğrulandıktan sonra): ters ibraz ve fatura tamamlama aynı istemciyi kullanır.
  const admin = createAdminClient();

  // Ters ibraz (chargeback) bildirimi: imza doğrulandıktan sonra faturaya işaretlenir ve davet/ortak ödülleri geri alınır
  // (verilmiş kredi clawback). Bildirim türü iyzico panelinde ayrı etkinleştirilir; tanınmayan türler eskisi gibi yok sayılır.
  if (/chargeback|dispute|ters[\s_-]?ibraz/i.test(iyziEventType) && paymentConversationId) {
    const { data: inv } = await admin
      .from("invoices")
      .select("id, status, meta")
      .filter("meta->>conversationId", "eq", paymentConversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!inv) return NextResponse.json({ ok: true, unmatched: true });
    const invMeta = (inv.meta ?? {}) as Record<string, unknown>;
    if (!invMeta.chargeback) {
      await admin
        .from("invoices")
        .update({ meta: { ...invMeta, chargeback: { at: new Date().toISOString(), source: "iyzico_webhook", eventType: iyziEventType.slice(0, 60) } } })
        .eq("id", inv.id as string)
        .is("meta->chargeback", null);
    }
    await reverseClaimsForInvoiceSafe(admin, inv.id as string, "chargeback");
    return NextResponse.json({ ok: true, chargeback: true });
  }

  if (status.toUpperCase() !== "SUCCESS") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const conversationId = paymentConversationId;
  if (!conversationId) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  const providerPaymentId = body.token
    ? body.iyziPaymentId != null ? String(body.iyziPaymentId) : null
    : body.paymentId != null ? String(body.paymentId) : null;

  // This application only creates Checkout Form (HPP) payments. A signed direct
  // webhook does not carry amount/currency, so it cannot safely fulfill locally.
  if (!body.token) {
    return NextResponse.json(
      { ok: false, error: "checkout_verification_required" },
      { status: 422 },
    );
  }

  let providerResult;
  try {
    providerResult = await retrieveCheckoutForm(String(body.token));
  } catch (error) {
    console.error("iyzico webhook provider verification", error);
    return NextResponse.json({ ok: false, error: "provider_lookup" }, { status: 502 });
  }

  if (conversationId.startsWith("plink-")) {
    const paid = await fulfillPaymentLinkByConversation(
      conversationId,
      "webhook",
      providerResult,
      providerPaymentId,
    );
    return NextResponse.json({ ok: true, paymentLink: paid });
  }

  const { data: invoice, error: invoiceError } = await admin
    .from("invoices")
    .select("tenant_id, amount_try, tax_try, total_try, currency, meta")
    .filter("meta->>conversationId", "eq", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (invoiceError) {
    console.error("iyzico webhook invoice lookup", invoiceError);
    return NextResponse.json({ ok: false, error: "invoice_lookup" }, { status: 500 });
  }

  if (!invoice) {
    return NextResponse.json({ ok: true, unmatched: true });
  }

  const meta = (invoice.meta ?? {}) as {
    plan?: PlanId;
    cycle?: BillingCycle;
    saveCard?: boolean;
    saveCardConsentBy?: string;
  };
  const amounts = invoiceAmountsTry(Number(invoice.amount_try));
  if (
    String(invoice.currency ?? "").toUpperCase() !== IYZICO_CURRENCY ||
    !Number.isFinite(Number(invoice.tax_try)) ||
    !Number.isFinite(Number(invoice.total_try)) ||
    Math.abs(Number(invoice.tax_try) - amounts.taxTry) > 0.01 ||
    Math.abs(Number(invoice.total_try) - amounts.totalTry) > 0.01
  ) {
    return NextResponse.json({ ok: false, error: "invoice_totals" }, { status: 409 });
  }
  // TL hesap kredisi: faturada kredi rezervi varsa iyzico yalnız KALAN nakit tutarı tahsil etmiştir.
  const hold = await tryInvoiceHold(admin, invoice.tenant_id, conversationId);
  if (!hold) {
    return NextResponse.json({ ok: false, error: "wallet_hold" }, { status: 500 });
  }
  const verified = verifyCheckoutPayment(providerResult, {
    conversationId,
    basketId: conversationId,
    amountTry: expectedProviderAmountTry(amounts.totalTry, hold),
    paymentId: providerPaymentId,
    currency: IYZICO_CURRENCY,
  });
  await fulfillSuccessfulPayment({
    tenantId: invoice.tenant_id,
    plan: meta.plan ?? "office",
    cycle: meta.cycle ?? "monthly",
    conversationId,
    paymentId: verified.paymentId,
    expectedAmountTry: verified.amountTry,
    expectedCurrency: verified.currency,
    source: "webhook",
  });

  // Kart saklama (callback ile aynı güvenli yol): yalnız doğrulanmış ödeme + faturadaki açık rıza. Asla fırlatmaz.
  if (meta.saveCard === true) {
    await saveCardAfterVerifiedPayment(admin, { tenantId: invoice.tenant_id, meta, result: providerResult });
  }

  return NextResponse.json({ ok: true });
}
