import { fulfillBillingPaymentAtomic } from "@/lib/billing/fulfillment";
import {
  IYZICO_CURRENCY,
  verifyCheckoutPayment,
  type CheckoutRetrieveResult,
} from "@/lib/billing/iyzico";
import { createAdminClient } from "@/lib/supabase/admin";

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
    .select("id, tenant_id, amount_try")
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

  return fulfillBillingPaymentAtomic({
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
