"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { effectiveHasPermission, getEffectivePermissions } from "@/lib/permissions-effective";
import type { AppAction, AppModule } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import {
  insertSampleRecords,
  SAMPLE_DATA_COUNTS,
  SAMPLE_PACKS,
  type SamplePack,
  type SampleSeedReport,
} from "@/lib/sample-data-seed";
import { deleteSampleRecords, type SampleClearReport } from "@/lib/sample-clear";

export type SampleDataResult = {
  error?: string;
  ok?: boolean;
  /** Yükleme özeti (yüklenen / atlanan / hata veren gruplar). */
  seed?: SampleSeedReport;
  /** Temizleme özeti; `complete=false` ise yarım kaldı, tekrar denenebilir. */
  clear?: SampleClearReport;
};

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
 * Örnek veri onboarding'i — yeni ofis boş panel yerine tek tıkla TAM demo ofis görür: müşteri, talep,
 * portföy (satılık/kiralık/arsa/lüks/ticari), randevu, görev, teklif, kazanılmış anlaşma + komisyon,
 * kira/tahakkuk, gider, arama, bildirim (bkz. src/lib/sample-data-seed.ts). Tüm kayıtlar is_sample=true
 * ile işaretlenir; temizleme yalnız bu bayrağı taşıyanları KALICI siler, gerçek veriye dokunmaz.
 * `input.pack` (konut | ticari | arsa) ofis tipi damgasıdır; geçersizse "konut".
 */

export async function seedSampleData(input?: { pack?: string }): Promise<SampleDataResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!(await canMutateEverySampleModule({ ...gate, action: "create" }))) {
    return {
      error: "Örnek veri yüklemek için müşteri, portföy, talep, görev, randevu ve anlaşma oluşturma yetkileri gerekir.",
    };
  }
  const tenantId = gate.tenantId;
  const userId = gate.userId;
  const pack: SamplePack = (SAMPLE_PACKS as readonly string[]).includes(String(input?.pack))
    ? (input?.pack as SamplePack)
    : "konut";

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

  let seed: SampleSeedReport;
  try {
    // tenants güncellemesi kullanıcı RLS'ine takılmasın ve ek katman (kazanılmış anlaşma, komisyon, kira:
    // atomik iş akışı tetikleyicileri oturumlu kullanıcıya kapalı) yazılabilsin diye admin client
    // (yalnız kendi tenant'ı — logActivity ile aynı desen).
    const admin = createAdminClient();
    // Kayıt seti tek kaynaktan gelir (src/lib/sample-data-seed.ts); platform yönetimi de aynısını kullanır.
    seed = await insertSampleRecords(supabase, tenantId, userId, { extrasDb: admin, pack });

    const { error: markErr } = await admin
      .from("tenants")
      .update({ sample_seeded_at: new Date(now()).toISOString() })
      .eq("id", tenantId);
    if (markErr) throw markErr;
    // Demo paketi damgası: genişletme migration'ı uygulanmamışsa sütun yoktur — sessizce atla.
    await admin.from("tenants").update({ sample_pack: pack, sample_cleared_at: null }).eq("id", tenantId);
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
    newValue: {
      ...SAMPLE_DATA_COUNTS,
      pack,
      loaded: seed.counts,
      skipped: seed.skipped.map((x) => x.group),
      failed: seed.failed.map((x) => x.group),
    },
  });

  revalidatePath("/app");
  revalidatePath("/app/ayarlar");
  revalidatePath("/app/baslangic");
  return { ok: true, seed };
}

/**
 * "Gerçek kullanıma başla" — örnek verileri KALICI siler (soft delete değil, GERİ ALINAMAZ).
 * Yalnız is_sample=true kayıtlar; ofisin gerçek kayıtlarına asla dokunulmaz. Silme sırası ve kısmi hata
 * davranışı `src/lib/sample-clear.ts`'tedir: bir tablo takılırsa diğerleri denenir, `clear.complete=false`
 * döner ve işlem tekrar denenebilir (idempotent). `sample_seeded_at` yalnız TAM temizlikte sıfırlanır.
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

  let report: SampleClearReport;
  try {
    // Kazanılmış anlaşma/komisyon/kira silmesi çekirdek iş akışı tetikleyicilerince yalnız service_role'e
    // açıktır; her sorgu açık tenant_id + is_sample=true süzgeciyle sınırlıdır.
    const admin = createAdminClient();
    report = await deleteSampleRecords(admin, tenantId);
    if (report.complete) {
      const { error: markErr } = await admin
        .from("tenants")
        .update({ sample_seeded_at: null })
        .eq("id", tenantId);
      if (markErr) throw markErr;
      // Genişletme migration'ı uygulanmamışsa bu sütunlar yoktur — sessizce atla.
      await admin
        .from("tenants")
        .update({ sample_pack: null, sample_cleared_at: new Date(now()).toISOString() })
        .eq("id", tenantId);
    }
  } catch (e) {
    console.error("clearSampleData", e);
    return { error: "Örnek veriler temizlenemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId,
    actorId: gate.userId,
    action: report.complete ? "sample_data.clear" : "sample_data.clear_partial",
    entityType: "tenant",
    entityId: tenantId,
    newValue: { deleted: report.deleted, total: report.totalDeleted, failed: report.failed.map((f) => f.table) },
  });

  revalidatePath("/app");
  revalidatePath("/app/ayarlar");
  revalidatePath("/app/baslangic");
  if (!report.complete) {
    return {
      error: `Temizlik yarım kaldı (${report.failed.map((f) => f.label).join(", ")}). Silinenler geri gelmez; tekrar deneyebilirsiniz.`,
      clear: report,
    };
  }
  return { ok: true, clear: report };
}

/** ConfirmDialog `formAction` uyumu için void sarmalayıcı (hata logda kalır). */
export async function clearSampleDataForm(_formData: FormData): Promise<void> {
  await clearSampleData();
}
