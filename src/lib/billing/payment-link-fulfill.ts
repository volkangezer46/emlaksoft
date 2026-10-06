import { fulfillBillingPaymentAtomic } from "@/lib/billing/fulfillment";
import {
  IYZICO_CURRENCY,
  verifyCheckoutPayment,
  type CheckoutRetrieveResult,
} from "@/lib/billing/iyzico";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAssignment } from "@/lib/assignment-notify";
import { formatTry } from "@/lib/format";

type PaymentLinkSource = "demo" | "callback" | "webhook";

async function fulfillPaymentLink(
  token: string,
  source: PaymentLinkSource,
  providerResult?: CheckoutRetrieveResult,
  expectedPaymentId?: string | null,
) {
  const normalizedToken = token.trim();
  if (!normalizedToken) throw new Error("Ödeme bağlantısı kimliği geçersiz.");

  const admin = createAdminClient();
  const { data: link, error: linkError } = await admin
    .from("payment_links")
    .select("id, tenant_id, amount_try, title, created_by, customer_id")
    .eq("token", normalizedToken)
    .maybeSingle();
  if (linkError) {
    console.error("fulfillPaymentLink lookup", {
      source,
      code: linkError.code,
      message: linkError.message,
    });
    throw new Error("Ödeme bağlantısı güvenli şekilde doğrulanamadı.");
  }
  if (!link) throw new Error("Ödeme bağlantısı bulunamadı.");

  const amountTry = Number(link.amount_try);
  if (!Number.isFinite(amountTry) || amountTry <= 0) {
    throw new Error("Ödeme bağlantısı tutarı geçersiz.");
  }

  if (source !== "demo" && !providerResult) {
    throw new Error("Sağlayıcı ödeme doğrulaması bulunamadı.");
  }

  const verified = source === "demo"
    ? null
    : verifyCheckoutPayment(providerResult!, {
        conversationId: `plink-${normalizedToken}`,
        basketId: link.id,
        amountTry,
        paymentId: expectedPaymentId,
        currency: IYZICO_CURRENCY,
      });

  const result = await fulfillBillingPaymentAtomic({
    provider: source === "demo" ? "demo" : "iyzico",
    conversationId: `plink-${normalizedToken}`,
    paymentId: verified?.paymentId ?? null,
    source,
    targetType: "payment_link",
    expectedTenantId: link.tenant_id,
    expectedPlan: null,
    expectedCycle: null,
    expectedAmountTry: verified?.amountTry ?? amountTry,
    expectedCurrency: verified?.currency ?? IYZICO_CURRENCY,
  });
  // İlk kez tahsil edildiyse (tekrar callback/webhook değil) oluşturana ve yöneticilere bildirim. Hata ödemeyi BOZMAZ.
  if (!result.already) {
    await notifyPaymentLinkPaid(admin, {
      id: String(link.id),
      tenantId: String(link.tenant_id),
      title: typeof link.title === "string" ? link.title : null,
      createdBy: typeof link.created_by === "string" ? link.created_by : null,
      customerId: typeof link.customer_id === "string" ? link.customer_id : null,
      amountTry,
      demo: source === "demo",
    });
  }
  return result;
}

/**
 * Ödeme bağlantısı ödendi bildirimi: bağlantıyı oluşturan + ofis sahibi/genel müdür (aktif). Tek seferlik anahtar
 * `plink-paid:<bağlantı>:<kişi>` (iyzico callback ve webhook ikisi de gelse bir bildirim). Tercih anahtarı `commission`.
 */
async function notifyPaymentLinkPaid(
  admin: ReturnType<typeof createAdminClient>,
  link: { id: string; tenantId: string; title: string | null; createdBy: string | null; customerId: string | null; amountTry: number; demo: boolean },
): Promise<void> {
  try {
    const { data: managers } = await admin
      .from("profiles")
      .select("id")
      .eq("tenant_id", link.tenantId)
      .in("role", ["owner", "gm"])
      .eq("is_active", true)
      .limit(20);
    const targets = new Set<string>(((managers ?? []) as { id: string }[]).map((m) => String(m.id)));
    if (link.createdBy) targets.add(link.createdBy);
    const title = `Ödeme bağlantısı ödendi: ${(link.title ?? "Ödeme").slice(0, 80)} · ${formatTry(link.amountTry)}`;
    for (const userId of targets) {
      await notifyAssignment({
        tenantId: link.tenantId,
        userId,
        title,
        body: link.demo ? "Demo tahsilat olarak işaretlendi (gerçek para hareketi yok)." : "Tahsilat iyzico ile doğrulandı ve kaydedildi.",
        href: link.customerId ? `/app/musteriler/${link.customerId}` : "/app/komisyon",
        dedupeKey: `plink-paid:${link.id}:${userId}`,
        prefKey: "commission",
        kind: "success",
      });
    }
  } catch (e) {
    console.error("ödeme bağlantısı bildirimi", e);
  }
}

export async function fulfillPaymentLinkByToken(
  token: string,
  source: PaymentLinkSource,
  providerResult?: CheckoutRetrieveResult,
): Promise<{ ok?: boolean; already?: boolean; error?: string }> {
  try {
    const result = await fulfillPaymentLink(token, source, providerResult);
    return { ok: true, already: result.already };
  } catch (error) {
    console.error("fulfillPaymentLinkByToken", error);
    return {
      error: error instanceof Error
        ? error.message
        : "Ödeme bağlantısı tahsilatı tamamlanamadı.",
    };
  }
}

export async function fulfillPaymentLinkByConversation(
  conversationId: string,
  source: "callback" | "webhook",
  providerResult: CheckoutRetrieveResult,
  expectedPaymentId?: string | null,
): Promise<boolean> {
  if (!conversationId.startsWith("plink-")) return false;
  const token = conversationId.slice("plink-".length);
  if (!token) return false;
  await fulfillPaymentLink(token, source, providerResult, expectedPaymentId);
  return true;
}
