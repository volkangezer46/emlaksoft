"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { effectiveHasPermission, getEffectivePermissions } from "@/lib/permissions-effective";
import type { AppAction, AppModule } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { insertSampleRecords, SAMPLE_DATA_COUNTS } from "@/lib/sample-data-seed";

export type SampleDataResult = { error?: string; ok?: boolean };

const SAMPLE_DATA_MODULES = [
  "customers",
  "properties",
  "demands",
  "tasks",
  "appointments",
  "commissions",
] as const satisfies readonly AppModule[];

async function canMutateEverySampleModule(input: {
  tenantId: string;
  role: string;
  userId: string;
  action: AppAction;
}) {
  const perms = await getEffectivePermissions(input.tenantId, input.role, input.userId);
  return SAMPLE_DATA_MODULES.every((mod) => effectiveHasPermission(perms, mod, input.action));
}

/**
 * Örnek veri onboarding'i — yeni ofis boş panel yerine tek tıkla küçük,
 * gerçekçi bir Türkçe set görür (aktivasyon artırıcı, bkz. migration
 * 20260726000086_sample_data.sql). Tüm kayıtlar is_sample=true ile işaretlenir;
 * temizleme yalnız bu bayrağı taşıyanları KALICI siler, gerçek veriye dokunmaz.
 */

export async function seedSampleData(): Promise<SampleDataResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!(await canMutateEverySampleModule({ ...gate, action: "create" }))) {
    return {
      error: "Örnek veri yüklemek için müşteri, portföy, talep, görev, randevu ve anlaşma oluşturma yetkileri gerekir.",
    };
  }
  const tenantId = gate.tenantId;
  const userId = gate.userId;

  const supabase = await createClient();

  // Kapı: yalnız GERÇEK müşterisi hiç olmayan ve daha önce hiç örnek veri
  // yüklememiş ofis. (Silinmişler dahil sayılır — kayıt girmiş bir ofis
  // "yeni" değildir; örnek veri karışıklık yaratır.)
  const [{ count: customerCount }, { data: tenantRow }] = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }),
    supabase.from("tenants").select("sample_seeded_at").eq("id", tenantId).maybeSingle(),
  ]);
  if ((customerCount ?? 0) > 0) {
    return { error: "Ofiste kayıt bulunuyor — örnek veri yalnız boş ofislere yüklenebilir." };
  }
  if (tenantRow?.sample_seeded_at) {
    return { error: "Örnek veriler zaten yüklü." };
  }

  try {
    // Kayıt seti tek kaynaktan gelir (src/lib/sample-data-seed.ts); platform yönetimi de aynısını kullanır.
    await insertSampleRecords(supabase, tenantId, userId);

    // tenants güncellemesi kullanıcı RLS'ine takılmasın diye admin client
    // (yalnız kendi tenant'ı, tek kolon — logActivity ile aynı desen)
    const admin = createAdminClient();
    const { error: markErr } = await admin
      .from("tenants")
      .update({ sample_seeded_at: new Date().toISOString() })
      .eq("id", tenantId);
    if (markErr) throw markErr;
  } catch (e) {
    console.error("seedSampleData", e);
    return { error: "Örnek veriler yüklenemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId,
    actorId: userId,
    action: "sample_data.seed",
    entityType: "tenant",
    entityId: tenantId,
    newValue: { ...SAMPLE_DATA_COUNTS },
  });

  revalidatePath("/app");
  revalidatePath("/app/ayarlar");
  return { ok: true };
}

/**
 * Örnek verileri KALICI siler (soft delete değil) — yalnız is_sample=true
 * kayıtlar; gerçek kayıtlara asla dokunmaz. FK sırası gereği anlaşmalar
 * müşteri/portföyden ÖNCE silinir (hepsi doğrudan is_sample filtresiyle).
 */
export async function clearSampleData(): Promise<SampleDataResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!(await canMutateEverySampleModule({ ...gate, action: "delete" }))) {
    return {
      error: "Örnek verileri temizlemek için ilgili tüm modüllerde silme yetkisi gerekir.",
    };
  }
  const tenantId = gate.tenantId;

  const supabase = await createClient();

  try {
    // Tüm tablolar aynı doğrudan is_sample filtresiyle silinir; FK sırası:
    // anlaşma → görev/randevu/talep → portföy → müşteri (deals ÖNCE —
    // komisyonlar cascade, gerçek kayıtlara asla dokunulmaz)
    const del = (table: string) =>
      supabase.from(table).delete().eq("tenant_id", tenantId).eq("is_sample", true);
    const { error: dealErr } = await del("deals");
    if (dealErr) throw dealErr;
    const { error: taskErr } = await del("tasks");
    if (taskErr) throw taskErr;
    const { error: apptErr } = await del("appointments");
    if (apptErr) throw apptErr;
    const { error: demandErr } = await del("customer_demands");
    if (demandErr) throw demandErr;

    const { error: propErr } = await del("properties");
    if (propErr) throw propErr;
    const { error: custErr } = await del("customers");
    if (custErr) throw custErr;

    const admin = createAdminClient();
    const { error: markErr } = await admin
      .from("tenants")
      .update({ sample_seeded_at: null })
      .eq("id", tenantId);
    if (markErr) throw markErr;
  } catch (e) {
    console.error("clearSampleData", e);
    return { error: "Örnek veriler temizlenemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId,
    actorId: gate.userId,
    action: "sample_data.clear",
    entityType: "tenant",
    entityId: tenantId,
  });

  revalidatePath("/app");
  revalidatePath("/app/ayarlar");
  return { ok: true };
}

/** ConfirmDialog `formAction` uyumu için void sarmalayıcı (hata logda kalır). */
export async function clearSampleDataForm(_formData: FormData): Promise<void> {
  await clearSampleData();
}
