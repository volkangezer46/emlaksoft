"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { checkRateLimit } from "@/lib/rate-limit";
import { logActivity } from "@/lib/activity";
import { DAY_MS, now, parseTrLocalDateTime } from "@/lib/clock";
import {
  listApprovedTenantWhatsAppTemplates,
  type ApprovedWhatsAppTemplate,
} from "@/lib/messaging/whatsapp-cloud";
import { actionErrorMessage } from "@/lib/action-errors";
import { describeIysGate, describeSkipReasons, gateIysRecipients, type IysGateResult } from "@/lib/iys/gate";

export type CampaignResult = { ok?: boolean; error?: string; id?: string };
export type WhatsAppTemplateListResult =
  | { ok: true; templates: ApprovedWhatsAppTemplate[] }
  | { ok: false; error: string };

const CAMPAIGN_FILTERS = new Set(["all", "type:alici", "type:satici", "type:kira"]);
const WHATSAPP_TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;
const WHATSAPP_TEMPLATE_LANGUAGE_RE = /^[a-z]{2,3}(?:_[A-Z]{2})?$/;

/** Returns only approved template name/language pairs; provider secrets stay server-side. */
export async function listApprovedWhatsAppTemplates(): Promise<WhatsAppTemplateListResult> {
  const gate = await requirePermission("campaigns", "create");
  if (!gate.ok) return { ok: false, error: gate.error };

  const rate = await checkRateLimit(
    `whatsapp-template-list:${gate.tenantId}:${gate.userId}`,
    { limit: 10, windowSec: 60, failurePolicy: "deny" },
  );
  if (!rate.allowed) {
    return {
      ok: false,
      error: "Şablon listesi çok sık yenilendi; lütfen bir dakika sonra tekrar deneyin.",
    };
  }

  return listApprovedTenantWhatsAppTemplates(gate.tenantId);
}

// ---------------------------------------------------------------------------
// Hedef kitle önizlemesi: izinli / izinsiz alıcı sayısı (merkezi İYS kapısı)
// ---------------------------------------------------------------------------

export type CampaignAudiencePreview =
  | { ok: true; total: number; allowed: number; skipped: number; reasons: IysGateResult["reasons"]; summary: string; detail: string }
  | { ok: false; error: string };

const PREVIEW_PAGE = 1000;
const PREVIEW_MAX_PAGES = 20;

/**
 * Kampanya oluşturma ekranı için: seçilen kanal + hedef kitle filtresine uyan (telefonu olan, kara listede olmayan) müşterilerden
 * kaç tanesinin o kanalda İYS izni var, kaçı atlanacak. Hesap, gönderimde kullanılan merkezi kapıyla (src/lib/iys/gate.ts) AYNIDIR;
 * teslimat anında izin yeniden doğrulanır (DB sözleşmesi), burada yalnız önizleme verilir. Hiçbir kayıt yazılmaz.
 */
export async function previewCampaignAudience(channel: string, filter: string): Promise<CampaignAudiencePreview> {
  const gate = await requirePermission("campaigns", "create");
  if (!gate.ok) return { ok: false, error: gate.error };
  const ch = String(channel ?? "").trim();
  const flt = String(filter ?? "all").trim();
  if (ch !== "sms" && ch !== "whatsapp") return { ok: false, error: "Geçersiz kampanya kanalı." };
  if (!CAMPAIGN_FILTERS.has(flt)) return { ok: false, error: "Geçersiz hedef kitle filtresi." };

  const supabase = await createClient();
  const ids: string[] = [];
  for (let page = 0; page < PREVIEW_MAX_PAGES; page += 1) {
    let q = supabase
      .from("customers")
      .select("id")
      .eq("tenant_id", gate.tenantId)
      .is("deleted_at", null)
      .eq("blacklist", false)
      .not("phone", "is", null)
      .neq("phone", "");
    if (flt !== "all") q = q.contains("customer_types", [flt.split(":")[1]]);
    const { data, error } = await q.order("id", { ascending: true }).range(page * PREVIEW_PAGE, page * PREVIEW_PAGE + PREVIEW_PAGE - 1);
    if (error) return { ok: false, error: "Hedef kitle okunamadı; sayfayı yenileyip tekrar deneyin." };
    const got = (data ?? []) as { id: string }[];
    ids.push(...got.map((r) => r.id));
    if (got.length < PREVIEW_PAGE) break;
  }

  const result = await gateIysRecipients(supabase, { tenantId: gate.tenantId, kind: "campaign", channel: ch, customerIds: ids });
  return {
    ok: true,
    total: result.total,
    allowed: result.allowed.length,
    skipped: result.skippedCount,
    reasons: result.reasons,
    summary: describeIysGate(result),
    detail: describeSkipReasons(result.reasons),
  };
}

