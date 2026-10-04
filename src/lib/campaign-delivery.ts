import { createAdminClient } from "@/lib/supabase/admin";
import { DEMO_BLOCKED, isSampleCampaignRecipient } from "@/lib/sample-scope";
import {
  prepareTenantSmsSender,
  prepareTenantWhatsAppSender,
  type TenantSmsSender,
  type TenantWhatsAppSender,
} from "@/lib/messaging/tenant-providers";

const DEFAULT_CAMPAIGN_LIMIT = 3;
const DEFAULT_RECIPIENT_BATCH_SIZE = 10;
const CAMPAIGN_LEASE_SECONDS = 300;
const RECIPIENT_LEASE_SECONDS = 300;
const MAX_DELIVERY_ATTEMPTS = 5;

type JsonObject = Record<string, unknown>;

type ClaimedCampaign = {
  id: string;
  tenantId: string;
  processingToken: string;
  channel: "sms" | "whatsapp" | "email";
};

type ClaimedRecipient = {
  id: string;
  leaseToken: string;
};

type VerifiedDelivery = {
  allowed: true;
  recipientId: string;
  leaseToken: string;
  channel: "sms" | "whatsapp" | "email";
  address: string;
  message: string;
  whatsAppTemplate: {
    name: string;
    language: string;
    bodyParameter?: string;
  } | null;
};

type ProviderResult = {
  ok: boolean;
  provider: string;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  retryable: boolean;
};

export type CampaignDeliveryWorkerSummary = {
  campaignsClaimed: number;
  campaignsCompleted: number;
  campaignsRescheduled: number;
  campaignFailures: number;
  /** Başarısız kampanya parti hatalarının kısa nedenleri (en çok 3; heartbeat ayrıntısında görünür). */
  failureReasons?: string[];
  /** Şablon sözleşmesine uymadığı için atlanan eski WhatsApp kampanyaları (migration 20260816001100 bunları 'failed' yapar). */
  quarantinedCampaigns?: number;
  recipientsClaimed: number;
  sent: number;
  blocked: number;
  skipped: number;
  retrying: number;
  deadLettered: number;
};

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function stringField(value: JsonObject, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function parseCampaignClaim(value: unknown): ClaimedCampaign | null {
  const row = asObject(value);
  if (!row) return null;
  const id = stringField(row, "id");
  const tenantId = stringField(row, "tenant_id");
  const processingToken = stringField(row, "processing_token");
  const channel = stringField(row, "channel");
  return id &&
    tenantId &&
    processingToken &&
    (channel === "sms" || channel === "whatsapp" || channel === "email")
    ? { id, tenantId, processingToken, channel }
    : null;
}

function parseRecipientClaim(value: unknown): ClaimedRecipient | null {
  const row = asObject(value);
  if (!row) return null;
  const id = stringField(row, "recipient_id");
  const leaseToken = stringField(row, "lease_token");
  return id && leaseToken ? { id, leaseToken } : null;
}

function parseVerifiedDelivery(value: unknown): VerifiedDelivery | null {
  const row = asObject(value);
  if (!row || row.allowed !== true) return null;
  const recipientId = stringField(row, "recipient_id");
  const leaseToken = stringField(row, "lease_token");
  const channel = stringField(row, "channel");
  const address = stringField(row, "address");
  const rawMessage = row.message;
  const message = typeof rawMessage === "string" ? rawMessage : null;
  const whatsappTemplateName = stringField(row, "whatsapp_template_name");
  const whatsappTemplateLanguage = stringField(row, "whatsapp_template_language");
  if (
    !recipientId ||
    !leaseToken ||
    !address ||
    message === null ||
    (channel !== "sms" && channel !== "whatsapp" && channel !== "email")
  ) {
    return null;
  }
  if ((channel === "sms" || channel === "email") && !message) return null;
  if (channel === "whatsapp" && (!whatsappTemplateName || !whatsappTemplateLanguage)) {
    return null;
  }
  return {
    allowed: true,
    recipientId,
    leaseToken,
    channel,
    address,
    message,
    whatsAppTemplate: channel === "whatsapp"
      ? {
          name: whatsappTemplateName as string,
          language: whatsappTemplateLanguage as string,
          ...(message ? { bodyParameter: message } : {}),
        }
      : null,
  };
}

function boundedInteger(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.trunc(value as number), max));
}

