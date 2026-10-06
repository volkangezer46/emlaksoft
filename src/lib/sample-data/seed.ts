import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import { insertSampleRecords, SAMPLE_DATA_COUNTS, SAMPLE_PACKS, type SamplePack, type SampleSeedReport } from "@/lib/sample-data-seed";

/**
 * Örnek veri yükleme — İDEMPOTENT sunucu çekirdeği (istemci import ETMEZ).
 *
 * Kayıt sihirbazı ("Demo veriyle başla") ve ofis içi "Örnek veriyle başla" aynı kayıt setini
 * (`insertSampleRecords`, tek kaynak) kullanır. Bu sarmalayıcı iki şeyi garanti eder:
 *  1. Aynı ofise iki kez çağrılırsa ikinci çağrı HİÇ yazmaz (`sample_seeded_at` damgası ya da mevcut
 *     is_sample müşteri varsa `skipped: "already_seeded"`). Yarıda kesilen bir kayıt akışı tekrar denendiğinde
 *     çift demo seti oluşmaz.
 *  2. Hata kayıt akışını ASLA bozmaz: sonuç döner, fırlatmaz.
 *
 * `db` çağıranın elindeki istemcidir (kayıtta service_role: ekler katmanı için gerekir; yeni createAdminClient yok).
 * Tüm kayıtlar `is_sample=true` taşır; `purge_tenant_sample_data` ile tek adımda silinir.
 */

export type EnsureSampleResult =
  | { ok: true; skipped: null; report: SampleSeedReport }
  | { ok: true; skipped: "already_seeded"; report: null }
  | { ok: false; skipped: null; report: null };

type SeedDb = Pick<SupabaseClient, "from">;

export function normalizePack(v: unknown): SamplePack {
  return (SAMPLE_PACKS as readonly string[]).includes(String(v)) ? (v as SamplePack) : "konut";
}

/** Ofiste örnek veri damgası ya da is_sample müşteri var mı? Okuma hatasında `true` döner (yazma yerine atlama: güvenli taraf). */
export async function isAlreadySeeded(db: SeedDb, tenantId: string): Promise<boolean> {
  const [{ data: tenant, error: tErr }, { count, error: cErr }] = await Promise.all([
    db.from("tenants").select("sample_seeded_at").eq("id", tenantId).maybeSingle(),
    db.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_sample", true),
  ]);
  if (tErr || cErr) return true;
  if ((tenant as { sample_seeded_at?: string | null } | null)?.sample_seeded_at) return true;
  return (count ?? 0) > 0;
}

export async function ensureSampleData(
  db: SupabaseClient,
  tenantId: string,
  ownerId: string,
  opts: { pack?: SamplePack; by?: "registration" | "wizard" | "settings" } = {},
): Promise<EnsureSampleResult> {
  const pack = normalizePack(opts.pack ?? "konut");
  try {
    if (await isAlreadySeeded(db, tenantId)) return { ok: true, skipped: "already_seeded", report: null };
    const report = await insertSampleRecords(db, tenantId, ownerId, { extrasDb: db, pack });
    const stamp = new Date(now()).toISOString();
    const { error: markError } = await db.from("tenants").update({ sample_seeded_at: stamp }).eq("id", tenantId);
    if (markError) throw markError;
    // Genişletme sütunları (sample_pack/sample_cleared_at) yoksa sessizce atla.
    await db.from("tenants").update({ sample_pack: pack, sample_cleared_at: null }).eq("id", tenantId);
    await logActivity({
      tenantId,
      actorId: ownerId,
      action: "sample_data.seed",
      entityType: "tenant",
      entityId: tenantId,
      newValue: {
        ...SAMPLE_DATA_COUNTS,
        by: opts.by ?? "registration",
        pack,
        loaded: report.counts,
        skipped: report.skipped.map((x) => x.group),
        failed: report.failed.map((x) => x.group),
      },
    });
    return { ok: true, skipped: null, report };
  } catch (e) {
    console.error("ensureSampleData", e);
    return { ok: false, skipped: null, report: null };
  }
}