// ---------------------------------------------------------------------------
// Kampanya oluştur
// ---------------------------------------------------------------------------

export async function createCampaign(
  _prev: CampaignResult,
  fd: FormData,
): Promise<CampaignResult> {
  const gate = await requirePermission("campaigns", "create");
  if (!gate.ok) return { error: gate.error };

  const title = String(fd.get("title") ?? "").trim();
  const channel = String(fd.get("channel") ?? "sms").trim();
  const message = String(fd.get("message") ?? "").trim();
  const filter = String(fd.get("filter") ?? "all").trim();
  const whatsappTemplateName = String(fd.get("whatsappTemplateName") ?? "").trim();
  const whatsappTemplateLanguage = String(fd.get("whatsappTemplateLanguage") ?? "").trim();

  if (!title) return { error: "Kampanya başlığı zorunludur." };
  if (message.length > 612) return { error: "Mesaj en fazla 612 karakter olabilir." };
  if (channel === "email") {
    return { error: "E-posta gönderim sağlayıcısı henüz yapılandırılmadı; bu kanal kullanılamaz." };
  }
  if (channel !== "sms" && channel !== "whatsapp") {
    return { error: "Geçersiz kampanya kanalı." };
  }
  if (channel === "sms" && !message) return { error: "SMS mesaj metni zorunludur." };
  if (
    channel === "whatsapp" &&
    (!WHATSAPP_TEMPLATE_NAME_RE.test(whatsappTemplateName) ||
      !WHATSAPP_TEMPLATE_LANGUAGE_RE.test(whatsappTemplateLanguage))
  ) {
    return {
      error: "WhatsApp kampanyası için Meta tarafından onaylanmış şablon adı ve geçerli dil kodu zorunludur.",
    };
  }
  if (!CAMPAIGN_FILTERS.has(filter)) {
    return { error: "Geçersiz hedef kitle filtresi." };
  }

  const admin = createAdminClient();
  const { data: createResult, error: createError } = await admin.rpc(
    "create_campaign_with_recipients",
    {
      p_tenant_id: gate.tenantId,
      p_created_by: gate.userId,
      p_title: title,
      p_channel: channel,
      p_message: message,
      p_filter: filter,
      p_whatsapp_template_name: channel === "whatsapp" ? whatsappTemplateName : null,
      p_whatsapp_template_language: channel === "whatsapp" ? whatsappTemplateLanguage : null,
    },
  );
  if (createError) {
    if (createError.message.includes("No eligible campaign recipients")) {
      return { error: "Seçilen filtreye uygun telefon numarası bulunamadı." };
    }
    console.error("atomic campaign creation failed", { code: createError.code });
    return { error: "Kampanya ve alıcı kuyruğu oluşturulamadı; hiçbir kayıt kaydedilmedi." };
  }

  const created = createResult && typeof createResult === "object" && !Array.isArray(createResult)
    ? createResult as Record<string, unknown>
    : null;
  const campaignId = typeof created?.id === "string" ? created.id : null;
  if (!campaignId) return { error: actionErrorMessage(null, "Kampanya oluşturma sonucu doğrulanamadı.") };

  revalidatePath("/app/kampanyalar");
  return { ok: true, id: campaignId };
}

// ---------------------------------------------------------------------------
// Taslak kampanyayı düzenle (başlık + mesaj / WhatsApp şablonu)
// ---------------------------------------------------------------------------

