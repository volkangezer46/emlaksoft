"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { normalizeTurkishPhone, isValidTurkishMobile } from "@/lib/phone";
import { logActivity } from "@/lib/activity";
import { isSignerSmsAvailable, sendSignerSms } from "@/app/imza/_lib/sms";

export type CommResult = { ok?: boolean; error?: string; id?: string };

// ---------------------------------------------------------------------------
// İletişim kaydı oluştur
// ---------------------------------------------------------------------------

export async function createCommunication(
  _prev: CommResult,
  fd: FormData,
): Promise<CommResult> {
  const gate = await requirePermission("customers", "create");
  if (!gate.ok) return { error: gate.error };

  const customerId  = String(fd.get("customer_id")  ?? "").trim() || null;
  const propertyId  = String(fd.get("property_id")  ?? "").trim() || null;
  const channel     = String(fd.get("channel")      ?? "note").trim();
  const direction   = String(fd.get("direction")    ?? "outbound").trim();
  const subject     = String(fd.get("subject")      ?? "").trim() || null;
  const body        = String(fd.get("body")         ?? "").trim() || null;
  const outcome     = String(fd.get("outcome")      ?? "").trim() || null;
  const durationSec = parseInt(String(fd.get("duration_sec") ?? "0")) || null;
  const scheduledAt = String(fd.get("scheduled_at") ?? "").trim() || null;

  if (!customerId && !propertyId) return { error: "Müşteri veya portföy bağlantısı gerekli." };
  if (!body && !subject)          return { error: "Mesaj içeriği veya konu boş olamaz." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("communications")
    .insert({
      tenant_id:    gate.tenantId,
      customer_id:  customerId,
      property_id:  propertyId,
      created_by:   gate.userId,
      channel,
      direction,
      subject,
      body,
      outcome,
      duration_sec: durationSec,
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "İletişim kaydı oluşturulamadı." };

  if (customerId) revalidatePath(`/app/musteriler/${customerId}`);
  if (propertyId) revalidatePath(`/app/portfoyler/${propertyId}`);
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------------
// Müşterinin iletişim geçmişini getir
// ---------------------------------------------------------------------------

export async function listCustomerCommunications(customerId: string) {
  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("communications")
    .select("id, channel, direction, subject, body, outcome, duration_sec, scheduled_at, created_at, created_by:profiles(full_name)")
    .eq("customer_id", customerId)
    .eq("tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(100);

  return data ?? [];
}

// ---------------------------------------------------------------------------
// Portföyün iletişim geçmişini getir
// ---------------------------------------------------------------------------

export async function listPropertyCommunications(propertyId: string) {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("communications")
    .select("id, channel, direction, subject, body, outcome, duration_sec, scheduled_at, created_at, created_by:profiles(full_name), customer:customers(full_name)")
    .eq("property_id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(50);

  return data ?? [];
}

// ---------------------------------------------------------------------------
// İletişim kaydı sil
// ---------------------------------------------------------------------------

export async function deleteCommunication(id: string, customerId?: string): Promise<CommResult> {
  const gate = await requirePermission("customers", "delete");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  await supabase
    .from("communications")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (customerId) revalidatePath(`/app/musteriler/${customerId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tekil SMS gönder (müşteri 360 + gelen kutusu "Yanıtla")
// ---------------------------------------------------------------------------

/**
 * Tek müşteriye birebir SMS gönderir (kampanya değil).
 *
 * İYS UYUMU ZORUNLU: iys_consents tablosunda bu müşteri için channel='sms' ve
 * status='granted' kaydı yoksa gönderim yapılmaz (ETK/İYS gereği pazarlama
 * SMS'i ancak kayıtlı onayla atılabilir). Onay /app/uyum sayfasından girilir.
 *
 * Gönderim yolu: sendSignerSms (imza akışıyla ortak) — tenant_integrations'taki
 * aktif Netgsm kaydı öncelikli, yoksa platform varsayılanı (kampanyaların
 * kullandığı sendSms ile aynı yardımcı).
 */
export async function sendCustomerSms(customerId: string, message: string): Promise<CommResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const text = String(message ?? "").trim();
  if (!text) return { error: "Mesaj boş olamaz." };
  if (text.length > 460) return { error: "Mesaj en fazla 460 karakter olabilir." };

  const supabase = await createClient();
  const { data: customer } = await supabase
    .from("customers")
    .select("id, full_name, phone")
    .eq("id", customerId)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!customer) return { error: "Müşteri bulunamadı." };

  const phone = normalizeTurkishPhone(customer.phone ?? "");
  if (!customer.phone || !isValidTurkishMobile(phone)) {
    return { error: "Müşterinin geçerli bir cep telefonu numarası yok." };
  }

  // --- İYS onay kontrolü (zorunlu) ---
  const { data: consent } = await supabase
    .from("iys_consents")
    .select("status")
    .eq("tenant_id", gate.tenantId)
    .eq("customer_id", customerId)
    .eq("channel", "sms")
    .maybeSingle();
  if (consent?.status !== "granted") {
    return { error: "İYS onayı yok — Uyum sayfasından (/app/uyum) SMS iznini kaydedin." };
  }

  // Tenant provider is primary; platform fallback requires an explicit policy.
  const hasConfig = await isSignerSmsAvailable(gate.tenantId, customer.phone);
  if (!hasConfig) {
    return { error: "SMS yapılandırması yok — Ayarlar → Entegrasyonlar bölümünden Netgsm bilgilerinizi girin." };
  }

  const result = await sendSignerSms(gate.tenantId, customer.phone, text);
  if (!result.ok) {
    if (result.code === "50" || result.code === "51") {
      return { error: "SMS kredisi yetersiz — Netgsm bakiyenizi kontrol edin." };
    }
    return { error: result.error ?? "SMS gönderilemedi." };
  }

  // Başarılı gönderim → iletişim kaydı (zaman tüneli + gelen kutusu akışı)
  const { data: comm } = await supabase
    .from("communications")
    .insert({
      tenant_id:   gate.tenantId,
      customer_id: customerId,
      created_by:  gate.userId,
      channel:     "sms",
      direction:   "outbound",
      subject:     "SMS",
      body:        text,
    })
    .select("id")
    .single();

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "sms.send",
    entityType: "customer",
    entityId: customerId,
    newValue: { length: text.length, jobid: result.jobid ?? null },
  });

  revalidatePath(`/app/musteriler/${customerId}`);
  revalidatePath("/app/gelen-kutusu");
  return { ok: true, id: comm?.id };
}
