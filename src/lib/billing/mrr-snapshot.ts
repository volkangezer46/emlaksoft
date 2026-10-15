import type { SupabaseClient } from "@supabase/supabase-js";
import { computeTenantMrr, sumSnapshotDays, type MrrSnapshotDay } from "@/lib/admin/platform-metrics";
import { fetchAllRowsKeepError } from "@/lib/supabase/fetch-all";

/**
 * PLATFORM MRR GÜNLÜK ANLIK GÖRÜNTÜSÜ (`platform_mrr_daily`, migration 20261013001000).
 *
 * `abonelik-kontrol` cron'unun SON adımı (yeni cron YOK): her ofis için o TR gününün MRR'ı tek satır olarak
 * upsert edilir (`on conflict (day, tenant_id) do update`) — aynı gün tekrar koşmak satır çoğaltmaz, son değeri yazar.
 * Hesap `computeTenantMrr` (platform-metrics) ile yapılır: KPI'daki `exactMrr` ile aynı kural (yalnız aktif abonelik tutarı;
 * aboneliği eksik ofis ve iç/test/demo ofis `tenants.is_internal` 0 yazılır, katalog fiyatı yedeği yok).
 * `admin` çağıranın (route) service_role istemcisidir; bu dosya yeni service_role istemcisi oluşturmaz.
 * Tablo yoksa (migration henüz uygulanmadı) adım `skipped` döner, hata FIRLATMAZ; okuyucu `null` ("veri yok") döner.
 */

const MISSING_TABLE = /42P01|PGRST205|PGRST204|does not exist|schema cache|Could not find the table/i;
/** `tenants.is_internal` yokken (20261016060400 öncesi) PostgREST 42703 döner: hiçbir ofis iç sayılmaz. */
const MISSING_INTERNAL_COLUMN = /42703|is_internal/i;
const UPSERT_CHUNK = 500;

export type MrrSnapshotSummary = { written: number; total: number; skipped: boolean; error: string | null };

type TenantRow = { id: string; plan: string | null; status: string; is_internal?: boolean | null };
type DbError = { message: string; code?: string };
type SubRow = { id: string; tenant_id: string; plan: string | null; status: string; amount_try: number | string | null; updated_at: string | null };

function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(err && MISSING_TABLE.test(`${err.code ?? ""} ${err.message ?? ""}`));
}

/** Ofis başına tek abonelik: aktif olan önce, sonra en son güncellenen. */
function pickSubscription(rows: readonly SubRow[]): Map<string, SubRow> {
  const byTenant = new Map<string, SubRow>();
  for (const s of rows) {
    const cur = byTenant.get(s.tenant_id);
    if (!cur) {
      byTenant.set(s.tenant_id, s);
      continue;
    }
    const curActive = cur.status === "active";
    const nextActive = s.status === "active";
    if (nextActive && !curActive) byTenant.set(s.tenant_id, s);
    else if (nextActive === curActive && String(s.updated_at ?? "") > String(cur.updated_at ?? "")) byTenant.set(s.tenant_id, s);
  }
  return byTenant;
}

/** Ofislerin satırları; `is_internal` sütunu yoksa (migration öncesi) onsuz yeniden okunur. */
async function loadTenantRows(admin: SupabaseClient): Promise<{ data: TenantRow[]; error: DbError | null }> {
  const withFlag = await fetchAllRowsKeepError<TenantRow, DbError>((from, to) =>
    admin.from("tenants").select("id, plan, status, is_internal").order("id", { ascending: true }).range(from, to),
  );
  if (!withFlag.error || !MISSING_INTERNAL_COLUMN.test(`${withFlag.error.code ?? ""} ${withFlag.error.message}`)) return withFlag;
  return fetchAllRowsKeepError<TenantRow, DbError>((from, to) =>
    admin.from("tenants").select("id, plan, status").order("id", { ascending: true }).range(from, to),
  );
}

/**
 * İç/test/demo ofis kimlikleri (`tenants.is_internal`). Sütun yoksa ya da okunamazsa boş küme: hiçbir ofis dışarıda bırakılmaz
 * (eski davranış), hata fırlatılmaz. Platform MRR eğrisi ve churn bu kümeyi dışlar.
 */