/**
 * Provider failures with an explicit permanent response are never retried.
 * SMS transport/5xx failures and explicit 429 responses use database-owned
 * backoff. WhatsApp callers normalize ambiguous transport/408/5xx outcomes to
 * `unknown_provider_outcome`, which this helper deliberately never retries.
 */
export function isRetryableCampaignDeliveryFailure(error?: string, code?: string): boolean {
  if (code) {
    if (code === "unknown_provider_outcome") return false;
    if (code === "transport_error" || code === "provider_resolution_error") return true;
    const httpCode = /^http_(\d{3})$/.exec(code)?.[1];
    if (httpCode) {
      const status = Number(httpCode);
      return status === 429 || status >= 500;
    }
    const numeric = Number(code);
    if (Number.isFinite(numeric) && (numeric === 429 || numeric >= 500)) return true;
    return false;
  }

  const normalized = (error ?? "").toLocaleLowerCase("tr-TR");
  if (
    normalized.includes("yapılandırılmamış") ||
    normalized.includes("geçersiz telefon") ||
    normalized.includes("kredi yetersiz") ||
    normalized.includes("iys ret")
  ) {
    return false;
  }

  const httpStatus = /api hatası:\s*(\d{3})/i.exec(error ?? "")?.[1];
  if (httpStatus) {
    const status = Number(httpStatus);
    return status === 429 || status >= 500;
  }
  return true;
}

/** Avoid persisting arbitrary provider response bodies or secrets. */
export function campaignDeliveryErrorForStorage(error?: string, code?: string): string {
  if (code === "unknown_provider_outcome") {
    return "Sağlayıcı kabul sonucu belirsiz; manuel mutabakat gerekli.";
  }
  const codeStatus = /^http_(\d{3})$/.exec(code ?? "")?.[1];
  if (codeStatus) return `Sağlayıcı HTTP ${codeStatus} hatası.`;
  if (code && /^\d+$/.test(code)) return `Sağlayıcı hata kodu: ${code}`;
  if (code === "provider_receipt_missing") return "Sağlayıcı teslimat kimliği dönmedi.";
  if (code === "tenant_provider_unconfigured" || code === "provider_config_invalid") {
    return "Ofise ait mesaj sağlayıcısı yapılandırılmamış.";
  }
  if (code === "whatsapp_template_invalid") {
    return "WhatsApp kampanya şablonu geçersiz.";
  }
  const httpStatus = /api hatası:\s*(\d{3})/i.exec(error ?? "")?.[1];
  if (httpStatus) return `Sağlayıcı HTTP ${httpStatus} hatası.`;
  if ((error ?? "").toLocaleLowerCase("tr-TR").includes("yapılandırılmamış")) {
    return "Mesaj sağlayıcısı yapılandırılmamış.";
  }
  if ((error ?? "").toLocaleLowerCase("tr-TR").includes("geçersiz telefon")) {
    return "Geçersiz telefon numarası.";
  }
  return "Mesaj sağlayıcısına erişilemedi.";
}

