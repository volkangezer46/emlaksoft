import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlatformSetting } from "@/lib/platform-settings";
import {
  chargeStoredCard,
  isIyzicoConfigured,
  IYZICO_CURRENCY,
  verifyStoredCardPayment,
} from "@/lib/billing/iyzico";
import {
  createCheckoutInvoice,
  DuplicateAutoRenewAttemptError,
  fulfillSuccessfulPayment,
  invoiceAmountsTry,
  markCheckoutInvoiceFailed,
  markCheckoutInvoiceInitialized,
} from "@/lib/billing/fulfillment";
import { validateCheckoutBuyer } from "@/lib/billing/buyer";
import {
  AUTO_RENEW_FLAG_KEY,
  autoRenewAttemptAllowed,
  parseAutoRenewFlag,
} from "@/lib/billing/cards";
import type { BillingCycle, PlanId } from "@/lib/billing/plans";
import { insertNotifications, type NotificationRow } from "@/lib/notify-batch";
import { randomBytes } from "node:crypto";

/**
 * OTOMATİK YENİLEME (kullanıcı oturumda DEĞİLKEN saklı kartla tahsilat) — ALTYAPI, VARSAYILAN KAPALI.
 *
 * Kapılar (HEPSİ gerekir, sırayla; biri kapalıysa hiçbir ödeme çağrısı yapılmaz):
 *  1) platform_settings `billing.auto_renew_enabled` = "true" (yönetici bayrağı; satır yoksa KAPALI)
 *  2) iyzico yapılandırılmış
 *  3) ofis açık rıza verdi (tenant_payment_profiles.auto_renew_enabled + rıza kimliği/zamanı/IP)
 *  4) abonelik `past_due` (dunning ile aynı kapsam) ve deneme sınırı (en çok 3, aralık 3 gün)
 *
 * Dunning entegrasyonu: dunning cron'u bildirimleri her zamanki gibi gönderir; ardından bu geçiş çağrılır.
 * Başarısızlıkta mevcut bildirim akışı (dunning kademeleri) aynen sürer, ayrıca ofise "otomatik yenileme başarısız"
 * bildirimi düşer. Başarıda fulfill zinciri (imza + tutar + paymentId mutabakatı) Checkout Form ile AYNIDIR.
 *
 * iyzico NOTU: kullanıcısız (off-session) tahsilat için satıcı hesabında kart saklama + bu akışın etkinleştirilmesi/onayı
 * gerekebilir; onaysız hesapta sağlayıcı hata döner, fatura "başlatılamadı" kalır ve dunning devam eder.
 * Bayrağı AÇMADAN önce iyzico sandbox'ında doğrulanmalıdır.
 */

export type AutoRenewSummary = {
  enabled: boolean;
  attempted: number;
  charged: number;
  failed: number;
  skipped: number;
};

const OFF: AutoRenewSummary = { enabled: false, attempted: 0, charged: 0, failed: 0, skipped: 0 };
const BILLING_HREF = "/app/abonelik";
const HISTORY_DAYS = 30;

export async function runAutoRenewPass(
  admin: SupabaseClient,
  nowMs: number,
): Promise<AutoRenewSummary> {
  // KAPI 1+2: bayrak kapalıysa / iyzico yoksa hiçbir sorgu/ödeme yapılmaz.
  if (!parseAutoRenewFlag(await getPlatformSetting(AUTO_RENEW_FLAG_KEY))) return OFF;
  if (!isIyzicoConfigured()) return OFF;

  const summary: AutoRenewSummary = { enabled: true, attempted: 0, charged: 0, failed: 0, skipped: 0 };
  const { data: profiles, error } = await admin
    .from("tenant_payment_profiles")
    .select(
      "tenant_id, provider_card_user_key, auto_renew_card_id, auto_renew_consent_by, auto_renew_consent_ip",
    )
    .eq("auto_renew_enabled", true)
    .not("auto_renew_consent_at", "is", null)
    .limit(200);
  if (error) {
    console.error("autoRenew profiles", error.code);
    return summary;
  }

  const notices: NotificationRow[] = [];
  for (const p of profiles ?? []) {
    const tenantId = String(p.tenant_id);
    try {
      const outcome = await renewOne(admin, tenantId, p, nowMs);
      if (outcome === "skipped") summary.skipped += 1;
      else {
        summary.attempted += 1;
        if (outcome === "charged") summary.charged += 1;
        else {
          summary.failed += 1;
          notices.push({
            tenant_id: tenantId,
            title: "Otomatik yenileme tahsilatı başarısız",
            body: "Kayıtlı kartınızdan otomatik tahsilat yapılamadı. Lütfen kartınızı kontrol edin veya ödemeyi elle tamamlayın.",
            href: BILLING_HREF,
            kind: "warning",
          });
        }
      }
    } catch (e) {
      summary.failed += 1;
      console.error("autoRenew tenant", e instanceof Error ? e.message : "error");
    }
  }
  if (notices.length > 0) await insertNotifications(admin, notices);
  return summary;
}

