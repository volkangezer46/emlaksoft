import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BillingCycle, CatalogPlanId } from "@/lib/billing/plans";
import { ActionUserError } from "@/lib/action-errors";
import { IYZICO_CURRENCY } from "@/lib/billing/iyzico";
import { applyWalletCreditToInvoice, type AppliedWalletCredit, type WalletCreditRequest } from "@/lib/try-credits/checkout";
import { TRY_RPC } from "@/lib/try-credits/config";
import { tryInvoiceHold, tryReleaseInvoice } from "@/lib/try-credits/wallet";
import { registerClaimSafe } from "@/lib/growth/engine";
import { DEFAULT_BILLING_VAT_RATE } from "@/lib/billing/plans";
import { getBillingVatRate } from "@/lib/billing/vat-rate";
import { autoInvoiceLineRow, invoiceAmountsTry, isValidVatRate } from "@/lib/billing/invoice-amounts";
import { now as clockNow } from "@/lib/clock";
import type { SupabaseClient } from "@supabase/supabase-js";

// Tutar kuralı saf modülde (istemci ön izlemesi + test ortak); mevcut sunucu çağıranları buradan alır.
export { invoiceAmountsTry };

export type FulfillInput = {
  tenantId: string;
  plan: CatalogPlanId;
  cycle: BillingCycle;
  conversationId: string;
  paymentId?: string | null;
  expectedAmountTry: number;
  expectedCurrency: typeof IYZICO_CURRENCY;
  source: "callback" | "webhook" | "demo";
};

function invoiceNo(tenantId: string) {
  const stamp = new Date().toISOString().slice(0, 7).replace("-", "");
  const short = tenantId.replace(/-/g, "").slice(0, 6).toUpperCase();
  const nonce = randomBytes(6).toString("hex").toUpperCase();
  return `ES-${stamp}-${short}-${nonce}`;
}

export type FulfillmentTarget = "subscription" | "payment_link";

export type AtomicFulfillmentResult = {
  ok: true;
  already: boolean;
  targetType: FulfillmentTarget;
  tenantId?: string;
  invoiceId?: string;
  paymentLinkId?: string;
  plan?: CatalogPlanId;
  cycle?: BillingCycle;
  commissionUpdated?: boolean;
};

type AtomicFulfillmentInput = {
  /**
   * `account_credit` = TAM hesap kredisi ile ödeme (iyzico YOK, capture YOK): `try_credit_fulfill_invoice` p_cash_try=0.
   * Yalnız fatura üzerinde etkin bir kredi rezervi varsa çalışır.
   */
  provider: "iyzico" | "demo" | "account_credit";
  conversationId: string;
  paymentId?: string | null;
  source: FulfillInput["source"];
  targetType: FulfillmentTarget;
  expectedTenantId?: string | null;
  expectedPlan?: CatalogPlanId | null;
  expectedCycle?: BillingCycle | null;
  expectedAmountTry?: number | null;
  expectedCurrency: typeof IYZICO_CURRENCY;
};

type CaptureTransition = "fulfilled" | "retry_pending" | "manual_review" | "refund_required";

export function captureFailureStatus(errorCode: string | null | undefined): CaptureTransition {
  const code = String(errorCode ?? "").toUpperCase();
  if (["22023", "23505", "P0002"].includes(code)) return "refund_required";
  if (code === "P0001") return "manual_review";
  return "retry_pending";
}

async function transitionCapture(
  captureId: string,
  status: CaptureTransition,
  errorCode?: string | null,
) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("transition_billing_payment_capture", {
    p_capture_id: captureId,
    p_status: status,
    p_error_code: errorCode ?? null,
  });
  if (error) {
    console.error("transitionCapture", {
      captureId,
      status,
      code: error.code,
      message: error.message,
    });
  }
}

export const VAT_RATE_NOT_READY_MESSAGE =
  "Yeni KDV oranıyla ödeme alınabilmesi için ödeme altyapısı güncellemesi bekleniyor; lütfen biraz sonra tekrar deneyin.";

/**
 * Fulfill SQL'i faturadaki oranı okuyor mu (20261014012000 `billing_vat_rate_ready()`)? Okumuyorsa SQL tutarı sabit %20 ile
 * yeniden hesaplar: farklı oranla kesilen fatura TAHSİLATTAN SONRA reddedilirdi (iade gerekir). RPC yok/hata = hazır değil.
 */
