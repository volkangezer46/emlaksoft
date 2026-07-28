"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";

/**
 * Referans (tavsiye) programı — panel action'ları (/app/tavsiyeler).
 *
 * YETKİ KARARI:
 *  - Link üretme/aç-kapa da dahil TÜM yazmalar `customers:edit` ister. Link
 *    üretmek "salt görüntüleme" değildir: müşteri adına dışarıya açılan,
 *    tahmin edilemez token'lı bir yazma uç noktası açar ve ofisin ödül vaadini
 *    (reward_note) müşteriye taahhüt eder — bunu view yetkisi olan çağrı
 *    merkezi/raporcu rolüne bırakmak doğru olmaz.
 *  - `convertReferralToCustomer` müşteri kaydı AÇTIĞI için ayrıca
 *    `customers:create` ister (customers.ts createCustomer ile aynı çizgi).
 */

export type ReferralLinkResult = {
  ok?: boolean;
  error?: string;
  id?: string;
  url?: string;
  /** Müşterinin zaten aktif linki vardı — yenisi üretilmedi, mevcut link döndü. */
  existed?: boolean;
};

export type ReferralResult = { ok?: boolean; error?: string };

export type ReferralConvertResult = {
  ok?: boolean;
  error?: string;
  customerId?: string;
  /** Aynı telefonlu müşteri zaten vardı → yeni kayıt açılmadı, mevcuda bağlandı. */
  merged?: boolean;
  message?: string;
};

const STATUSES = ["yeni", "iletisim", "musteri", "kazanildi", "kayip"] as const;
type ReferralStatus = (typeof STATUSES)[number];

function appBase() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Public tavsiye sayfasının tam adresi — panelde kopyalanır (SMS yok, İYS kapsam dışı). */
function referralUrl(token: string) {
  return `${appBase()}/tavsiye/${token}`;
}

/**
 * Müşteriye özel tavsiye linki üretir.
 *
 * Bir müşteriye AKTİF tek link kuralı DB'de (idx_referral_links_active_customer);
 * burada önden kontrol edilip mevcut link döndürülür ki NPS önerisinden gelen
 * tek tık mükerrer üretmeye çalışıp hata göstermesin.
 */
export async function createReferralLink(fd: FormData): Promise<ReferralLinkResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const customerId = String(fd.get("customer_id") ?? "").trim();
  const staffId = String(fd.get("staff_id") ?? "").trim();
  const rewardNote = String(fd.get("reward_note") ?? "").trim().slice(0, 300);
  if (!customerId) return { error: "Tavsiye edecek müşteriyi seçin." };

  const supabase = await createClient();

  // Müşteri bu kiracıya mı ait? (RLS zaten kapatır; net hata mesajı için kontrol)
  const { data: customer } = await supabase
    .from("customers")
    .select("id, full_name")
    .eq("id", customerId)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!customer) return { error: "Müşteri bulunamadı." };

  const { data: existing } = await supabase
    .from("referral_links")
    .select("id, public_token")
    .eq("tenant_id", gate.tenantId)
    .eq("customer_id", customerId)
    .eq("is_active", true)
    .maybeSingle();
  if (existing) {
    return { ok: true, existed: true, id: existing.id, url: referralUrl(existing.public_token) };
  }

  const { data, error } = await supabase
    .from("referral_links")
    .insert({
      tenant_id: gate.tenantId,
      customer_id: customerId,
      staff_id: staffId || null,
      reward_note: rewardNote || null,
      created_by: gate.userId,
    })
    .select("id, public_token")
    .single();

  if (error) {
    console.error("createReferralLink", error);
    return { error: "Tavsiye linki oluşturulamadı. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "referral_link.create",
    entityType: "referral_link",
    entityId: data.id,
    newValue: { customer_id: customerId, staff_id: staffId || null, reward_note: rewardNote || null },
  });

  revalidatePath("/app/tavsiyeler");
  return { ok: true, id: data.id, url: referralUrl(data.public_token) };
}

/** Linki aç/kapat — kapalı linkte public sayfa form göstermez, sayaç artmaz. */
export async function toggleReferralLink(fd: FormData): Promise<ReferralResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  const active = String(fd.get("active") ?? "") === "1";
  if (!id) return { error: "Link bulunamadı." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("referral_links")
    .update({ is_active: active })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    // Aynı müşteriye ikinci aktif link açılmaya çalışıldı (kısmi unique index).
    if (error.code === "23505") {
      return { error: "Bu müşterinin başka bir aktif linki var. Önce onu kapatın." };
    }
    console.error("toggleReferralLink", error);
    return { error: "Link durumu güncellenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: active ? "referral_link.activate" : "referral_link.deactivate",
    entityType: "referral_link",
    entityId: id,
  });

  revalidatePath("/app/tavsiyeler");
  return { ok: true };
}

/** Tavsiye durumunu değiştirir (pill switcher). */
export async function setReferralStatus(fd: FormData): Promise<ReferralResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  const status = String(fd.get("status") ?? "").trim() as ReferralStatus;
  if (!id) return { error: "Tavsiye bulunamadı." };
  if (!STATUSES.includes(status)) return { error: "Geçersiz durum." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("referrals")
    .update({ status, handled_by: gate.userId, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("setReferralStatus", error);
    return { error: "Durum güncellenemedi." };
  }
  if (!data) return { error: "Tavsiye bulunamadı." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "referral.status",
    entityType: "referral",
    entityId: id,
    newValue: { status },
  });

  revalidatePath("/app/tavsiyeler");
  return { ok: true };
}

