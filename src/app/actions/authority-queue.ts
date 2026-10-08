"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { now } from "@/lib/clock";
import { isValidTurkishMobile, normalizeTurkishPhone, toWhatsAppLink } from "@/lib/phone";
import { isSignerSmsAvailable, sendSignerSms } from "@/app/imza/_lib/sms";
import { gateIysRecipient, IYS_SKIP_LABELS } from "@/lib/iys/gate";
import { DEMO_BLOCKED } from "@/lib/sample-scope";
import { buildAuthorityReminderText, canSendReminder, isEidsVerifyStatus } from "@/lib/eids/authority-status";

export type AuthorityActionResult = { ok?: boolean; error?: string; waUrl?: string; info?: string };

const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const DOC_NO_MAX = 60;

function revalidate(propertyId: string) {
  revalidatePath("/app/ilan-kontrol/yetki");
  revalidatePath("/app/ilan-kontrol");
  revalidatePath(`/app/portfoyler/${propertyId}`);
}

/**
 * Yetki durumunu günceller: belge no, EİDS doğrulama durumu (bekliyor/onaylandı/reddedildi) ve mal sahibi e-Devlet onayı.
 * Yalnız gönderilen alanlar yazılır. Bu resmi bir EİDS sorgusu değildir; ofis, mal sahibi onayladıkça işaretler.
 */
export async function updateAuthorityStatus(
  propertyId: string,
  patch: { docNo?: string | null; eidsStatus?: string; ownerApproved?: boolean },
): Promise<AuthorityActionResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(propertyId ?? ""))) return { error: "Portföy bulunamadı." };

  const update: Record<string, unknown> = {};
  if (patch.docNo !== undefined) {
    const doc = String(patch.docNo ?? "").trim();
    if (doc.length > DOC_NO_MAX) return { error: `Yetki belgesi numarası en fazla ${DOC_NO_MAX} karakter olabilir.` };
    update.authority_doc_no = doc || null;
  }
  if (patch.eidsStatus !== undefined) {
    if (!isEidsVerifyStatus(patch.eidsStatus)) return { error: "Geçersiz EİDS durumu." };
    update.authority_eids_status = patch.eidsStatus;
    // Onaylandı = mal sahibinin e-Devlet onayı alındı; bekliyor/reddedildi onay izini siler.
    if (patch.ownerApproved === undefined) {
      update.authority_owner_approved_at = patch.eidsStatus === "approved" ? new Date(now()).toISOString() : null;
    }
  }
  if (patch.ownerApproved !== undefined) {
    update.authority_owner_approved_at = patch.ownerApproved ? new Date(now()).toISOString() : null;
    if (patch.ownerApproved && patch.eidsStatus === undefined) update.authority_eids_status = "approved";
  }
  if (Object.keys(update).length === 0) return { error: "Güncellenecek alan yok." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("properties")
    .update(update)
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .select("id");
  if (error) {
    console.error("updateAuthorityStatus", { code: error.code });
    return { error: actionErrorMessage(error, "Yetki durumu güncellenemedi.") };
  }
  if (!data || data.length === 0) return { error: "Portföy bulunamadı ya da güncelleme yetkiniz yok." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.authority_status",
    entityType: "property",
    entityId: propertyId,
    newValue: {
      eids_status: update.authority_eids_status ?? null,
      owner_approved: update.authority_owner_approved_at === undefined ? null : Boolean(update.authority_owner_approved_at),
      doc_no_changed: update.authority_doc_no !== undefined,
    },
  });
  revalidate(propertyId);
  return { ok: true };
}

/**
 * Mal sahibine e-Devlet EİDS onay hatırlatması gönderir. İYS KAPISINDAN GEÇER (merkezi `gateIysRecipient`):
 * izin yoksa/geri alınmışsa gönderilmez, neden söylenir. SMS ofisin kendi sağlayıcısıyla gider; WhatsApp için gönderim
 * yapılmaz, danışmanın kendi hattından açacağı hazır bağlantı üretilir (serbest metin WhatsApp şablon sözleşmesine aykırıdır).
 * Gönderim izi (zaman, adet, kanal) portföyde tutulur; 24 saatte bir kez.
 */
