"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { sendBulkSms, sendWhatsApp } from "@/lib/messaging/netgsm";

export type CampaignResult = { ok?: boolean; error?: string; id?: string };

// ---------------------------------------------------------------------------
// Kampanya oluştur
// ---------------------------------------------------------------------------

export async function createCampaign(
  _prev: CampaignResult,
  fd: FormData,
): Promise<CampaignResult> {
  const gate = await requirePermission("customers", "create");
  if (!gate.ok) return { error: gate.error };

  const title    = String(fd.get("title")   ?? "").trim();
  const channel  = String(fd.get("channel") ?? "sms").trim() as "sms" | "whatsapp" | "email";
  const message  = String(fd.get("message") ?? "").trim();
  const filter   = String(fd.get("filter")  ?? "all").trim(); // all | type:alici | type:satici

  if (!title)   return { error: "Kampanya başlığı zorunludur." };
  if (!message) return { error: "Mesaj metni zorunludur." };
  if (message.length > 612) return { error: "Mesaj en fazla 612 karakter olabilir." };

  const supabase = await createClient();
  const admin    = createAdminClient();

  // Alıcı listesini hesapla
  let query = supabase
    .from("customers")
    .select("id, full_name, phone")
    .eq("tenant_id", gate.tenantId)
    .not("phone", "is", null)
    .eq("blacklist", false);

  if (filter.startsWith("type:")) {
    query = query.contains("customer_types", [filter.slice(5)]);
  }

  const { data: customers, error: custErr } = await query;
  if (custErr) return { error: "Müşteriler yüklenemedi." };
  if (!customers?.length) return { error: "Seçilen filtreye uygun telefon numarası bulunamadı." };

  // Kampanyayı oluştur
  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .insert({
      tenant_id:   gate.tenantId,
      created_by:  gate.userId,
      title,
      channel,
      message,
      status:      "draft",
      total_count: customers.length,
    })
    .select("id")
    .single();

  if (campErr || !campaign) return { error: "Kampanya oluşturulamadı." };

  // Alıcıları ekle
  const recipients = customers.map((c) => ({
    campaign_id: campaign.id,
    customer_id: c.id,
    phone:       c.phone as string,
    full_name:   c.full_name,
    status:      "pending" as const,
  }));

  await admin.from("campaign_recipients").insert(recipients);

  revalidatePath("/app/kampanyalar");
  return { ok: true, id: campaign.id };
}

// ---------------------------------------------------------------------------
// Kampanya gönder (async — kuyruğu işler)
// ---------------------------------------------------------------------------

export async function sendCampaign(campaignId: string): Promise<CampaignResult> {
  const gate = await requirePermission("customers", "create");
  if (!gate.ok) return { error: gate.error };

  const admin = createAdminClient();

  // Kampanya bilgilerini al
  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, channel, message, status, tenant_id")
    .eq("id", campaignId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!campaign) return { error: "Kampanya bulunamadı." };
  if (campaign.status === "sending" || campaign.status === "done") {
    return { error: "Kampanya zaten gönderildi veya gönderiliyor." };
  }

  // Durumu güncelle
  await admin
    .from("campaigns")
    .update({ status: "sending" })
    .eq("id", campaignId);

  // Bekleyen alıcıları çek
  const { data: pending } = await admin
    .from("campaign_recipients")
    .select("id, phone, full_name")
    .eq("campaign_id", campaignId)
    .eq("status", "pending");

  if (!pending?.length) {
    await admin.from("campaigns").update({ status: "done", sent_at: new Date().toISOString() }).eq("id", campaignId);
    return { ok: true };
  }

  let sentCount = 0;
  let failCount = 0;

  if (campaign.channel === "sms") {
    // Toplu SMS
    const result = await sendBulkSms(
      pending.map((r) => ({ phone: r.phone, name: r.full_name ?? undefined })),
      campaign.message,
    );

    if (result.ok) {
      await admin.from("campaign_recipients")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("campaign_id", campaignId)
        .eq("status", "pending");
      sentCount = pending.length;
    } else {
      await admin.from("campaign_recipients")
        .update({ status: "failed", error_msg: result.error ?? "Gönderim hatası" })
        .eq("campaign_id", campaignId)
        .eq("status", "pending");
      failCount = pending.length;
    }
  } else if (campaign.channel === "email") {
    // E-posta kanalı — gönderim sağlayıcısı (SMTP/Resend) yapılandırıldığında aktifleşir
    await admin.from("campaign_recipients")
      .update({ status: "failed", error_msg: "E-posta sağlayıcısı yapılandırılmamış. Yönetici ayarlardan ekleyince aktifleşir." })
      .eq("campaign_id", campaignId)
      .eq("status", "pending");
    failCount = pending.length;
  } else {
    // WhatsApp — tek tek gönder (rate limit nedeniyle)
    for (const r of pending) {
      const res = await sendWhatsApp(r.phone, campaign.message);
      if (res.ok) {
        await admin.from("campaign_recipients")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", r.id);
        sentCount++;
      } else {
        await admin.from("campaign_recipients")
          .update({ status: "failed", error_msg: res.error ?? "Hata" })
          .eq("id", r.id);
        failCount++;
      }
    }
  }

  await admin.from("campaigns").update({
    status:       failCount === pending.length ? "failed" : "done",
    sent_at:      new Date().toISOString(),
    sent_count:   sentCount,
    failed_count: failCount,
  }).eq("id", campaignId);

  revalidatePath("/app/kampanyalar");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Kampanyaları listele
// ---------------------------------------------------------------------------

export async function listCampaigns() {
  const gate = await requirePermission("customers", "view");
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

// ---------------------------------------------------------------------------
// Kampanya sil
// ---------------------------------------------------------------------------

export async function deleteCampaign(id: string): Promise<CampaignResult> {
  const gate = await requirePermission("customers", "delete");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  await supabase
    .from("campaigns")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  revalidatePath("/app/kampanyalar");
  return { ok: true };
}