/** Ofis içi not — public formdan gelen `referred_note` ile karışmasın diye ayrı kolon. */
export async function addReferralNote(fd: FormData): Promise<ReferralResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  const note = String(fd.get("note") ?? "").trim().slice(0, 2000);
  if (!id) return { error: "Tavsiye bulunamadı." };
  if (!note) return { error: "Not boş olamaz." };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("referrals")
    .select("id, staff_note")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!row) return { error: "Tavsiye bulunamadı." };

  // Notlar birikerek saklanır (tarih başlığıyla) — geçmiş kaybolmasın.
  const stamp = new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(),
  );
  const merged = [String(row.staff_note ?? "").trim(), `[${stamp}] ${note}`]
    .filter(Boolean)
    .join("\n")
    .slice(0, 8000);

  const { error } = await supabase
    .from("referrals")
    .update({ staff_note: merged, handled_by: gate.userId, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("addReferralNote", error);
    return { error: "Not eklenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "referral.note",
    entityType: "referral",
    entityId: id,
  });

  revalidatePath("/app/tavsiyeler");
  return { ok: true };
}

/**
 * Tavsiyeyi müşteri kaydına dönüştürür.
 *
 * Aynı telefonlu müşteri zaten varsa YENİ kayıt açılmaz — mevcut müşteriye
 * bağlanır ve bu kullanıcıya açıkça söylenir (mükerrer müşteri üretmeyelim,
 * merge ekranı zaten ayrı bir iş). Yeni kayıtta kaynak `source='referral'`,
 * `lead_source='tavsiye'` ve `lead_source_detail` = tavsiye eden müşterinin adı.
 */
export async function convertReferralToCustomer(fd: FormData): Promise<ReferralConvertResult> {
  const gate = await requirePermission("customers", "create");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  if (!id) return { error: "Tavsiye bulunamadı." };

  const supabase = await createClient();
  const { data: ref } = await supabase
    .from("referrals")
    .select(
      "id, referred_name, referred_phone, referred_note, created_customer_id, link_id, referrer_customer_id, referrer:customers!referrals_referrer_customer_id_fkey(full_name)",
    )
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!ref) return { error: "Tavsiye bulunamadı." };
  if (ref.created_customer_id) return { error: "Bu tavsiye zaten müşteriye dönüştürülmüş." };

  const relRef = ref.referrer as { full_name?: string } | { full_name?: string }[] | null;
  const referrerName =
    (Array.isArray(relRef) ? relRef[0]?.full_name : relRef?.full_name) ?? "Tavsiye eden müşteri";

  // Linkin danışmanı varsayılan sahip; yoksa işlemi yapan üstlenir.
  let assignedTo = gate.userId;
  if (ref.link_id) {
    const { data: link } = await supabase
      .from("referral_links")
      .select("staff_id")
      .eq("id", ref.link_id)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (link?.staff_id) assignedTo = String(link.staff_id);
  }

  const phone = String(ref.referred_phone ?? "").trim();

  // Mükerrer telefon → mevcut müşteriye bağla.
  const { data: dupe } = phone
    ? await supabase
        .from("customers")
        .select("id, full_name")
        .eq("tenant_id", gate.tenantId)
        .eq("phone", phone)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle()
    : { data: null };

  let customerId: string;
  let merged = false;

  if (dupe) {
    customerId = String(dupe.id);
    merged = true;
  } else {
    const noteParts = [
      `Tavsiye eden: ${referrerName}`,
      String(ref.referred_note ?? "").trim(),
    ].filter(Boolean);

    const { data: created, error } = await supabase
      .from("customers")
      .insert({
        tenant_id: gate.tenantId,
        full_name: String(ref.referred_name ?? "").trim() || "Tavsiye edilen kişi",
        phone: phone || null,
        source: "referral",
        lead_source: "tavsiye",
        lead_source_detail: referrerName,
        assigned_to: assignedTo,
        created_by: gate.userId,
        notes: noteParts.join(" · "),
      })
      .select("id")
      .single();

    if (error) {
      console.error("convertReferralToCustomer insert", error);
      return { error: "Müşteri kaydı oluşturulamadı. Lütfen tekrar deneyin." };
    }
    customerId = String(created.id);
  }

  const { error: updErr } = await supabase
    .from("referrals")
    .update({
      created_customer_id: customerId,
      status: "musteri",
      handled_by: gate.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (updErr) {
    console.error("convertReferralToCustomer update", updErr);
    return { error: "Müşteri açıldı ancak tavsiye kaydı güncellenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "referral.convert",
    entityType: "referral",
    entityId: id,
    newValue: { customer_id: customerId, merged },
  });

  revalidatePath("/app/tavsiyeler");
  revalidatePath("/app/musteriler");
  revalidatePath(`/app/musteriler/${customerId}`);

  return {
    ok: true,
    customerId,
    merged,
    message: merged
      ? `Bu telefon zaten kayıtlı: "${dupe?.full_name ?? "mevcut müşteri"}". Yeni kayıt açılmadı, tavsiye mevcut müşteriye bağlandı.`
      : "Müşteri kaydı açıldı ve tavsiyeye bağlandı.",
  };
}