export async function sendAuthorityReminder(propertyId: string, channel: "sms" | "whatsapp"): Promise<AuthorityActionResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(propertyId ?? ""))) return { error: "Portföy bulunamadı." };
  if (channel !== "sms" && channel !== "whatsapp") return { error: "Geçersiz kanal." };

  const supabase = await createClient();
  const { data: p } = await supabase
    .from("properties")
    .select("id, property_code, title, authorization_start, authorization_end, authority_eids_status, authority_reminder_sent_at, authority_reminder_count")
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!p) return { error: "Portföy bulunamadı." };

  const nowMs = now();
  const can = canSendReminder(
    {
      authority_eids_status: p.authority_eids_status ?? null,
      authority_reminder_sent_at: p.authority_reminder_sent_at ?? null,
      authorization_end: p.authorization_end ?? null,
      authorization_start: p.authorization_start ?? null,
    },
    nowMs,
  );
  if (!can.ok) return { error: can.reason ?? "Hatırlatma şu an gönderilemez." };

  const { data: ownerInfo } = await supabase
    .from("property_owner_info")
    .select("customer_id")
    .eq("tenant_id", gate.tenantId)
    .eq("property_id", propertyId)
    .maybeSingle();
  const ownerId = (ownerInfo as { customer_id?: string | null } | null)?.customer_id ?? null;
  if (!ownerId) return { error: "Bu portföyde mal sahibi kaydı yok; önce ilan sahibi bilgisini girin." };

  const { data: owner } = await supabase
    .from("customers")
    .select("id, full_name, phone, is_sample, blacklist")
    .eq("id", ownerId)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!owner) return { error: "Mal sahibi bulunamadı veya görüntüleme yetkiniz yok." };
  if (owner.is_sample) return { error: `Demo kayıt: gerçek gönderim engellendi (${DEMO_BLOCKED}).` };
  if (owner.blacklist) return { error: "Mal sahibi kara listede; mesaj gönderilmez." };
  const phone = normalizeTurkishPhone(owner.phone ?? "");
  if (!owner.phone || !isValidTurkishMobile(phone)) return { error: "Mal sahibinin geçerli bir cep telefonu yok." };

  // Merkezi İYS kapısı: izinsiz alıcıya hatırlatma gitmez.
  const iys = await gateIysRecipient(supabase, { tenantId: gate.tenantId, kind: "authority_reminder", channel, customerId: ownerId });
  if (!iys.allowed) {
    return { error: `İYS izni yok (${IYS_SKIP_LABELS[iys.reason ?? "no_record"]}); mesaj gönderilmedi. Uyum sayfasından ${channel === "sms" ? "SMS" : "WhatsApp"} iznini kaydedin.` };
  }

  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", gate.tenantId).maybeSingle();
  const label = [p.property_code, p.title].filter(Boolean).join(" ") || "portföyünüz";
  const text = buildAuthorityReminderText({
    ownerName: owner.full_name,
    office: (tenant as { name?: string } | null)?.name ?? null,
    propertyLabel: label,
    endDate: p.authorization_end,
  });

  let waUrl: string | undefined;
  if (channel === "sms") {
    if (!(await isSignerSmsAvailable(gate.tenantId, owner.phone))) {
      return { error: "SMS yapılandırması yok — Ayarlar → Entegrasyonlar bölümünden Netgsm bilgilerinizi girin." };
    }
    const res = await sendSignerSms(gate.tenantId, owner.phone, text);
    if (!res.ok) {
      if (res.code === "50" || res.code === "51") return { error: "SMS kredisi yetersiz — Netgsm bakiyenizi kontrol edin." };
      return { error: res.error ?? "SMS gönderilemedi; birkaç dakika sonra tekrar deneyin." };
    }
  } else {
    waUrl = toWhatsAppLink(owner.phone, text) ?? undefined;
    if (!waUrl) return { error: "WhatsApp bağlantısı üretilemedi." };
  }

  const nowIso = new Date(nowMs).toISOString();
  const { error: upErr } = await supabase
    .from("properties")
    .update({
      authority_reminder_sent_at: nowIso,
      authority_reminder_count: (p.authority_reminder_count ?? 0) + 1,
      authority_reminder_channel: channel,
    })
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId);
  if (upErr) console.error("sendAuthorityReminder: iz yazılamadı", { code: upErr.code });

  // Zaman tüneli kaydı (best-effort; gönderimi geri almaz).
  await supabase.from("communications").insert({
    tenant_id: gate.tenantId,
    customer_id: ownerId,
    property_id: propertyId,
    created_by: gate.userId,
    channel,
    direction: "outbound",
    subject: "Yetki onayı hatırlatması",
    body: text,
  });

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.authority_reminder",
    entityType: "property",
    entityId: propertyId,
    newValue: { channel, via: channel === "sms" ? "sms" : "wa_link" },
  });
  revalidate(propertyId);
  revalidatePath(`/app/musteriler/${ownerId}`);
  return {
    ok: true,
    waUrl,
    info: channel === "sms" ? "Hatırlatma SMS'i gönderildi." : "WhatsApp mesajı hazır; bağlantıyı açıp gönderin.",
  };
}
