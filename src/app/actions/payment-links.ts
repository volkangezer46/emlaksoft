"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { createAdminClient } from "@/lib/supabase/admin";
import { initializeCheckoutForm, isIyzicoConfigured } from "@/lib/billing/iyzico";
import { fulfillPaymentLinkByToken } from "@/lib/billing/payment-link-fulfill";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { validateCheckoutBuyer } from "@/lib/billing/buyer";
import { getBaseUrl } from "@/lib/base-url";
import { parseMoneyInput } from "@/lib/money-input";

export type PayLinkResult = { error?: string; ok?: boolean; url?: string; checkoutUrl?: string };

function appUrl() {
  return getBaseUrl();
}

function paymentLinkConversationId(token: string) {
  return `plink-${token}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function createPaymentLink(formData: FormData): Promise<PayLinkResult> {
  const gate = await requirePermission("commissions", "create");
  if (!gate.ok) return { error: gate.error };

  const title = (String(formData.get("title") ?? "").trim() || "Kaparo / komisyon").slice(0, 160);
  const amountResult = parseMoneyInput(formData.get("amount"), { max: 100_000_000 });
  let amount = amountResult.ok && amountResult.value != null ? amountResult.value : NaN;
  const customerId = String(formData.get("customer_id") ?? "").trim() || null;
  const commissionId = String(formData.get("commission_id") ?? "").trim() || null;

  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
    return { error: "Geçerli tutar girin." };
  }
  if (customerId && !UUID.test(customerId)) return { error: "Müşteri seçimi geçersiz." };
  if (commissionId && !UUID.test(commissionId)) return { error: "Komisyon seçimi geçersiz." };

  const token = randomBytes(16).toString("hex");
  const supabase = await createClient();
  let verifiedCustomerId = customerId;

  if (commissionId) {
    const { data: commission, error: commissionError } = await supabase
      .from("commissions")
      .select("id, status, gross_amount, deal:deals(customer_id)")
      .eq("id", commissionId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (commissionError || !commission) return { error: "Komisyon kaydı bu ofise ait değil." };
    if (["paid", "collected"].includes(String(commission.status))) {
      return { error: "Tahsil edilmiş komisyon için yeni ödeme linki oluşturulamaz." };
    }
    amount = Number(commission.gross_amount);
    if (!Number.isFinite(amount) || amount <= 0) return { error: "Komisyon tutarı geçersiz." };
    const deal = Array.isArray(commission.deal) ? commission.deal[0] : commission.deal;
    verifiedCustomerId ||= deal?.customer_id ?? null;
  }

  if (verifiedCustomerId) {
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id")
      .eq("id", verifiedCustomerId)
      .eq("tenant_id", gate.tenantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (customerError || !customer) return { error: "Müşteri kaydı bu ofise ait değil." };
  }

  // Authenticated clients only receive read access to payment links. Creation is
  // performed after the permission and tenant-reference checks above so a caller
  // cannot forge a paid link or bind another tenant's financial record.
  const admin = createAdminClient();
  const { error } = await admin.from("payment_links").insert({
    tenant_id: gate.tenantId,
    token,
    title,
    amount_try: amount,
    customer_id: verifiedCustomerId,
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
export async function startPaymentLinkCheckout(token: string, formData: FormData): Promise<PayLinkResult> {
  const normalizedToken = token.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalizedToken)) return { error: "Link bulunamadı." };
  const ip = await clientIp();
  // Token tahmini / kaba kuvvet koruması — IP başına dakikada 20 istek
  const { allowed } = await checkRateLimit(`odeme-link-checkout:${ip}`, {
    limit: 20,
    windowSec: 60,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: link, error: linkError } = await admin
    .from("payment_links")
    .select("id, token, title, amount_try, status, expires_at, tenant_id, customer_id, commission_id, meta, tenant:tenants(status)")
    .eq("token", normalizedToken)
    .maybeSingle();

  if (linkError || !link) return { error: "Link bulunamadı." };
  const linkTenant = link.tenant as { status?: string | null } | { status?: string | null }[] | null;
  const tenantStatus = Array.isArray(linkTenant) ? linkTenant[0]?.status : linkTenant?.status;
  if (!isPublicTenantActive(tenantStatus)) return { error: "Link bulunamadı." };
  if (link.status === "paid") return { ok: true, url: `${appUrl()}/odeme-link/${normalizedToken}?paid=1` };
  if (link.status !== "open") return { error: "Bu ödeme bağlantısı artık kullanılamıyor." };
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return { error: "Bu linkin süresi dolmuş." };
  }

  if (!isIyzicoConfigured()) {
    return { error: "iyzico yapılandırılmamış — demo butonunu kullanın." };
  }

  // Legacy rows are explicitly tenant-checked too; the forward migration adds
  // composite foreign keys so new cross-tenant references are impossible.
  const [customerRef, commissionRef] = await Promise.all([
    link.customer_id
      ? admin.from("customers").select("id").eq("id", link.customer_id).eq("tenant_id", link.tenant_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    link.commission_id
      ? admin.from("commissions").select("id, status").eq("id", link.commission_id).eq("tenant_id", link.tenant_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if ((link.customer_id && (!customerRef.data || customerRef.error)) ||
      (link.commission_id && (!commissionRef.data || commissionRef.error))) {
    return { error: "Ödeme bağlantısı ofis kayıtlarıyla eşleşmiyor." };
  }
  if (commissionRef.data && ["paid", "collected"].includes(String(commissionRef.data.status))) {
    return { error: "Bu ödeme daha önce tahsil edilmiş." };
  }

  let checkoutBuyer;
  try {
    checkoutBuyer = validateCheckoutBuyer({
      id: link.id,
      fullName: String(formData.get("full_name") ?? ""),
      email: String(formData.get("email") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      identityNumber: String(formData.get("identity_number") ?? ""),
      address: String(formData.get("address") ?? ""),
      city: String(formData.get("city") ?? ""),
      ip,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Ödeme sahibi bilgileri doğrulanamadı." };
  }

  const conversationId = paymentLinkConversationId(normalizedToken);
  const amount = Number(link.amount_try);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
    return { error: "Ödeme bağlantısı tutarı geçersiz." };
  }

  try {
    const init = await initializeCheckoutForm({
      conversationId,
      price: amount,
      paidPrice: amount,
      basketId: link.id,
      callbackUrl: `${appUrl()}/api/iyzico/callback`,
      paymentGroup: "PRODUCT",
      basketCategory: "Kaparo",
      buyer: checkoutBuyer.buyer,
      billingAddress: checkoutBuyer.billingAddress,
      basketItemName: link.title,
    });

    if (init.status !== "success" || !init.paymentPageUrl) {
      return { error: init.errorMessage || "Ödeme oturumu açılamadı." };
    }

    const { data: initialized, error: initializeError } = await admin
      .from("payment_links")
      .update({
        checkout_conversation_id: conversationId,
        checkout_initialized_at: new Date().toISOString(),
        meta: {
          ...((link.meta as Record<string, unknown>) ?? {}),
          conversationId,
          iyzicoToken: init.token ?? null,
        },
      })
      .eq("id", link.id)
      .eq("tenant_id", link.tenant_id)
      .eq("status", "open")
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .select("id")
      .maybeSingle();

    if (initializeError || !initialized) {
      return { error: "Ödeme bağlantısının durumu değişti; işlem başlatılmadı." };
    }

    return { ok: true, checkoutUrl: init.paymentPageUrl };
  } catch (e) {
    console.error("startPaymentLinkCheckout", e);
    return { error: e instanceof Error ? e.message : "iyzico bağlantı hatası." };
  }
}

/** Demo: yalnızca iyzico yokken veya açıkça izinli ortamda */
export async function markPaymentLinkPaid(token: string): Promise<PayLinkResult> {
  const demoAllowed = process.env.NODE_ENV !== "production" || process.env.ALLOW_PAYMENT_LINK_DEMO === "1";
  if (!demoAllowed || (isIyzicoConfigured() && process.env.ALLOW_PAYMENT_LINK_DEMO !== "1")) {
    return { error: "Canlı iyzico açık — demo tahsilat kapalı. Gerçek ödeme butonunu kullanın." };
  }

  // Token tahmini / kaba kuvvet koruması — IP başına dakikada 20 istek
  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`odeme-link-demo:${ip}`, {
    limit: 20,
    windowSec: 60,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin." };

  return fulfillPaymentLinkByToken(token, "demo");
}
