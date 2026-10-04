"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { PLANS, planAmountOf, type BillingCycle, type PlanId } from "@/lib/billing/plans";
import { getPlanDefinition } from "@/lib/billing/plan-definitions";
import { quoteCoupon, redeemCoupon } from "@/lib/billing/coupon-server";
import {
  IYZICO_CURRENCY,
  initializeCheckoutForm,
  isIyzicoConfigured,
} from "@/lib/billing/iyzico";
import {
  assertBillingPlanPreflight,
  createCheckoutInvoice,
  fulfillSuccessfulPayment,
  invoiceAmountsTry,
  markCheckoutInvoiceFailed,
  markCheckoutInvoiceInitialized,
} from "@/lib/billing/fulfillment";
import { clientIp } from "@/lib/rate-limit";
import { validateCheckoutBuyer, type ValidatedCheckoutBuyer } from "@/lib/billing/buyer";
import { getBaseUrl } from "@/lib/base-url";

export type CheckoutResult = {
  error?: string;
  checkoutUrl?: string;
  demo?: boolean;
};

const PLAN_IDS = new Set(PLANS.map((p) => p.id));

function appUrl() {
  return getBaseUrl();
}

export async function startPlanCheckout(formData: FormData): Promise<CheckoutResult> {
  const gate = await requirePermission("billing", "edit");
  if (!gate.ok) return { error: gate.error };

  const plan = String(formData.get("plan") ?? "").trim() as PlanId;
  const cycle = (String(formData.get("cycle") ?? "monthly").trim() || "monthly") as BillingCycle;
  if (!PLAN_IDS.has(plan)) return { error: "Geçersiz paket." };
  if (cycle !== "monthly" && cycle !== "yearly") return { error: "Geçersiz dönem." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Oturum bulunamadı." };

  const [{ data: tenant }, { data: profile }, { data: sub }] = await Promise.all([
    supabase
      .from("tenants")
      .select("id, name, plan, tax_number, phone, address_line, city")
      .eq("id", gate.tenantId)
      .maybeSingle(),
    supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
    supabase.from("subscriptions").select("id").eq("tenant_id", gate.tenantId).maybeSingle(),
  ]);

  if (!tenant) return { error: "Ofis bulunamadı." };

  try {
    await assertBillingPlanPreflight(gate.tenantId, plan);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Paket kapasitesi doğrulanamadı." };
  }

  const planDef = await getPlanDefinition(plan);
  if (planDef.hidden || planDef.customPricing) {
    return { error: "Bu paket çevrimiçi satın alınamıyor. Lütfen bizimle iletişime geçin." };
  }
  const listAmountTry = planAmountOf(planDef, cycle);
  // Kupon (isteğe bağlı `coupon` alanı): önce tüketmeden doğrulanır, fatura oluşunca atomik tüketilir.
  const couponCode = String(formData.get("coupon") ?? "").trim();
  let couponDiscountTry = 0;
  let couponNormalized = "";
  if (couponCode) {
    const quote = await quoteCoupon(couponCode, plan, listAmountTry);
    if (!quote.ok) return { error: quote.error };
    couponDiscountTry = quote.discountTry;
    couponNormalized = quote.code;
  }
  const amountTry = Math.round((listAmountTry - couponDiscountTry) * 100) / 100;
  const invoiceAmounts = invoiceAmountsTry(amountTry);
  const conversationId = `es-${gate.tenantId.slice(0, 8)}-${randomBytes(12).toString("hex")}`;
  const configured = isIyzicoConfigured();
  const demoAllowed = process.env.NODE_ENV !== "production" || process.env.ALLOW_BILLING_DEMO === "true";
  let checkoutBuyer: ValidatedCheckoutBuyer | null = null;

  if (!configured && !demoAllowed) {
    return { error: "Ödeme altyapısı yapılandırılmamış. Lütfen yönetici ile iletişime geçin." };
  }

  if (configured) {
    try {
      checkoutBuyer = validateCheckoutBuyer({
        id: user.id,
        fullName: profile?.full_name,
        email: user.email,
        phone: profile?.phone || tenant.phone,
        identityNumber: tenant.tax_number,
        address: tenant.address_line,
        city: tenant.city,
        ip: await clientIp(),
      });
    } catch (error) {
      return {
        error: error instanceof Error
          ? `${error.message} Ofis ve fatura bilgilerini Ayarlar bölümünden tamamlayın.`
          : "Ödeme sahibi bilgileri doğrulanamadı.",
      };
    }
  }

  let invoiceId: string;
  try {
    invoiceId = await createCheckoutInvoice({
      tenantId: gate.tenantId,
      subscriptionId: sub?.id ?? null,
      plan,
      cycle,
      conversationId,
      amountTry,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Fatura taslağı oluşturulamadı." };
  }

  if (couponNormalized) {
    const redeemed = await redeemCoupon({
      code: couponNormalized,
      tenantId: gate.tenantId,
      invoiceId,
      plan,
      baseAmountTry: listAmountTry,
    });
    if (!redeemed.ok || Math.abs(redeemed.discountTry - couponDiscountTry) > 0.01) {
      await markCheckoutInvoiceFailed({ invoiceId, tenantId: gate.tenantId });
      return { error: redeemed.ok ? "Kupon tutarı değişti; lütfen yeniden deneyin." : redeemed.error };
    }
  }

  // Sandbox anahtarı yoksa: demo ödeme akışı — YALNIZCA geliştirmede/açıkça izin verildiğinde.
  // Production'da iyzico yoksa demo tahsilatla ücretsiz abonelik verilmesi engellenir.
  if (!configured) {
    try {
      await fulfillSuccessfulPayment({
        tenantId: gate.tenantId,
        plan,
        cycle,
        conversationId,
        paymentId: `demo-${conversationId}`,
        expectedAmountTry: invoiceAmounts.totalTry,
        expectedCurrency: IYZICO_CURRENCY,
        source: "demo",
      });
    } catch (error) {
      await markCheckoutInvoiceFailed({ invoiceId, tenantId: gate.tenantId });
      return { error: error instanceof Error ? error.message : "Demo tahsilat tamamlanamadı." };
    }
    revalidatePath("/app/abonelik");
    revalidatePath("/app/ayarlar");
    revalidatePath("/admin/billing");
    return {
      checkoutUrl: `${appUrl()}/app/abonelik?paid=1&demo=1&plan=${plan}`,
      demo: true,
    };
  }

  try {
    const init = await initializeCheckoutForm({
      conversationId,
      price: invoiceAmounts.totalTry,
      paidPrice: invoiceAmounts.totalTry,
      basketId: conversationId,
      callbackUrl: `${appUrl()}/api/iyzico/callback`,
      buyer: checkoutBuyer!.buyer,
      billingAddress: checkoutBuyer!.billingAddress,
      basketItemName: `EmlakSoft ${plan} (${cycle === "yearly" ? "yıllık" : "aylık"})`,
    });

    if (init.status !== "success" || !init.paymentPageUrl) {
      await markCheckoutInvoiceFailed({ invoiceId, tenantId: gate.tenantId });
      return { error: init.errorMessage || "Ödeme oturumu açılamadı." };
    }

    await markCheckoutInvoiceInitialized({ invoiceId, tenantId: gate.tenantId });
    return { checkoutUrl: init.paymentPageUrl };
  } catch (e) {
    await markCheckoutInvoiceFailed({ invoiceId, tenantId: gate.tenantId });
    console.error("startPlanCheckout", e);
    return { error: e instanceof Error ? e.message : "iyzico bağlantı hatası." };
  }
}
