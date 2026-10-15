"use server";

import { SMS_MAX_SEGMENTS, smsSegments } from "@/lib/messaging/sms-segments";
import { closeCallPriorityAfterContact } from "@/lib/insights/close-on-contact";
import { revalidatePath } from "next/cache";
import { now, parseTrLocalDateTime } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { normalizeTurkishPhone, isValidTurkishMobile } from "@/lib/phone";
import { logActivity } from "@/lib/activity";
import { isSignerSmsAvailable, sendSignerSms } from "@/app/imza/_lib/sms";
import { actionErrorMessage } from "@/lib/action-errors";
import { gateIysRecipient, IYS_SKIP_LABELS } from "@/lib/iys/gate";

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
      scheduled_at: scheduledAt ? (parseTrLocalDateTime(scheduledAt)?.toISOString() ?? null) : null,
    })
    .select("id")
    .single();

  if (error || !data) return { error: actionErrorMessage(error, "İletişim kaydı oluşturulamadı.") };

  // İletişim kaydı girildi: müşterinin açık "Bugün ara" kartı anında kapanır.
  closeCallPriorityAfterContact(customerId);

  if (customerId) revalidatePath(`/app/musteriler/${customerId}`);
  if (propertyId) revalidatePath(`/app/portfoyler/${propertyId}`);
  return { ok: true, id: data.id };
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
// Eşleşmemiş çağrı / iletişim kaydını müşteriye bağla (gelen kutusu + çağrı kaydı)
// ---------------------------------------------------------------------------

/**
 * Müşterisiz (eşleşmemiş) çağrı ya da iletişim kaydını mevcut bir müşteriye bağlar.
 * Yalnız `customer_id` boş kayıtlar bağlanır (başka müşteriye ait kayıt devri bu action değildir).
 * Çağrı için `calls:edit`, iletişim kaydı için `customers:edit` gerekir; müşteri aynı ofiste olmalı.
 */
export async function linkRecordToCustomer(
  kind: "call" | "comm",
  recordId: string,
  customerId: string,
): Promise<CommResult> {
  const gate = kind === "call"
    ? await requirePermission("calls", "edit")
    : await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const recId = String(recordId ?? "").trim();
  const custId = String(customerId ?? "").trim();
  if (!recId || !custId) return { error: "Kayıt ve müşteri seçilmeli." };

  const supabase = await createClient();
  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("id", custId)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!customer) return { error: "Müşteri bulunamadı." };

  const { data, error } = await supabase
    .from(kind === "call" ? "calls" : "communications")
    .update({ customer_id: custId })
    .eq("id", recId)
    .eq("tenant_id", gate.tenantId)
    .is("customer_id", null)
    .select("id");
  if (error) {
    console.error("linkRecordToCustomer", error);
    return { error: actionErrorMessage(error, "Kayıt müşteriye bağlanamadı.") };
  }
  if (!data || data.length === 0) return { error: "Kayıt zaten bir müşteriye bağlı ya da bulunamadı." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: kind === "call" ? "call.link_customer" : "communication.link_customer",
    entityType: kind === "call" ? "call" : "communication",
    entityId: recId,
    newValue: { customer_id: custId },
  });

  revalidatePath("/app/gelen-kutusu");
  revalidatePath("/app/gelen-kutusu");
  revalidatePath(`/app/musteriler/${custId}`);
  return { ok: true, id: recId };
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
  const parts = smsSegments(text);
  if (parts > SMS_MAX_SEGMENTS) {
    return { error: `Mesaj ${parts} SMS boyunda; en fazla ${SMS_MAX_SEGMENTS} SMS olabilir (emoji gibi özel karakterler boyu kısaltır).` };
  }

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
  // Merkezi İYS kapısı (src/lib/iys/gate.ts): kanal bazlı izin + geri alınmış izin kontrolü.
  const iys = await gateIysRecipient(supabase, {
    tenantId: gate.tenantId,
    kind: "marketing_single",
    channel: "sms",
    customerId,
  });
  if (!iys.allowed) {
    return { error: `İYS onayı yok (${IYS_SKIP_LABELS[iys.reason ?? "no_record"]}) — Uyum sayfasından (/app/uyum) SMS iznini kaydedin.` };
  }

  // Tenant provider is primary; platform fallback requires an explicit policy.
  const hasConfig = await isSignerSmsAvailable(gate.tenantId, customer.phone);
  if (!hasConfig) {
    return { error: "SMS yapılandırması yok — Ayarlar → Entegrasyonlar bölümünden Netgsm bilgilerinizi girin." };
  }

  const result = await sendSignerSms(gate.tenantId, customer.phone, text, { source: "manual_sms", audience: "contact" });
  if (!result.ok) {
    if (result.code === "50" || result.code === "51") {
      return { error: "SMS kredisi yetersiz — Netgsm bakiyenizi kontrol edin." };
    }
    return { error: result.error ?? actionErrorMessage(null, "SMS gönderilemedi.") };
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

  // Başarılı SMS = iletişim: açık "Bugün ara" kartı anında kapanır.
  if (comm) closeCallPriorityAfterContact(customerId);

  revalidatePath(`/app/musteriler/${customerId}`);
  revalidatePath("/app/gelen-kutusu");
  return { ok: true, id: comm?.id };
}