/**
 * Yalnız TASLAK kampanya düzenlenir. Kanal ve hedef kitle alıcı kuyruğunu belirlediği için
 * değişmez (değiştirmek için yeni kampanya açılır); başlık, mesaj ve WhatsApp şablonu değişir.
 */
export async function updateCampaign(_prev: CampaignResult, fd: FormData): Promise<CampaignResult> {
  const gate = await requirePermission("campaigns", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  const title = String(fd.get("title") ?? "").trim();
  const message = String(fd.get("message") ?? "").trim();
  const whatsappTemplateName = String(fd.get("whatsappTemplateName") ?? "").trim();
  const whatsappTemplateLanguage = String(fd.get("whatsappTemplateLanguage") ?? "").trim();
  if (!id) return { error: "Kampanya bulunamadı." };
  if (!title) return { error: "Kampanya başlığı zorunludur." };
  if (message.length > 612) return { error: "Mesaj en fazla 612 karakter olabilir." };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("campaigns")
    .select("id, channel, status")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!current) return { error: "Kampanya bulunamadı." };
  if (current.status !== "draft") return { error: "Yalnız taslak kampanya düzenlenebilir." };

  const patch: Record<string, unknown> = { title, message };
  if (current.channel === "sms") {
    if (!message) return { error: "SMS mesaj metni zorunludur." };
  } else if (current.channel === "whatsapp") {
    if (!WHATSAPP_TEMPLATE_NAME_RE.test(whatsappTemplateName) || !WHATSAPP_TEMPLATE_LANGUAGE_RE.test(whatsappTemplateLanguage)) {
      return { error: "WhatsApp kampanyası için Meta tarafından onaylanmış şablon adı ve geçerli dil kodu zorunludur." };
    }
    patch.whatsapp_template_name = whatsappTemplateName;
    patch.whatsapp_template_language = whatsappTemplateLanguage;
  } else {
    return { error: "Bu kampanya kanalı düzenlenemez." };
  }

  const { data: updated, error } = await supabase
    .from("campaigns")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "draft")
    .select("id");
  if (error) {
    console.error("updateCampaign", error);
    return { error: actionErrorMessage(error, "Kampanya güncellenemedi.") };
  }
  if (!updated || updated.length === 0) return { error: "Kampanya artık taslak değil; düzenlenemedi." };

  revalidatePath("/app/kampanyalar");
  revalidatePath(`/app/kampanyalar/${id}`);
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Kampanya gönder: yalnız kuyruğa alır; provider I/O cron worker'dadır.
// ---------------------------------------------------------------------------