export async function loadInternalTenantIds(admin: SupabaseClient): Promise<ReadonlySet<string>> {
  const { data, error } = await admin.from("tenants").select("id").eq("is_internal", true);
  if (error || !data) return new Set();
  return new Set((data as { id: string }[]).map((r) => r.id));
}

export async function runMrrSnapshot(admin: SupabaseClient, dayKey: string): Promise<MrrSnapshotSummary> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return { written: 0, total: 0, skipped: true, error: "geçersiz gün" };

  // Tablo var mı: ucuz yoklama (yoksa hiç okuma yapmadan atla). HEAD DEĞİL: PostgREST olmayan tabloya HEAD isteğinde
  // 204 + hatasız döner (canlıda ölçüldü), tablo yokluğu yalnız GET'te PGRST205 olarak görünür.
  const probe = await admin.from("platform_mrr_daily").select("day").eq("day", dayKey).limit(1);
  if (probe.error) {
    if (isMissingTable(probe.error)) return { written: 0, total: 0, skipped: true, error: null };
    return { written: 0, total: 0, skipped: false, error: probe.error.message };
  }

  const [tenants, subs] = await Promise.all([
    loadTenantRows(admin),
    fetchAllRowsKeepError<SubRow, DbError>((from, to) =>
      admin.from("subscriptions").select("id, tenant_id, plan, status, amount_try, updated_at").order("id", { ascending: true }).range(from, to),
    ),
  ]);
  if (tenants.error) return { written: 0, total: 0, skipped: false, error: `ofisler okunamadı: ${tenants.error.message}` };
  if (subs.error) return { written: 0, total: 0, skipped: false, error: `abonelikler okunamadı: ${subs.error.message}` };

  const subByTenant = pickSubscription(subs.data);
  const rows = tenants.data.map((t) => {
    const sub = subByTenant.get(t.id) ?? null;
    return {
      day: dayKey,
      tenant_id: t.id,
      subscription_id: sub?.id ?? null,
      plan_id: sub?.status === "active" ? (sub.plan ?? t.plan) : t.plan,
      mrr_try: computeTenantMrr({ tenantStatus: t.status, tenantPlan: t.plan, sub, internal: t.is_internal === true }),
      status: t.status,
    };
  });

  let written = 0;
  let total = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await admin.from("platform_mrr_daily").upsert(chunk, { onConflict: "day,tenant_id" });
    if (error) return { written, total, skipped: false, error: `yazılamadı: ${error.message}` };
    written += chunk.length;
    total += chunk.reduce((s, r) => s + r.mrr_try, 0);
  }
  return { written, total: Math.round(total), skipped: false, error: null };
}

/**
 * Eğri okuyucusu: verilen günlerin (ay sonu adayları, `monthEndCandidateDays`) anlık görüntü toplamları. İç/test/demo ofis
 * satırları (`tenants.is_internal`) toplama girmez: bayraktan önce yazılmış günlerde de MRR KPI'ı ile aynı küme.
 * Tablo yoksa ya da okunamazsa `null` döner (çağıran "veri yok" gösterir; "bugünkü aktif aboneliklerden geriye dönük" eğri ÇİZİLMEZ).
 */
export async function loadMrrSnapshotDays(admin: SupabaseClient, days: readonly string[]): Promise<MrrSnapshotDay[] | null> {
  if (days.length === 0) return [];
  const [res, internal] = await Promise.all([
    fetchAllRowsKeepError<{ day: string; tenant_id: string; mrr_try: number | string }, DbError>((from, to) =>
      admin
        .from("platform_mrr_daily")
        .select("day, tenant_id, mrr_try")
        .in("day", [...days])
        .order("day", { ascending: true })
        .order("tenant_id", { ascending: true })
        .range(from, to),
    ),
    loadInternalTenantIds(admin),
  ]);
  if (res.error) return null;
  return sumSnapshotDays(internal.size > 0 ? res.data.filter((r) => !internal.has(r.tenant_id)) : res.data);
}