// ---------------------------------------------------------------------------
// Gelen kutusu konuşmaları: "Tamamlandı" / "Yeniden aç" (COM-01)
// ---------------------------------------------------------------------------

const CONTACT_KEY_RE = /^(c:[0-9a-f-]{36}|t:\d{7,10})$/i;

/**
 * Bir kişinin (müşteri `c:<id>` ya da eşleşmemiş numara `t:<son 10 hane>`) yanıt bekleyen gelen kayıtlarını "tamamlandı"
 * işaretler ya da işareti kaldırır. Kapsam: gelen WhatsApp/SMS/e-posta mesajları ve cevapsız aramalar. Giden yanıt
 * konuşmayı zaten kendiliğinden kapatır (`inbox_conversations`); bu eylem yanıt gerekmeyen ("teşekkürler") durumlar içindir.
 */
export async function setConversationResolved(contactKey: string, resolved: boolean): Promise<CommResult> {
  const gate = await requirePermission("calls", "edit");
  if (!gate.ok) return { error: gate.error };
  const key = String(contactKey ?? "").trim();
  if (!CONTACT_KEY_RE.test(key)) return { error: "Konuşma bulunamadı." };

  const supabase = await createClient();
  const stamp = resolved
    ? { resolved_at: new Date(now()).toISOString(), resolved_by: gate.userId }
    : { resolved_at: null, resolved_by: null };
  const isCustomer = key.startsWith("c:");
  const value = key.slice(2);

  let comms = supabase
    .from("communications")
    .update(stamp)
    .eq("tenant_id", gate.tenantId)
    .eq("direction", "inbound")
    .in("channel", ["whatsapp", "sms", "email"]);
  let calls = supabase
    .from("calls")
    .update(stamp)
    .eq("tenant_id", gate.tenantId)
    .eq("direction", "missed");
  if (isCustomer) {
    comms = comms.eq("customer_id", value);
    calls = calls.eq("customer_id", value);
  } else {
    comms = comms.is("customer_id", null).ilike("contact_address", `%${value}`);
    calls = calls.is("customer_id", null).ilike("phone", `%${value}`);
  }
  comms = resolved ? comms.is("resolved_at", null) : comms.not("resolved_at", "is", null);
  calls = resolved ? calls.is("resolved_at", null) : calls.not("resolved_at", "is", null);

  const [commRes, callRes] = await Promise.all([comms, calls]);
  const error = commRes.error ?? callRes.error;
  if (error) {
    if (error.code === "42703" || error.code === "PGRST204") {
      return { error: "Konuşma durumu için veritabanı güncellemesi bekleniyor." };
    }
    return { error: actionErrorMessage(error, "Konuşma güncellenemedi.") };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: resolved ? "inbox.resolve" : "inbox.reopen",
    entityType: isCustomer ? "customer" : "inbox_contact",
    entityId: isCustomer ? value : undefined,
    newValue: isCustomer ? undefined : { contact: `***${value.slice(-2)}` },
  });
  revalidatePath("/app/gelen-kutusu");
  return { ok: true };
}
