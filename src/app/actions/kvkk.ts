"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";

export type KvkkResult = { ok?: boolean; error?: string; ref?: string };

/**
 * KVKK silme (unutulma) talebi.
 *
 * ============================================================================
 * NEDEN "SİLME" DEĞİL "ANONİMLEŞTİRME"
 * ============================================================================
 * Gerçek `DELETE` zaten mümkün değil: `deals` ve `calls` tablolarının
 * `customer_id` yabancı anahtarında `ON DELETE` yok, yani kısıtlayıcı. Bir
 * müşterinin tek bir çağrı kaydı varsa silme hata verir. Bu doğru davranış —
 * ticari kayıtlar TTK gereği saklanmak zorunda.
 *
 * Anonimleştirme satır iskeletini ve finansal bağı korurken kişiyi işaret
 * eden alanları maskeliyor. Denormalize kopyalar (`campaign_recipients`,
 * `open_house_visitors`) dahil — atlanırsa kişi oradan hâlâ bulunabilir.
 *
 * ============================================================================
 * YETKİ
 * ============================================================================
 * `customers.delete` izni isteniyor: bu geri alınamaz bir işlem ve bir
 * danışmanın kendi başına yapabileceği bir şey olmamalı. Kiracı kimliği SQL
 * fonksiyonu içinde `current_tenant_id()` ile çözülüyor — parametreden
 * alınmıyor.
 */
export async function requestCustomerErasure(formData: FormData): Promise<KvkkResult> {
  const gate = await requirePermission("customers", "delete");
  if (!gate.ok) return { error: gate.error };

  const customerId = String(formData.get("customer_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!customerId) return { error: "Müşteri seçilmedi." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("anonymize_customer", {
    p_customer_id: customerId,
    p_reason: reason || null,
  });

  if (error) {
    // Fonksiyon `raise exception` ile anlamlı mesaj döndürüyor ("bu ofise ait
    // değil", "daha önce anonimleştirilmiş"); kullanıcıya onu gösteriyoruz.
    return { error: error.message || "Anonimleştirme yapılamadı." };
  }

  const sonuc = (data ?? {}) as { ok?: boolean; ref?: string };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "kvkk.erasure",
    entityType: "customer",
    entityId: customerId,
    // Kişisel veri denetim loguna yazılmıyor — yalnızca maskeli referans.
    newValue: { ref: sonuc.ref ?? null, reason: reason || null },
  });

  revalidatePath("/app/uyum");
  revalidatePath("/app/musteriler");
  revalidatePath(`/app/musteriler/${customerId}`);
  return { ok: true, ref: sonuc.ref };
}

/**
 * Saklama süresi dolan soft-delete kayıtlarını anonimleştirir.
 *
 * `deleted_at` işaretli müşteriler hiç temizlenmiyordu — adı, telefonu ve
 * e-postası veritabanında süresiz duruyordu.
 */
export async function purgeStaleCustomers(formData: FormData): Promise<KvkkResult & { count?: number }> {
  const gate = await requirePermission("customers", "delete");
  if (!gate.ok) return { error: gate.error };

  const gunRaw = String(formData.get("days") ?? "").trim();
  const gun = gunRaw ? Number(gunRaw) : 1095;
  if (!Number.isFinite(gun) || gun < 30) {
    // 30 günün altı kaza riski: yeni silinmiş bir kaydı geri almak imkânsız hâle gelir.
    return { error: "Saklama süresi en az 30 gün olmalı." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("purge_stale_customers", { p_days: Math.round(gun) });
  if (error) return { error: error.message || "Temizlik çalıştırılamadı." };

  const adet = Number(data ?? 0);
  if (adet > 0) {
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "kvkk.purge",
      entityType: "customer",
      entityId: null,
      newValue: { count: adet, days: Math.round(gun) },
    });
  }

  revalidatePath("/app/uyum");
  return { ok: true, count: adet };
}

/** Silme kanıtı kayıtları — denetimde gösterilecek liste. */
export async function listErasureLog(limit = 100) {
  const gate = await requirePermission("compliance", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("kvkk_erasure_log")
    .select("id, customer_ref, reason, affected, performed_at")
    .order("performed_at", { ascending: false })
    .limit(limit);

  return data ?? [];
}
