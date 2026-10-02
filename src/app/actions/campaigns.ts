"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  listApprovedTenantWhatsAppTemplates,
  type ApprovedWhatsAppTemplate,
} from "@/lib/messaging/whatsapp-cloud";

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
  if (!campaignId) return { error: "Kampanya oluşturma sonucu doğrulanamadı." };

  revalidatePath("/app/kampanyalar");
  return { ok: true, id: campaignId };
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
    return { error: "Kampanya gönderim kuyruğuna alınamadı." };
  }

  revalidatePath("/app/kampanyalar");
  return { ok: true };
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
    .select("id, title, channel, status, total_count, sent_count, failed_count, created_at, sent_at")
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
    .select("id, title, channel, message, whatsapp_template_name, whatsapp_template_language, status, total_count, sent_count, failed_count, scheduled_at, sent_at, created_at")
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

  if (error) return { error: "Kampanya silinemedi." };
  revalidatePath("/app/kampanyalar");
  return { ok: true };
}