async function sendToProvider(
  delivery: VerifiedDelivery,
  smsSender: TenantSmsSender | null,
  whatsAppSender: TenantWhatsAppSender | null,
): Promise<ProviderResult> {
  if (delivery.channel === "sms") {
    try {
      if (!smsSender) throw new Error("sms_sender_not_prepared");
      const result = await smsSender(delivery.address, delivery.message);
      const acceptedWithReceipt = result.ok && Boolean(result.jobid);
      const errorCode = result.ok && !result.jobid
        ? "provider_receipt_missing"
        : result.code;
      return {
        ok: acceptedWithReceipt,
        provider: "netgsm",
        providerMessageId: result.jobid,
        errorCode,
        errorMessage: acceptedWithReceipt
          ? undefined
          : campaignDeliveryErrorForStorage(result.error, errorCode),
        retryable: acceptedWithReceipt
          ? false
          : isRetryableCampaignDeliveryFailure(result.error, errorCode),
      };
    } catch {
      return {
        ok: false,
        provider: "netgsm",
        errorCode: "transport_error",
        errorMessage: "Mesaj sağlayıcısına erişilemedi.",
        retryable: true,
      };
    }
  }

  if (delivery.channel === "whatsapp") {
    try {
      if (!whatsAppSender) throw new Error("whatsapp_sender_not_prepared");
      if (!delivery.whatsAppTemplate) {
        return {
          ok: false,
          provider: "whatsapp",
          errorCode: "whatsapp_template_invalid",
          errorMessage: "WhatsApp kampanya şablonu geçersiz.",
          retryable: false,
        };
      }
      const result = await whatsAppSender(delivery.address, delivery.whatsAppTemplate);
      const httpStatus = /^http_(\d{3})$/.exec(result.code ?? "")?.[1];
      const acceptedWithReceipt = result.ok && Boolean(result.messageId);
      const ambiguousOutcome =
        (result.ok && !result.messageId) ||
        result.code === "transport_error" ||
        result.code === "provider_receipt_missing" ||
        (httpStatus !== undefined && (Number(httpStatus) === 408 || Number(httpStatus) >= 500));
      const errorCode = ambiguousOutcome ? "unknown_provider_outcome" : result.code;
      return {
        ok: acceptedWithReceipt,
        provider: "whatsapp",
        providerMessageId: result.messageId,
        errorCode,
        errorMessage: acceptedWithReceipt
          ? undefined
          : campaignDeliveryErrorForStorage(result.error, errorCode),
        retryable: acceptedWithReceipt
          ? false
          : isRetryableCampaignDeliveryFailure(result.error, errorCode),
      };
    } catch {
      return {
        ok: false,
        provider: "whatsapp",
        errorCode: "unknown_provider_outcome",
        errorMessage: "Sağlayıcı kabul sonucu belirsiz; manuel mutabakat gerekli.",
        retryable: false,
      };
    }
  }

  // There is no email provider in this codebase. Creation is also blocked,
  // but a legacy email draft must remain fail-closed if it reaches the queue.
  return {
    ok: false,
    provider: "email_unconfigured",
    errorCode: "provider_unconfigured",
    errorMessage: "E-posta gönderim sağlayıcısı yapılandırılmamış.",
    retryable: false,
  };
}

async function processClaimedCampaign(
  admin: ReturnType<typeof createAdminClient>,
  campaign: ClaimedCampaign,
  recipientBatchSize: number,
): Promise<{
  finalStatus: string;
  recipientsClaimed: number;
  sent: number;
  blocked: number;
  skipped: number;
  retrying: number;
  deadLettered: number;
}> {
  const result = {
    finalStatus: "scheduled",
    recipientsClaimed: 0,
    sent: 0,
    blocked: 0,
    skipped: 0,
    retrying: 0,
    deadLettered: 0,
  };
  // Resolve tenant-owned secrets before the per-recipient consent check. The
  // prepared sender performs network I/O only, keeping consent verification as
  // the final database operation before delivery.
  const smsSender = campaign.channel === "sms"
    ? await prepareTenantSmsSender(campaign.tenantId)
    : null;
  const whatsAppSender = campaign.channel === "whatsapp"
    ? await prepareTenantWhatsAppSender(campaign.tenantId)
    : null;

  for (let index = 0; index < recipientBatchSize; index += 1) {
    const { data: claimData, error: claimError } = await admin.rpc(
      "claim_campaign_recipient_delivery",
      {
        p_campaign_id: campaign.id,
        p_tenant_id: campaign.tenantId,
        p_processing_token: campaign.processingToken,
        p_lease_seconds: RECIPIENT_LEASE_SECONDS,
        p_max_attempts: MAX_DELIVERY_ATTEMPTS,
      },
    );
    if (claimError) throw new Error(`recipient_claim_failed:${claimError.code ?? "unknown"}`);

    const recipient = parseRecipientClaim(claimData);
    if (!recipient) break;
    result.recipientsClaimed += 1;

    const { data: verificationData, error: verificationError } = await admin.rpc(
      "verify_campaign_recipient_consent",
      {
        p_campaign_id: campaign.id,
        p_tenant_id: campaign.tenantId,
        p_processing_token: campaign.processingToken,
        p_recipient_id: recipient.id,
        p_lease_token: recipient.leaseToken,
      },
    );
    if (verificationError) {
      throw new Error(`recipient_consent_verification_failed:${verificationError.code ?? "unknown"}`);
    }

    const verificationRow = asObject(verificationData);
    const delivery = parseVerifiedDelivery(verificationData);
    if (!delivery) {
      const state = verificationRow ? stringField(verificationRow, "state") : null;
      if (state === "blocked") result.blocked += 1;
      else if (state === "dead_letter") result.deadLettered += 1;
      else result.skipped += 1;
      continue;
    }

    // No database or network work is intentionally placed between the consent
    // verification above and this provider call.
    // Demo (is_sample) müşteriye ASLA gerçek gönderim yapılmaz (son savunma).
    const providerResult: ProviderResult = (await isSampleCampaignRecipient(admin, delivery.recipientId))
      ? {
          ok: false,
          provider: DEMO_BLOCKED,
          errorCode: DEMO_BLOCKED,
          errorMessage: "Demo kayıt: gerçek gönderim engellendi.",
          retryable: false,
        }
      : await sendToProvider(delivery, smsSender, whatsAppSender);
    const { data: completionData, error: completionError } = await admin.rpc(
      "complete_campaign_recipient_delivery",
      {
        p_campaign_id: campaign.id,
        p_tenant_id: campaign.tenantId,
        p_processing_token: campaign.processingToken,
        p_recipient_id: delivery.recipientId,
        p_lease_token: delivery.leaseToken,
        p_success: providerResult.ok,
        p_provider: providerResult.provider,
        p_provider_message_id: providerResult.providerMessageId ?? null,
        p_error_code: providerResult.errorCode ?? null,
        p_error_message: providerResult.errorMessage ?? null,
        p_retryable: providerResult.retryable,
        p_max_attempts: MAX_DELIVERY_ATTEMPTS,
      },
    );
    if (completionError) {
      // The migration will dead-letter this unknown outcome after the lease
      // expires. Retrying here could duplicate an already accepted message.
      throw new Error(`recipient_completion_failed:${completionError.code ?? "unknown"}`);
    }

    const completion = asObject(completionData);
    const state = completion ? stringField(completion, "state") : null;
    if (state === "sent") result.sent += 1;
    else if (state === "retry") result.retrying += 1;
    else result.deadLettered += 1;
  }

  const { data: finalizeData, error: finalizeError } = await admin.rpc(
    "finalize_campaign_delivery_batch",
    {
      p_campaign_id: campaign.id,
      p_tenant_id: campaign.tenantId,
      p_processing_token: campaign.processingToken,
    },
  );
  if (finalizeError) throw new Error(`campaign_finalize_failed:${finalizeError.code ?? "unknown"}`);

  const finalize = asObject(finalizeData);
  result.finalStatus = finalize ? stringField(finalize, "status") ?? "scheduled" : "scheduled";
  return result;
}

