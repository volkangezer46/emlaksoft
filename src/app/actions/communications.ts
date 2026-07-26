"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { normalizeTurkishPhone, formatTurkishPhone, isValidTurkishMobile } from "@/lib/phone";
import { notifyTenant } from "@/lib/notify";
import { logActivity } from "@/lib/activity";
import { getNetgsmConfig } from "@/lib/messaging/netgsm";
// Tenant öncelikli Netgsm gönderimi — imza akışıyla AYNI yardımcı (yeniden yazılmadı):
// tenant_integrations kaydı varsa onunla, yoksa platform varsayılanıyla gönderir.
import { getTenantNetgsmConfig, sendSignerSms } from "@/app/imza/_lib/sms";

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

  // --- Yapılandırma ön kontrolü: tenant Netgsm kaydı VEYA platform varsayılanı ---
  const hasConfig =
    (await getTenantNetgsmConfig(gate.tenantId)) !== null ||
    (await getNetgsmConfig()) !== null;
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

// ---------------------------------------------------------------------------
// Gelen SMS ingest (webhook → service role)
// ---------------------------------------------------------------------------

export type IngestInboundSmsPayload = {
  /**
   * Webhook secret'ı (env NETGSM_WEBHOOK_SECRET) buraya da geçirilir ve
   * fonksiyonun İÇİNDE doğrulanır. Neden: bu dosya `"use server"` taşıyor —
   * export edilen her fonksiyon tarayıcıdan çağrılabilen bir uç nokta olur
   * (bkz. lib/notify.ts'deki notifyTenant taşınma gerekçesi). Secret şartı
   * olmadan herkes istediği kiracıya sahte SMS kaydı + bildirim yazdırabilirdi.
   */
  secret: string;
  /** Gönderen numara (müşteri) — her format kabul, içeride normalize edilir. */
  from: string;
  /** Alıcı numara / mesaj başlığı — bugün tenant eşlemede kullanılamıyor, log için tutulur. */
  to?: string;
  message: string;
};

export type IngestResult = {
  ok: boolean;
  /** true → kayıt bilinçli olarak yazılmadı (tenant çözülemedi vb.) */
  skipped?: boolean;
  reason?: string;
  id?: string;
};

/**
 * Netgsm (ve ileride diğer sağlayıcılar) üzerinden gelen SMS'i communications
 * tablosuna işler.
 *
 * TENANT ÇÖZÜMLEME KARARI:
 * Netgsm inbound payload'ında hangi ofise (tenant) ait olduğunu söyleyen bir
 * alan yok — tek elimizdeki gönderen telefon numarası. Bu yüzden:
 *   1. Yalnızca aktif Netgsm kaydı olan tenant'lar aday alınır
 *      (tenant_integrations.provider='netgsm', is_active) — SMS ancak
 *      Netgsm'i bağlamış bir ofise gelmiş olabilir.
 *   2. Bu adaylar içinde müşteri telefonu eşleşmesi aranır.
 *   3. Birden çok tenant'ta aynı numara varsa: kayıt yalnızca İLK eşleşen
 *      tenant'a (en eski müşteri kaydı) yazılır ve gövdeye belirsizlik notu
 *      eklenir — aynı SMS'i N ofise kopyalamak yanlış ofislere veri sızdırır.
 *   4. Hiç eşleşme yoksa kayıt ATLANIR ve loglanır: kiracısı belirsiz bir
 *      satırı "tahmini" bir tenant'a yazmak, hiç yazmamaktan daha kötüdür
 *      (yanlış ofisin gelen kutusunda yabancı bir numara belirir).
 */
export async function ingestInboundSms(payload: IngestInboundSmsPayload): Promise<IngestResult> {
  const secret = process.env.NETGSM_WEBHOOK_SECRET;
  if (!secret || payload.secret !== secret) {
    return { ok: false, skipped: true, reason: "unauthorized" };
  }

  const phone = normalizeTurkishPhone(payload.from);
  const message = String(payload.message ?? "").trim().slice(0, 2000);
  if (!isValidTurkishMobile(phone) || !message) {
    console.warn("[gelen-sms] atlandı: geçersiz numara/boş mesaj", { from: payload.from });
    return { ok: true, skipped: true, reason: "invalid_payload" };
  }

  const admin = createAdminClient();

  // 1) Netgsm bağlı tenant adayları
  const { data: integrations } = await admin
    .from("tenant_integrations")
    .select("tenant_id")
    .eq("provider", "netgsm")
    .eq("is_active", true);
  const tenantIds = [...new Set((integrations ?? []).map((r) => String(r.tenant_id)))];
  if (tenantIds.length === 0) {
    console.warn("[gelen-sms] atlandı: aktif Netgsm entegrasyonu olan tenant yok", { phone });
    return { ok: true, skipped: true, reason: "no_netgsm_tenant" };
  }

  // 2) Aday tenant'larda telefon eşleşmesi — en eski kayıt önce (deterministik "ilk")
  const { data: matches } = await admin
    .from("customers")
    .select("id, tenant_id, full_name, assigned_to, created_at")
    .eq("phone", phone)
    .is("deleted_at", null)
    .in("tenant_id", tenantIds)
    .order("created_at", { ascending: true })
    .limit(10);

  const customer = (matches ?? [])[0];
  if (!customer) {
    // 4) Tenant çözülemedi → yazma, logla (yukarıdaki karar bloğuna bakın)
    console.warn("[gelen-sms] atlandı: telefon hiçbir Netgsm'li tenant müşterisiyle eşleşmedi", {
      phone: formatTurkishPhone(phone),
      to: payload.to ?? null,
    });
    return { ok: true, skipped: true, reason: "no_customer_match" };
  }

  const otherTenants = new Set(
    (matches ?? []).map((m) => String(m.tenant_id)).filter((t) => t !== String(customer.tenant_id)),
  );
  const ambiguityNote = otherTenants.size > 0
    ? `\n\n[Sistem] Bu numara ${otherTenants.size + 1} farklı ofiste kayıtlı; mesaj ilk eşleşen ofise yazıldı.`
    : "";

  const { data: comm, error } = await admin
    .from("communications")
    .insert({
      tenant_id:   customer.tenant_id,
      customer_id: customer.id,
      created_by:  null, // sistem kaydı — bir kullanıcı oluşturmadı
      channel:     "sms",
      direction:   "inbound",
      subject:     "Gelen SMS",
      body:        message + ambiguityNote,
    })
    .select("id")
    .single();

  if (error || !comm) {
    console.error("[gelen-sms] communications insert hatası", error?.message);
    return { ok: false, reason: "insert_failed" };
  }

  // 3) Bildirim — danışmanı varsa ona (push dahil), yoksa tüm ofise
  await notifyTenant({
    tenantId: String(customer.tenant_id),
    userId: (customer.assigned_to as string | null) ?? null,
    title: `Yeni SMS: ${customer.full_name || formatTurkishPhone(phone)}`,
    body: message.slice(0, 120),
    href: `/app/musteriler/${customer.id}`,
    kind: "info",
  });

  return { ok: true, id: comm.id };
}
