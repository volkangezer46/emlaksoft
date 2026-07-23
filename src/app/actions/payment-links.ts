"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { createAdminClient } from "@/lib/supabase/admin";
import { initializeCheckoutForm, isIyzicoConfigured } from "@/lib/billing/iyzico";
import { fulfillPaymentLinkByToken } from "@/lib/billing/payment-link-fulfill";
import { toE164TurkishPhone } from "@/lib/phone";

export type PayLinkResult = { error?: string; ok?: boolean; url?: string; checkoutUrl?: string };

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function paymentLinkConversationId(token: string) {
  return `plink-${token}`;
}

export async function createPaymentLink(formData: FormData): Promise<PayLinkResult> {
  const gate = await requirePermission("commissions", "create");
  if (!gate.ok) return { error: gate.error };

  const title = String(formData.get("title") ?? "").trim() || "Kaparo / komisyon";
  const amountRaw = String(formData.get("amount") ?? "").replace(/[^\d.,]/g, "");
  const amount = amountRaw ? Number(amountRaw.replace(/\./g, "").replace(",", ".")) : NaN;
  const customerId = String(formData.get("customer_id") ?? "").trim() || null;
  const commissionId = String(formData.get("commission_id") ?? "").trim() || null;

  if (!Number.isFinite(amount) || amount <= 0) return { error: "Geçerli tutar girin." };

  const token = randomBytes(16).toString("hex");
  const supabase = await createClient();
  const { error } = await supabase.from("payment_links").insert({
    tenant_id: gate.tenantId,
    token,
    title,
    amount_try: amount,
    customer_id: customerId,
    commission_id: commissionId,
    created_by: gate.userId,
    expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
  if (error) {
    console.error("createPaymentLink", error);
    return { error: "Ödeme linki oluşturulamadı." };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "payment_link.create",
    entityType: "payment_link",
    newValue: { amount, title },
  });
  revalidatePath("/app/komisyon");
  return { ok: true, url: `${appUrl()}/odeme-link/${token}` };
}

/** iyzico yapılandırılmışsa Checkout Form; değilse demo yolu açık kalır */
export async function startPaymentLinkCheckout(token: string): Promise<PayLinkResult> {
  const admin = createAdminClient();
  const { data: link } = await admin
    .from("payment_links")
    .select("id, token, title, amount_try, status, expires_at, tenant_id, meta, customer:customers(full_name, phone, email)")
    .eq("token", token)
    .maybeSingle();

  if (!link) return { error: "Link bulunamadı." };
  if (link.status === "paid") return { ok: true, url: `${appUrl()}/odeme-link/${token}?paid=1` };
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return { error: "Bu linkin süresi dolmuş." };
  }

  if (!isIyzicoConfigured()) {
    return { error: "iyzico yapılandırılmamış — demo butonunu kullanın." };
  }

  const cust = link.customer as
    | { full_name?: string; phone?: string | null; email?: string | null }
    | { full_name?: string; phone?: string | null; email?: string | null }[]
    | null;
  const customer = Array.isArray(cust) ? cust[0] : cust;
  const fullName = customer?.full_name?.trim() || "Müşteri";
  const parts = fullName.split(/\s+/);
  const name = parts[0] || "Musteri";
  const surname = parts.slice(1).join(" ") || "Odeme";
  const gsmNumber = toE164TurkishPhone(customer?.phone) || "+905555555555";
  const email = customer?.email || "odeme@emlaksoft.test";
  const conversationId = paymentLinkConversationId(token);
  const amount = Number(link.amount_try);

  try {
    const init = await initializeCheckoutForm({
      conversationId,
      price: amount,
      paidPrice: amount,
      basketId: link.id,
      callbackUrl: `${appUrl()}/api/iyzico/callback`,
      paymentGroup: "PRODUCT",
      basketCategory: "Kaparo",
      buyer: {
        id: link.id.slice(0, 32),
        name,
        surname,
        email,
        gsmNumber,
        identityNumber: "11111111111",
        registrationAddress: "Türkiye",
        city: "Istanbul",
        country: "Turkey",
      },
      billingAddress: {
        contactName: fullName,
        city: "Istanbul",
        country: "Turkey",
        address: "Türkiye",
      },
      basketItemName: link.title,
    });

    if (init.status !== "success" || !init.paymentPageUrl) {
      return { error: init.errorMessage || "Ödeme oturumu açılamadı." };
    }

    await admin
      .from("payment_links")
      .update({
        meta: {
          ...((link.meta as Record<string, unknown>) ?? {}),
          conversationId,
          iyzicoToken: init.token ?? null,
        },
      })
      .eq("id", link.id);

    return { ok: true, checkoutUrl: init.paymentPageUrl };
  } catch (e) {
    console.error("startPaymentLinkCheckout", e);
    return { error: e instanceof Error ? e.message : "iyzico bağlantı hatası." };
  }
}

/** Demo: yalnızca iyzico yokken veya açıkça izinli ortamda */
export async function markPaymentLinkPaid(token: string): Promise<PayLinkResult> {
  if (isIyzicoConfigured() && process.env.ALLOW_PAYMENT_LINK_DEMO !== "1") {
    return { error: "Canlı iyzico açık — demo tahsilat kapalı. Gerçek ödeme butonunu kullanın." };
  }
  return fulfillPaymentLinkByToken(token, "demo");
}
