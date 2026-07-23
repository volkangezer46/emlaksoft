import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { retrieveCheckoutForm, isIyzicoConfigured } from "@/lib/billing/iyzico";
import { fulfillSuccessfulPayment } from "@/lib/billing/fulfillment";
import { fulfillPaymentLinkByConversation } from "@/lib/billing/payment-link-fulfill";
import type { BillingCycle, PlanId } from "@/lib/billing/plans";

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

async function handle(token: string | null) {
  if (!token) {
    return NextResponse.redirect(`${appUrl()}/app/abonelik?error=token`);
  }

  if (!isIyzicoConfigured()) {
    return NextResponse.redirect(`${appUrl()}/app/abonelik?error=config`);
  }

  try {
    const result = await retrieveCheckoutForm(token);
    const ok =
      result.status === "success" &&
      String(result.paymentStatus ?? "").toLowerCase() === "success";

    const conversationId = String(result.conversationId ?? "");

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
      await fulfillPaymentLinkByConversation(conversationId, "callback");
      return NextResponse.redirect(`${appUrl()}/odeme-link/${linkToken}?paid=1`);
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
      return NextResponse.redirect(`${appUrl()}/app/abonelik?error=invoice`);
    }

    const meta = (invoice.meta ?? {}) as { plan?: PlanId; cycle?: BillingCycle };
    await fulfillSuccessfulPayment({
      tenantId: invoice.tenant_id,
      plan: meta.plan ?? "office",
      cycle: meta.cycle ?? "monthly",
      conversationId,
      paymentId: result.paymentId != null ? String(result.paymentId) : null,
      amountTry: Number(invoice.amount_try) || 0,
      source: "callback",
    });

    return NextResponse.redirect(
      `${appUrl()}/app/abonelik?paid=1&plan=${meta.plan ?? "office"}`,
    );
  } catch (e) {
    console.error("iyzico callback", e);
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
