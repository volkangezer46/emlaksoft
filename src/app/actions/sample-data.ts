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
import type { SampleClearReport } from "@/lib/sample-clear";
import { purgeSampleData } from "@/lib/sample-data/purge";
import { canSwitchToRealUse, REAL_USE_HREF, realUseConfirmMatches } from "@/lib/sample-data/real-use";
import { loadSampleLockState, sampleSeedDecision } from "@/lib/sample-data/lock";
import { removeSamplePersonaIdentities } from "@/lib/sample-data/personas";
import { actionErrorMessage } from "@/lib/action-errors";

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

/** DB tetikleyicisinin kilit reddi (`SAMPLE_SEED_LOCKED:<kod>`) → Türkçe mesaj. */
function lockErrorMessage(e: unknown): string | null {
  const msg = String((e as { message?: string } | null)?.message ?? "");
  if (!msg.includes("SAMPLE_SEED_LOCKED")) return null;
  return msg.includes("real_records")
    ? "Ofiste gerçek kayıtlar var; örnek veri yalnız gerçek kaydı olmayan ofise yüklenebilir."
    : "Ofis gerçek kullanıma geçti; örnek veri bir daha yüklenemez.";
}

/**
 * Örnek veri onboarding'i — yeni ofis boş panel yerine tek tıkla TAM demo ofis görür (bkz. src/lib/sample-data-seed.ts).
 * KİLİT (sahip kuralı): gerçek kullanıma geçmiş ya da gerçek kaydı olan ofise ASLA yüklenmez — burada
 * `sample_seed_guard` ile, DB'de ayrıca tetikleyiciyle (uygulama kapısı atlansa bile). `input.pack`: konut | ticari | arsa.
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
  const [lock, { count: customerCount }, { data: tenantRow }] = await Promise.all([
    loadSampleLockState(supabase, tenantId),
    supabase.from("customers").select("id", { count: "exact", head: true }),
    supabase.from("tenants").select("sample_seeded_at").eq("id", tenantId).maybeSingle(),
  ]);
  const decision = sampleSeedDecision(lock, now());
  if (!decision.allowed) return { error: decision.reason };
  if ((customerCount ?? 0) > 0) {
    return { error: "Ofiste kayıt bulunuyor — örnek veri yalnız boş ofislere yüklenebilir." };
  }
  if (tenantRow?.sample_seeded_at) {
    return { error: "Örnek veriler zaten yüklü." };
  }

  let seed: SampleSeedReport;
  try {
    // Ek katman (demo ekip, kazanılmış anlaşma, komisyon, kira) service_role ister; yalnız kendi tenant'ı.
    const admin = createAdminClient();
    seed = await insertSampleRecords(supabase, tenantId, userId, { extrasDb: admin, pack });

    const { error: markErr } = await admin
      .from("tenants")
      .update({ sample_seeded_at: new Date(now()).toISOString() })
      .eq("id", tenantId);
    if (markErr) throw markErr;
    await admin.from("tenants").update({ sample_pack: pack, sample_cleared_at: null }).eq("id", tenantId);
  } catch (e) {
    console.error("seedSampleData", e);
    return { error: lockErrorMessage(e) ?? actionErrorMessage(e, "Örnek veriler yüklenemedi. Lütfen tekrar deneyin.") };
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

  revalidatePath("/app", "layout");
  revalidatePath("/app/ayarlar");
  revalidatePath("/app/baslangic");
  return { ok: true, seed };
}

/**
 * "Gerçek kullanıma geç" — örnek verileri KALICI siler (GERİ ALINAMAZ) ve ofisi kilitler (bir daha örnek veri yüklenemez).
 * İki onay: (1) sayılarla silinecekler, (2) ofis adı ya da "SİL" yazımı — `confirm` burada SUNUCUDA da doğrulanır.
 * Kapı: settings:edit + ofis sahibi/genel müdür (RPC aynı kuralı içeride tekrar doğrular). Yol: purge v2 RPC (tek
 * transaction, oturum istemcisi); demo ekip profillerinin giriş yapamayan kimlikleri ardından silinir.
 */
export async function clearSampleData(input: { confirm: string }): Promise<SampleDataResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!canSwitchToRealUse(gate.role)) {
    return { error: "Gerçek kullanıma geçiş yalnız ofis sahibi veya genel müdür tarafından yapılabilir." };
  }
  if (!(await canMutateEverySampleModule({ ...gate, action: "delete" }))) {
    return { error: "Örnek verinin dokunduğu modüllerden birinde silme yetkiniz yok." };
  }
  const tenantId = gate.tenantId;
  const session = await createClient();
  const { data: office } = await session.from("tenants").select("name").eq("id", tenantId).maybeSingle();
  if (!realUseConfirmMatches(input?.confirm, (office as { name?: string } | null)?.name ?? null)) {
    return { error: "Onay metni eşleşmedi. Ofis adını ya da SİL yazın." };
  }

  // Eski yol ve demo ekip kimlikleri için service_role; her sorgu açık tenant_id + is_sample süzgeciyle sınırlıdır.
  const admin = createAdminClient();
  const result = await purgeSampleData({ session, tenantId, fallbackAdmin: admin });
  const report = result.report;
  const identities = result.ok && result.personasRemoved.length > 0 ? await removeSamplePersonaIdentities(admin, result.personasRemoved) : null;

  await logActivity({
    tenantId,
    actorId: gate.userId,
    action: result.ok ? "sample_data.clear" : "sample_data.clear_partial",
    entityType: "tenant",
    entityId: tenantId,
    newValue: {
      via: result.ok ? result.via : "failed",
      deleted: report?.deleted ?? {},
      total: report?.totalDeleted ?? 0,
      failed: report?.failed.map((f) => f.table) ?? [],
      team_removed: identities?.removed ?? 0,
      team_kept: identities?.kept ?? 0,
      locked: result.ok,
    },
  });

  revalidatePath("/app", "layout");
  revalidatePath("/app/ayarlar");
  revalidatePath(REAL_USE_HREF);
  revalidatePath("/app/baslangic");
  if (!result.ok) return { error: result.error, clear: result.report };
  return { ok: true, clear: result.report };
}