async function billingVatRateReady(admin: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("billing_vat_rate_ready");
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * Otomatik faturanın KDV oranı: kesim anında ayar defterinde geçerli oran (`billing.vat_rate`, geçerlilik tarihli).
 * Oran kod varsayılanından (%20) farklıysa ve DB tarafı hazır değilse FAIL-CLOSED: fatura açılmaz, kart çekilmez.
 * `requested` verilirse (ekranda gösterilen tutar o oranla hesaplandı) aynı oran kullanılır; yalnız hazırlık doğrulanır.
 */
export async function resolveAutoInvoiceVatRate(admin: SupabaseClient, requested?: number | null): Promise<number> {
  const rate = isValidVatRate(requested) ? requested : await getBillingVatRate(clockNow());
  if (Math.abs(rate - DEFAULT_BILLING_VAT_RATE) < 1e-9) return rate;
  if (!(await billingVatRateReady(admin))) throw new ActionUserError(VAT_RATE_NOT_READY_MESSAGE);
  return rate;
}

/**
 * Otomatik faturaya `invoice_lines` satırı (AD2 ile tutarlı tek kalem). Fatura ile AYNI işlemde yazılamadığı için hata
 * ödeme akışını BOZMAZ: satır yoksa okuyucular faturadan tek satır türetir (`synthesizeLine`), tutarlar aynıdır.
 */
export async function writeAutoInvoiceLine(
  admin: SupabaseClient,
  input: Parameters<typeof autoInvoiceLineRow>[0],
): Promise<void> {
  try {
    const { error } = await admin.from("invoice_lines").insert(autoInvoiceLineRow(input));
    if (error && error.code !== "PGRST205" && error.code !== "42P01" && error.code !== "23505") {
      console.error("writeAutoInvoiceLine", { code: error.code, message: error.message });
    }
  } catch (e) {
    console.error("writeAutoInvoiceLine", e instanceof Error ? e.message : "error");
  }
}

/** Sağlayıcının ret yanıtından faturaya yazılacak metin: "<errorCode>: <errorMessage>" (ödeme profilinde gösterilir). */
export function checkoutErrorText(errorCode: unknown, errorMessage: unknown): string | null {
  const code = String(errorCode ?? "").trim().slice(0, 40);
  const message = String(errorMessage ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  if (!code && !message) return null;
  return code && message ? `${code}: ${message}` : code || message;
}

/** Service-role RPC is the only fulfillment write boundary. */
export async function fulfillBillingPaymentAtomic(
  input: AtomicFulfillmentInput,
): Promise<AtomicFulfillmentResult> {
  const walletOnly = input.provider === "account_credit";
  if (
    typeof input.expectedAmountTry !== "number" ||
    !Number.isFinite(input.expectedAmountTry) ||
    (walletOnly ? input.expectedAmountTry < 0 : input.expectedAmountTry <= 0)
  ) {
    throw new Error("Beklenen tahsilat tutarı geçersiz.");
  }

  const admin = createAdminClient();
  let captureId: string | null = null;
  if (input.provider === "iyzico") {
    const paymentId = input.paymentId?.trim();
    if (!paymentId) throw new Error("Sağlayıcı tahsilat kimliği bulunamadı.");

    // This RPC commits before fulfillment. If the following transaction fails,
    // operations still has an authoritative captured-payment reconciliation row.
    const { data: capture, error: captureError } = await admin.rpc(
      "record_billing_payment_capture",
      {
        p_provider: input.provider,
        p_conversation_id: input.conversationId,
        p_payment_id: paymentId,
        p_target_type: input.targetType,
        p_expected_tenant_id: input.expectedTenantId || null,
        p_expected_amount_try: input.expectedAmountTry,
        p_expected_currency: input.expectedCurrency,
        p_source: input.source,
      },
    );
    if (captureError) {
      console.error("recordBillingPaymentCapture", {
        source: input.source,
        targetType: input.targetType,
        code: captureError.code,
        message: captureError.message,
      });
      throw new Error("Ödeme doğrulandı ancak mutabakat kaydı oluşturulamadı.");
    }
    captureId = typeof capture === "object" && capture && !Array.isArray(capture)
      ? String(capture.captureId ?? "") || null
      : null;
    if (!captureId) throw new Error("Ödeme mutabakat kimliği doğrulanamadı.");
  }

  // TL hesap kredisi: faturada kredi rezervi varsa (herhangi bir durumda) ödeme `try_credit_fulfill_invoice` ile
  // tamamlanır (kredi + nakit = fatura toplamı; mevcut fulfill_billing_payment_v2 içeriden çağrılır). Rezerv sorgusu
  // belirsizse FAIL-CLOSED: para akışı sürdürülmez, yakalama yeniden denenir.
  let useWallet = false;
  if (input.targetType === "subscription" && input.provider !== "demo" && input.expectedTenantId) {
    const hold = await tryInvoiceHold(admin, input.expectedTenantId, input.conversationId);
    if (!hold) {
      if (captureId) await transitionCapture(captureId, "retry_pending", "wallet_hold_lookup");
      throw new Error("Ödeme doğrulandı ancak kredi durumu doğrulanamadı; işlem yeniden denenecek.");
    }
    useWallet = hold.has_hold;
  }
  if (walletOnly && !useWallet) {
    throw new Error("Bu fatura için etkin bir kredi rezervi bulunamadı.");
  }

  const { data, error } = useWallet
    ? await admin.rpc(TRY_RPC.fulfillInvoice, {
        p_conversation_id: input.conversationId,
        p_expected_tenant_id: input.expectedTenantId || null,
        p_payment_id: walletOnly ? null : input.paymentId || null,
        p_source: walletOnly ? "demo" : input.source,
        p_expected_plan: input.expectedPlan || null,
        p_expected_cycle: input.expectedCycle || null,
        // iyzico'dan alınan NAKİT tutar (tam kredi = 0); kredi payı SQL'de rezervden okunur.
        p_cash_try: walletOnly ? 0 : input.expectedAmountTry,
      })
    : await admin.rpc("fulfill_billing_payment_v2", {
        p_provider: input.provider,
        p_conversation_id: input.conversationId,
        p_payment_id: input.paymentId || null,
        p_source: input.source,
        p_target_type: input.targetType,
        p_expected_tenant_id: input.expectedTenantId || null,
        p_expected_plan: input.expectedPlan || null,
        p_expected_cycle: input.expectedCycle || null,
        p_expected_amount_try: input.expectedAmountTry ?? null,
        p_expected_currency: input.expectedCurrency,
      });

  if (error) {
    if (captureId) {
      await transitionCapture(
        captureId,
        captureFailureStatus(error.code),
        error.code || "rpc_error",
      );
    }
    console.error("fulfillBillingPaymentAtomic", {
      source: input.source,
      targetType: input.targetType,
      code: error.code,
      message: error.message,
    });
    throw new Error("Ödeme doğrulandı ancak güvenli tahsilat kaydı tamamlanamadı.");
  }

  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    data.ok !== true ||
    data.targetType !== input.targetType
  ) {
    if (captureId) await transitionCapture(captureId, "manual_review", "invalid_rpc_result");
    console.error("fulfillBillingPaymentAtomic invalid result", {
      source: input.source,
      targetType: input.targetType,
    });
    throw new Error("Ödeme tahsilat sonucu doğrulanamadı.");
  }

  if (captureId) await transitionCapture(captureId, "fulfilled");

  // Referans/ortak programı: ilk GERÇEK ödemede talep üretimi. Güvenli kanca: idempotent, asla fırlatmaz,
  // hata ödemeyi BOZMAZ (kaçırılırsa growth-claims cron'u süpürür). fulfill SQL gövdelerine dokunulmaz.
  if (input.targetType === "subscription" && typeof data.invoiceId === "string") {
    await registerClaimSafe(admin, data.invoiceId);
  }

  return {
    ...(data as AtomicFulfillmentResult),
    ok: true,
    already: data.already === true,
    targetType: input.targetType,
  };
}

/**
 * Ödeme başarılı olduğunda abonelik + fatura + tenant planını senkronlar.
 * Idempotent: aynı conversationId için ikinci çağrı no-op.
 */
export async function fulfillSuccessfulPayment(input: FulfillInput) {
  return fulfillBillingPaymentAtomic({
    provider: input.source === "demo" ? "demo" : "iyzico",
    conversationId: input.conversationId,
    paymentId: input.paymentId,
    source: input.source,
    targetType: "subscription",
    expectedTenantId: input.tenantId,
    expectedPlan: input.plan,
    expectedCycle: input.cycle,
    expectedAmountTry: input.expectedAmountTry,
    expectedCurrency: input.expectedCurrency,
  });
}

/**
 * TAM hesap kredisi ile ödeme (iyzico çağrılmaz): kredi rezervi toplamı karşılıyorsa (yalnız `try_credit.max_invoice_share`
 * = 1 yapılandırmasında olur) faturayı tamamlar. Capture yazılmaz; tek-sefer garantisi SQL'dedir.
 */
export async function fulfillInvoiceWithWalletCredit(input: {
  tenantId: string;
  plan: CatalogPlanId;
  cycle: BillingCycle;
  conversationId: string;
}) {
  return fulfillBillingPaymentAtomic({
    provider: "account_credit",
    conversationId: input.conversationId,
    paymentId: null,
    source: "demo",
    targetType: "subscription",
    expectedTenantId: input.tenantId,
    expectedPlan: input.plan,
    expectedCycle: input.cycle,
    expectedAmountTry: 0,
    expectedCurrency: IYZICO_CURRENCY,
  });
}

/** Aynı otomatik yenileme denemesi için fatura zaten var (başka koşu işliyor / işledi): sessizce atlanır. */
export class DuplicateAutoRenewAttemptError extends Error {
  constructor() {
    super("Bu otomatik yenileme denemesi için fatura zaten var.");
    this.name = "DuplicateAutoRenewAttemptError";
  }
}

export type CheckoutInvoiceResult = {
  invoiceId: string;
  totalTry: number;
  /** Faturaya yazılan KDV oranı (kesim anındaki ayar). */
  vatRate: number;
  /** Kullanıcı kredi istediyse uygulanan kredi (rezerv açıldı); yoksa null. */
  credit: AppliedWalletCredit | null;
};

export async function createCheckoutInvoice(input: {
  tenantId: string;
  subscriptionId: string | null;
  plan: CatalogPlanId;
  cycle: BillingCycle;
  conversationId: string;
  amountTry: number;
  /** Kullanıcı "kartımı sakla" açık rızasını verdi: callback doğrulanmış ödemeden sonra kartı kaydeder. */
  saveCard?: { consentUserId: string } | null;
  /** Ödeme kaynağı etiketi (varsayılan checkout; otomatik yenileme auto_renew). */
  source?: "checkout" | "auto_renew";
  /**
   * Otomatik yenileme tekillik anahtarı (`<abonelik>:<dönem sonu>:<deneme>`): DB'deki kısmi benzersiz indeks
   * aynı anahtarla ikinci faturayı reddeder (eş zamanlı iki koşu çift tahsilat yapamaz).
   */
  autoRenewAttemptKey?: string;
  /** "Hesap kredimi kullan": rezerv fatura taslağından hemen sonra, iyzico açılmadan ÖNCE yapılır. */
  walletCredit?: WalletCreditRequest | null;
  /**
   * Fatura türü + ek meta sözleşmesi (örn. oransal yükseltme: kind "plan_upgrade", fromPlan, chargeNetTry, newPeriodTry).
   * Temel alanlar (conversationId, plan, cycle, source) ezilemez; fulfill SQL `kind`ı okur.
   */
  kind?: "plan_upgrade";
  extraMeta?: Record<string, unknown>;
}): Promise<CheckoutInvoiceResult> {
  const admin = createAdminClient();
  const vatRate = await resolveAutoInvoiceVatRate(admin);
  const amounts = invoiceAmountsTry(input.amountTry, vatRate);
  const now = new Date();
  const checkoutExpiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const { data, error } = await admin
    .from("invoices")
    .insert({
      tenant_id: input.tenantId,
      subscription_id: input.subscriptionId,
      invoice_no: invoiceNo(input.tenantId),
      status: "draft",
      checkout_status: "pending_checkout",
      checkout_expires_at: checkoutExpiresAt.toISOString(),
      amount_try: amounts.amountTry,
      tax_try: amounts.taxTry,
      total_try: amounts.totalTry,
      currency: IYZICO_CURRENCY,
      period_start: null,
      period_end: null,
      due_at: null,
      meta: {
        ...(input.extraMeta ?? {}),
        ...(input.kind ? { kind: input.kind } : {}),
        conversationId: input.conversationId,
        plan: input.plan,
        cycle: input.cycle,
        source: input.source ?? "checkout",
        vatRate,
        ...(input.autoRenewAttemptKey ? { autoRenewAttemptKey: input.autoRenewAttemptKey } : {}),
        ...(input.saveCard
          ? { saveCard: true, saveCardConsentBy: input.saveCard.consentUserId, saveCardConsentVersion: "card-save-v1" }
          : {}),
      },
    })
    .select("id")
    .single();

  if (error) {
    if (input.autoRenewAttemptKey && error.code === "23505") throw new DuplicateAutoRenewAttemptError();
    console.error("createCheckoutInvoice", error);
    throw new Error("Fatura oluşturulamadı.");
  }
  const invoiceId = data.id as string;
  await writeAutoInvoiceLine(admin, {
    invoiceId,
    tenantId: input.tenantId,
    meta: { kind: input.kind, plan: input.plan },
    amounts,
    vatRate,
  });
  if (!input.walletCredit) return { invoiceId, totalTry: amounts.totalTry, vatRate, credit: null };

  const applied = await applyWalletCreditToInvoice(admin, {
    tenantId: input.tenantId,
    invoiceId,
    totalTry: amounts.totalTry,
    request: input.walletCredit,
  });
  if (!applied.ok) {
    // Fatura taslağı kullanılmayacak: sahipsiz kalmasın (rezerv zaten açılmadı).
    await admin
      .from("invoices")
      .update({ checkout_status: "initialization_failed" })
      .eq("id", invoiceId)
      .eq("tenant_id", input.tenantId)
      .eq("status", "draft");
    throw new ActionUserError(applied.error);
  }
  return { invoiceId, totalTry: amounts.totalTry, vatRate, credit: applied.applied };
}

export async function markCheckoutInvoiceInitialized(input: {
  invoiceId: string;
  tenantId: string;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("invoices")
    .update({
      checkout_status: "initialized",
      checkout_initialized_at: new Date().toISOString(),
    })
    .eq("id", input.invoiceId)
    .eq("tenant_id", input.tenantId)
    .eq("status", "draft")
    .eq("checkout_status", "pending_checkout")
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.error("markCheckoutInvoiceInitialized", error);
    throw new Error("Ödeme oturumu fatura taslağıyla eşleştirilemedi.");
  }
}

export async function markCheckoutInvoiceFailed(input: {
  invoiceId: string;
  tenantId: string;
  /** Sağlayıcının kesin ret metni ("<errorCode>: <errorMessage>", `checkoutErrorText`); ödeme profilinde gösterilir. */
  checkoutError?: string | null;
}) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("invoices")
    .update(
      input.checkoutError
        ? { checkout_status: "initialization_failed", checkout_error: input.checkoutError.slice(0, 500) }
        : { checkout_status: "initialization_failed" },
    )
    .eq("id", input.invoiceId)
    .eq("tenant_id", input.tenantId)
    .eq("status", "draft")
    .in("checkout_status", ["pending_checkout", "initialized"]);
  if (error) console.error("markCheckoutInvoiceFailed", error);
  // Başarısız/terk edilen checkout'ta kredi rezervi hemen serbest kalır (kalan kaçakları reconciliation'daki
  // try_credit_release_dead süpürür). Eski şemada (RPC yok) sessizce atlanır.
  await tryReleaseInvoice(admin, input.tenantId, input.invoiceId, "checkout_failed");
}

export async function assertBillingPlanPreflight(tenantId: string, plan: CatalogPlanId) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("billing_plan_change_preflight", {
    p_tenant_id: tenantId,
    p_plan: plan,
  });
  if (error) {
    console.error("assertBillingPlanPreflight", { code: error.code, message: error.message });
    throw new Error("Paket kapasitesi güvenli şekilde doğrulanamadı.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data) || data.ok !== true) {
    const blockers = data && typeof data === "object" && !Array.isArray(data)
      ? data.blockers
      : null;
    const labels = Array.isArray(blockers)
      ? blockers
          .map((item) => item && typeof item === "object" ? String(item.metric ?? "") : "")
          .filter(Boolean)
      : [];
    const labelMap: Record<string, string> = {
      seats: "aktif kullanıcı",
      customers: "müşteri",
      active_properties: "aktif portföy",
      branches: "aktif şube",
    };
    const detail = labels.map((label) => labelMap[label] ?? label).join(", ");
    throw new ActionUserError(
      detail
        ? `Bu pakete geçmeden önce kapasite aşımını giderin: ${detail}.`
        : "Seçilen paket mevcut kullanımı karşılamıyor.",
    );
  }
}