type ProfileRow = {
  provider_card_user_key: string | null;
  auto_renew_card_id: string | null;
  auto_renew_consent_by: string | null;
  auto_renew_consent_ip: string | null;
};

async function renewOne(
  admin: SupabaseClient,
  tenantId: string,
  p: ProfileRow,
  nowMs: number,
): Promise<"skipped" | "charged" | "failed"> {
  if (!p.provider_card_user_key || !p.auto_renew_card_id || !p.auto_renew_consent_by || !p.auto_renew_consent_ip) {
    return "skipped";
  }

  const { data: sub } = await admin
    .from("subscriptions")
    .select("id, plan, billing_cycle, amount_try, status, current_period_end")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!sub || sub.status !== "past_due" || !(Number(sub.amount_try) > 0)) return "skipped";

  const sinceIso = new Date(nowMs - HISTORY_DAYS * 86_400_000).toISOString();
  const { data: prior } = await admin
    .from("invoices")
    .select("created_at, status, checkout_status")
    .eq("tenant_id", tenantId)
    .filter("meta->>source", "eq", "auto_renew")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(10);
  // Çözülmemiş önceki deneme (fatura hâlâ "initialized": tahsilat alınmış olabilir ama fulfill tamamlanmamış, ya da
  // koşu yarıda kesilmiş): YENİ tahsilat YAPILMAZ; mutabakat/yönetici çözer. Çift tahsilatın son kapısı.
  if ((prior ?? []).some((i) => i.status === "draft" && i.checkout_status === "initialized")) return "skipped";
  const last = prior?.[0]?.created_at ? new Date(prior[0].created_at as string).getTime() : null;
  if (!autoRenewAttemptAllowed({ priorAttempts: prior?.length ?? 0, lastAttemptAtMs: last, nowMs })) {
    return "skipped";
  }

  const { data: card } = await admin
    .from("payment_cards")
    .select("provider_card_token")
    .eq("tenant_id", tenantId)
    .eq("id", p.auto_renew_card_id)
    .maybeSingle();
  if (!card?.provider_card_token) return "skipped";

  const [{ data: tenant }, { data: profile }, userRes] = await Promise.all([
    admin.from("tenants").select("tax_number, phone, address_line, city").eq("id", tenantId).maybeSingle(),
    admin.from("profiles").select("full_name, phone").eq("id", p.auto_renew_consent_by).eq("tenant_id", tenantId).maybeSingle(),
    admin.auth.admin.getUserById(p.auto_renew_consent_by),
  ]);
  if (!tenant || !profile) return "skipped";
  const buyer = validateCheckoutBuyer({
    id: p.auto_renew_consent_by,
    fullName: profile.full_name,
    email: userRes.data.user?.email,
    phone: profile.phone || tenant.phone,
    identityNumber: tenant.tax_number,
    address: tenant.address_line,
    city: tenant.city,
    ip: p.auto_renew_consent_ip,
  });

  const plan = sub.plan as PlanId;
  const cycle = (sub.billing_cycle === "yearly" ? "yearly" : "monthly") as BillingCycle;
  const conversationId = `es-${tenantId.slice(0, 8)}-${randomBytes(12).toString("hex")}`;
  const amounts = invoiceAmountsTry(Number(sub.amount_try));
  // Çift tahsilat koruması: `<abonelik>:<dönem sonu>:<deneme no>` anahtarı DB'de benzersizdir (kısmi indeks). Eş zamanlı
  // ikinci koşu aynı anahtarla fatura açamaz → sessizce atlanır; kart ÇEKİLMEZ.
  const periodKey = typeof sub.current_period_end === "string" ? sub.current_period_end.slice(0, 10) : "none";
  const autoRenewAttemptKey = autoRenewAttemptKeyOf(String(sub.id), periodKey, (prior?.length ?? 0) + 1);
  let invoiceId: string;
  try {
    const created = await createCheckoutInvoice({
      tenantId,
      subscriptionId: String(sub.id),
      plan,
      cycle,
      conversationId,
      amountTry: amounts.amountTry,
      source: "auto_renew",
      autoRenewAttemptKey,
    });
    invoiceId = created.invoiceId;
  } catch (e) {
    if (e instanceof DuplicateAutoRenewAttemptError) return "skipped";
    throw e;
  }

  // Tahsilattan ÖNCE fatura "initialized" olur (fulfill SQL'i başlatılmış checkout faturası bekler; ödeme sonrası
  // eşleşmeme/askıda kalma olmaz). Başarısızsa kart çekilmez.
  try {
    await markCheckoutInvoiceInitialized({ invoiceId, tenantId });
  } catch (e) {
    await markCheckoutInvoiceFailed({ invoiceId, tenantId });
    console.error("autoRenew init", e instanceof Error ? e.message : "error");
    return "failed";
  }

  // BELİRSİZLİK İLKESİ (çift çekim yok): ağ/zaman aşımı/HTTP hatası ya da doğrulama (imza/tutar/eşleşme) hatasında para
  // alınmış OLABİLİR; fatura "initialized" KALIR (yeni tahsilat engellenir, mutabakat/yönetici çözer, kredi rezervi
  // serbest bırakılmaz). Yalnız sağlayıcının KESİN ret yanıtı (status=failure + errorCode) faturayı
  // "initialization_failed" yapar.
  let verified: ReturnType<typeof verifyStoredCardPayment>;
  let result: Awaited<ReturnType<typeof chargeStoredCard>>;
  try {
    result = await chargeStoredCard({
      conversationId,
      price: amounts.totalTry,
      basketId: conversationId,
      cardUserKey: p.provider_card_user_key,
      cardToken: card.provider_card_token as string,
      buyer: buyer.buyer,
      billingAddress: buyer.billingAddress,
      basketItemName: `EmlakSoft ${plan} (${cycle === "yearly" ? "yıllık" : "aylık"}) otomatik yenileme`,
    });
  } catch (e) {
    console.error("autoRenew charge (belirsiz: fatura initialized kalır)", e instanceof Error ? e.message : "error");
    return "failed";
  }
  if (isDefinitiveStoredCardDecline(result)) {
    await markCheckoutInvoiceFailed({ invoiceId, tenantId });
    console.error("autoRenew charge declined", { code: result.errorCode });
    return "failed";
  }
  try {
    // Checkout Form ile aynı sıkı mutabakat: imza, durum, fraudStatus, conversationId/basketId, para birimi, tutar.
    verified = verifyStoredCardPayment(result, {
      conversationId,
      basketId: conversationId,
      amountTry: amounts.totalTry,
    });
  } catch (e) {
    console.error("autoRenew verify (belirsiz: fatura initialized kalır)", e instanceof Error ? e.message : "error");
    return "failed";
  }

  // Tahsilat DOĞRULANDI: fulfill hatası faturayı "başarısız" işaretlemez (para alındı). Mutabakat kaydı
  // (record_billing_payment_capture) fulfill içinde yazılır; hata olursa reconciliation/yeniden deneme devralır.
  try {
    await fulfillSuccessfulPayment({
      tenantId,
      plan,
      cycle,
      conversationId,
      paymentId: verified.paymentId,
      expectedAmountTry: verified.amountTry,
      expectedCurrency: IYZICO_CURRENCY,
      source: "callback",
    });
    return "charged";
  } catch (e) {
    console.error("autoRenew fulfill", e instanceof Error ? e.message : "error");
    return "failed";
  }
}

/**
 * Saklı kart tahsilatında KESİN ret: sağlayıcı açıkça status=failure + hata kodu döndü (para alınmadı). Başka her durum
 * (ağ/zaman aşımı, imza/tutar uyuşmazlığı, beklenmeyen biçim) BELİRSİZDİR ve faturayı "initialized" bırakır. Saf; testlenebilir.
 */
export function isDefinitiveStoredCardDecline(result: { status?: unknown; errorCode?: unknown } | null | undefined): boolean {
  if (!result) return false;
  return String(result.status ?? "").trim().toLowerCase() === "failure" && String(result.errorCode ?? "").trim() !== "";
}

/** Otomatik yenileme tekillik anahtarı (saf; testlenebilir). */
export function autoRenewAttemptKeyOf(subscriptionId: string, periodKey: string, attemptNo: number): string {
  return `${subscriptionId}:${periodKey}:${attemptNo}`;
}