export async function sendCampaign(campaignId: string): Promise<CampaignResult> {
  const gate = await requirePermission("campaigns", "edit");
  if (!gate.ok) return { error: gate.error };

  const admin = createAdminClient();
  const { data: campaign, error: campaignError } = await admin
    .from("campaigns")
    .select("id, status, tenant_id")
    .eq("id", campaignId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (campaignError || !campaign) return { error: "Kampanya bulunamadı." };
  if (campaign.status !== "draft" && campaign.status !== "scheduled") {
    return { error: "Kampanya mevcut durumunda gönderim kuyruğuna alınamaz." };
  }

  const { data: enqueueResult, error: enqueueError } = await admin.rpc(
    "enqueue_campaign_delivery",
    {
      p_campaign_id: campaignId,
      p_tenant_id: gate.tenantId,
    },
  );
  if (enqueueError || !enqueueResult) {
    return { error: actionErrorMessage(enqueueError, "Kampanya gönderim kuyruğuna alınamadı.") };
  }

  revalidatePath("/app/kampanyalar");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Zamanlama: taslak -> zamanlandı (gönderim cron'u `scheduled_at <= now()` olunca kuyruğa alır)
// ---------------------------------------------------------------------------

const SCHEDULE_MAX_DAYS = 90;

/**
 * Taslak kampanyayı ileri bir zamana kurar. Teslimat cron'u (`campaign-delivery`, 2 dk) yalnız
 * `status='scheduled' AND scheduled_at <= now()` olanları alır (claim RPC); yeni cron YOK.
 * Saat Türkiye saatiyle girilir; en az 5 dk sonrası, en çok 90 gün.
 */
export async function scheduleCampaign(campaignId: string, localDateTime: string): Promise<CampaignResult> {
  const gate = await requirePermission("campaigns", "edit");
  if (!gate.ok) return { error: gate.error };
  const at = parseTrLocalDateTime(String(localDateTime ?? "").trim());
  if (!at) return { error: "Geçerli bir tarih ve saat seçin." };
  const nowMs = now();
  if (at.getTime() < nowMs + 5 * 60_000) return { error: "Zamanlama en az 5 dakika sonrası olmalı." };
  if (at.getTime() > nowMs + SCHEDULE_MAX_DAYS * DAY_MS) return { error: `Zamanlama en fazla ${SCHEDULE_MAX_DAYS} gün sonrası olabilir.` };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .update({ status: "scheduled", scheduled_at: at.toISOString(), updated_at: new Date(nowMs).toISOString() })
    .eq("id", campaignId)
    .eq("tenant_id", gate.tenantId)
    .in("status", ["draft", "scheduled"])
    .select("id");
  if (error) {
    console.error("scheduleCampaign", error);
    return { error: "Kampanya zamanlanamadı." };
  }
  if (!data || data.length === 0) return { error: "Yalnız taslak ya da zamanlanmış kampanya zamanlanabilir." };
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "campaign.schedule",
    entityType: "campaign",
    entityId: campaignId,
    newValue: { scheduled_at: at.toISOString() },
  });
  revalidatePath("/app/kampanyalar");
  revalidatePath(`/app/kampanyalar/${campaignId}`);
  return { ok: true, id: campaignId };
}

/** Zamanlamayı kaldırır: kampanya taslağa döner (gönderim başlamadıysa). */
export async function unscheduleCampaign(campaignId: string): Promise<CampaignResult> {
  const gate = await requirePermission("campaigns", "edit");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .update({ status: "draft", scheduled_at: null, updated_at: new Date(now()).toISOString() })
    .eq("id", campaignId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "scheduled")
    .select("id");
  if (error) {
    console.error("unscheduleCampaign", error);
    return { error: actionErrorMessage(error, "Zamanlama kaldırılamadı.") };
  }
  if (!data || data.length === 0) return { error: "Kampanya artık zamanlanmış durumda değil (gönderim başlamış olabilir)." };
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "campaign.unschedule",
    entityType: "campaign",
    entityId: campaignId,
  });
  revalidatePath("/app/kampanyalar");
  revalidatePath(`/app/kampanyalar/${campaignId}`);
  return { ok: true, id: campaignId };
}

// ---------------------------------------------------------------------------
// Kampanyaları listele
// ---------------------------------------------------------------------------

export async function listCampaigns() {
  const gate = await requirePermission("campaigns", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("campaigns")
    .select("id, title, channel, status, total_count, sent_count, failed_count, created_at, sent_at, scheduled_at")
    .eq("tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(50);

  return data ?? [];
}

export async function getCampaign(id: string) {
  const gate = await requirePermission("campaigns", "view");
  if (!gate.ok) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("campaigns")
    .select("id, title, channel, message, whatsapp_template_name, whatsapp_template_language, status, total_count, sent_count, failed_count, scheduled_at, sent_at, created_at, last_error")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  return data;
}

export async function listCampaignRecipients(campaignId: string) {
  const gate = await requirePermission("campaigns", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("campaign_recipients")
    .select("id, customer_id, full_name, phone, status, error_msg, sent_at, created_at")
    .eq("campaign_id", campaignId)
    .order("status", { ascending: true })
    .order("full_name", { ascending: true })
    .limit(500);

  return data ?? [];
}

// ---------------------------------------------------------------------------
// Kampanya sil
// ---------------------------------------------------------------------------

export async function deleteCampaign(id: string): Promise<CampaignResult> {
  const gate = await requirePermission("campaigns", "delete");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("campaigns")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) return { error: actionErrorMessage(error, "Kampanya silinemedi.") };
  revalidatePath("/app/kampanyalar");
  return { ok: true };
}