const CHECK_VIOLATION_CODE = "23514";
const WHATSAPP_TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;
const WHATSAPP_TEMPLATE_LANGUAGE_RE = /^[a-z]{2,3}(_[A-Z]{2})?$/;

/** campaigns_whatsapp_template_contract kısıtının aktif satırlar için istemci tarafı karşılığı. */
export function isCampaignViolatingTemplateContract(row: {
  channel: string;
  message: string | null;
  whatsapp_template_name: string | null;
  whatsapp_template_language: string | null;
}): boolean {
  if (row.channel === "whatsapp") {
    return !(
      row.whatsapp_template_name &&
      WHATSAPP_TEMPLATE_NAME_RE.test(row.whatsapp_template_name) &&
      row.whatsapp_template_language &&
      WHATSAPP_TEMPLATE_LANGUAGE_RE.test(row.whatsapp_template_language) &&
      (row.message ?? "").length <= 612
    );
  }
  return Boolean(row.whatsapp_template_name || row.whatsapp_template_language);
}

type CampaignCandidateRow = {
  id: string;
  channel: string;
  message: string | null;
  whatsapp_template_name: string | null;
  whatsapp_template_language: string | null;
};

/**
 * Genel claim 23514 verdiğinde: bekleyen kampanyaları listeler, kısıtı ihlal edenleri atlar ve
 * geçerli ilk kampanyayı kimliğiyle claim eder. Böylece tek bozuk kampanya tüm teslimatı durdurmaz.
 */
