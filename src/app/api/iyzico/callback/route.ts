import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  IYZICO_CURRENCY,
  isIyzicoConfigured,
  retrieveCheckoutForm,
  verifyCheckoutPayment,
} from "@/lib/billing/iyzico";
import { fulfillSuccessfulPayment, invoiceAmountsTry } from "@/lib/billing/fulfillment";
import { fulfillPaymentLinkByConversation } from "@/lib/billing/payment-link-fulfill";
import type { BillingCycle, PlanId } from "@/lib/billing/plans";
import { expectedProviderAmountTry } from "@/lib/try-credits/checkout";
import { tryInvoiceHold } from "@/lib/try-credits/wallet";
import { getBaseUrl } from "@/lib/base-url";

function appUrl() {
  return getBaseUrl();
}

async function handle(token: string | null) {
  if (!token) {
    return NextResponse.redirect(`${appUrl()}/app/abonelik?error=token`);
  }

  if (!isIyzicoConfigured()) {
    return NextResponse.redirect(`${appUrl()}/app/abonelik?error=config`);
  }

  let resolvedConversationId = "";
  try {
    const result = await retrieveCheckoutForm(token);
    const ok =
      result.status === "success" &&
      String(result.paymentStatus ?? "").toLowerCase() === "success";

    const conversationId = String(result.conversationId ?? "").trim();
    resolvedConversationId = conversationId;

    if (!ok) {
      if (conversationId.startsWith("plink-")) {
        const linkToken = conversationId.slice("plink-".length);
        return NextResponse.redirect(`${appUrl()}/odeme-link/${linkToken}?error=payment`);
      }
      return NextResponse.redirect(`${appUrl()}/app/abonelik?error=payment`);
    }

    if (!conversationId) {
      return NextResponse.redirect(`${appUrl()}/app/abonelik?error=conversation`);
    }

    // Kaparo / komisyon ödeme linki
    if (conversationId.startsWith("plink-")) {
      const linkToken = conversationId.slice("plink-".length);
      await fulfillPaymentLinkByConversation(
        conversationId,
        "callback",
        result,
      );
      return NextResponse.redirect(`${appUrl()}/odeme-link/${linkToken}?paid=1`);
    }

    const admin = createAdminClient();
    const { data: invoice, error: invoiceError } = await admin
      .from("invoices")
      .select("tenant_id, amount_try, tax_try, total_try, currency, meta")
      .filter("meta->>conversationId", "eq", conversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (invoiceError) {
      throw new Error(`Fatura doğrulama sorgusu başarısız: ${invoiceError.message}`);
    }

    if (!invoice) {
      return NextResponse.redirect(`${appUrl()}/app/abonelik?error=invoice`);
    }

    const meta = (invoice.meta ?? {}) as { plan?: PlanId; cycle?: BillingCycle };
    const amounts = invoiceAmountsTry(Number(invoice.amount_try));
    if (
      String(invoice.currency ?? "").toUpperCase() !== IYZICO_CURRENCY ||
      !Number.isFinite(Number(invoice.tax_try)) ||
      !Number.isFinite(Number(invoice.total_try)) ||
      Math.abs(Number(invoice.tax_try) - amounts.taxTry) > 0.01 ||
      Math.abs(Number(invoice.total_try) - amounts.totalTry) > 0.01
    ) {
      throw new Error("Fatura toplamları ödeme sözleşmesiyle eşleşmedi.");
    }
    // TL hesap kredisi: faturada kredi rezervi varsa iyzico yalnız KALAN nakit tutarı tahsil etmiştir.
    const hold = await tryInvoiceHold(admin, invoice.tenant_id, conversationId);
    if (!hold) throw new Error("Kredi durumu doğrulanamadı.");
    const verified = verifyCheckoutPayment(result, {
      conversationId,
      basketId: conversationId,
      amountTry: expectedProviderAmountTry(amounts.totalTry, hold),
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
      source: "callback",
    });

    return NextResponse.redirect(
      `${appUrl()}/app/abonelik?paid=1&plan=${meta.plan ?? "office"}`,
    );
  } catch (e) {
    console.error("iyzico callback", e);
    if (resolvedConversationId.startsWith("plink-")) {
      const linkToken = resolvedConversationId.slice("plink-".length);
      return NextResponse.redirect(`${appUrl()}/odeme-link/${linkToken}?error=callback`);
    }
    return NextResponse.redirect(`${appUrl()}/app/abonelik?error=callback`);
  }
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const token =
    (form?.get("token") as string | null) ??
    req.nextUrl.searchParams.get("token");
  return handle(token);
}

export async function GET(req: NextRequest) {
  return handle(req.nextUrl.searchParams.get("token"));
}