async function claimAroundInvalidCampaigns(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ claim: unknown; quarantined: string[]; error: string | null }> {
  const quarantined: string[] = [];
  const { data, error } = await admin
    .from("campaigns")
    .select("id, channel, message, whatsapp_template_name, whatsapp_template_language")
    .in("status", ["sending", "scheduled"])
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) return { claim: null, quarantined, error: error.code ?? "candidate_query" };

  for (const row of (data ?? []) as CampaignCandidateRow[]) {
    if (isCampaignViolatingTemplateContract(row)) {
      quarantined.push(row.id);
      continue;
    }
    const { data: claimData, error: claimError } = await admin.rpc("claim_campaign_delivery", {
      p_campaign_id: row.id,
      p_tenant_id: null,
      p_force: false,
      p_lease_seconds: CAMPAIGN_LEASE_SECONDS,
    });
    if (claimError) {
      if (claimError.code === CHECK_VIOLATION_CODE) {
        quarantined.push(row.id);
        continue;
      }
      return { claim: null, quarantined, error: claimError.code ?? "unknown" };
    }
    if (claimData) return { claim: claimData, quarantined, error: null };
  }
  return { claim: null, quarantined, error: null };
}

/**
 * Claims and processes bounded campaign/recipient batches. The existing
 * claim_campaign_delivery RPC owns campaign concurrency; recipient RPCs own
 * consent evidence, retries and provider-result idempotency.
 */
export async function runCampaignDeliveryWorker(options?: {
  campaignLimit?: number;
  recipientBatchSize?: number;
}): Promise<CampaignDeliveryWorkerSummary> {
  const campaignLimit = boundedInteger(options?.campaignLimit, DEFAULT_CAMPAIGN_LIMIT, 10);
  const recipientBatchSize = boundedInteger(
    options?.recipientBatchSize,
    DEFAULT_RECIPIENT_BATCH_SIZE,
    50,
  );
  const admin = createAdminClient();
  const summary: CampaignDeliveryWorkerSummary = {
    campaignsClaimed: 0,
    campaignsCompleted: 0,
    campaignsRescheduled: 0,
    campaignFailures: 0,
    recipientsClaimed: 0,
    sent: 0,
    blocked: 0,
    skipped: 0,
    retrying: 0,
    deadLettered: 0,
  };

  for (let index = 0; index < campaignLimit; index += 1) {
    const { data: claimData, error: claimError } = await admin.rpc("claim_campaign_delivery", {
      p_campaign_id: null,
      p_tenant_id: null,
      p_force: false,
      p_lease_seconds: CAMPAIGN_LEASE_SECONDS,
    });
    let claimResult: unknown = claimData;
    if (claimError) {
      // 23514: eski (şablonsuz) WhatsApp kampanyası claim UPDATE'inde kısıta takılıyor.
      // Migration uygulanana dek bozuk kampanyayı atlayıp geçerli kampanyaları işle.
      if (claimError.code !== CHECK_VIOLATION_CODE) {
        throw new Error(`campaign_claim_failed:${claimError.code ?? "unknown"}`);
      }
      const fallback = await claimAroundInvalidCampaigns(admin);
      summary.quarantinedCampaigns = (summary.quarantinedCampaigns ?? 0) + fallback.quarantined.length;
      if (fallback.quarantined.length > 0 && (summary.failureReasons ?? []).length < 3) {
        summary.failureReasons = [
          ...(summary.failureReasons ?? []),
          `campaign_claim_check_violation:atlanan=${fallback.quarantined.slice(0, 3).join(",")}`,
        ];
      }
      if (fallback.error) {
        throw new Error(`campaign_claim_failed:${fallback.error}`);
      }
      claimResult = fallback.claim;
    }

    const campaign = parseCampaignClaim(claimResult);
    if (!campaign) break;
    summary.campaignsClaimed += 1;

    try {
      const campaignResult = await processClaimedCampaign(admin, campaign, recipientBatchSize);
      summary.recipientsClaimed += campaignResult.recipientsClaimed;
      summary.sent += campaignResult.sent;
      summary.blocked += campaignResult.blocked;
      summary.skipped += campaignResult.skipped;
      summary.retrying += campaignResult.retrying;
      summary.deadLettered += campaignResult.deadLettered;
      if (campaignResult.finalStatus === "scheduled") summary.campaignsRescheduled += 1;
      else summary.campaignsCompleted += 1;
    } catch (error) {
      summary.campaignFailures += 1;
      const reason = error instanceof Error ? error.message.slice(0, 160) : "unknown";
      if ((summary.failureReasons ?? []).length < 3) {
        summary.failureReasons = [...(summary.failureReasons ?? []), reason];
      }
      console.error("campaign delivery batch failed", {
        campaignId: campaign.id,
        reason,
      });
    }
  }

  return summary;
}
