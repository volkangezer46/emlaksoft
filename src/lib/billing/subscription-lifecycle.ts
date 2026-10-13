import type { SupabaseClient } from "@supabase/supabase-js";
import { insertNotifications, type NotificationRow } from "@/lib/notify-batch";

/**
 * DURAKLATMA + PLANLI DÜŞÜRME: `abonelik-kontrol` CRON ADIMLARI (yeni cron YOK; sayı 36 kalır).
 * `admin` çağıranın (route) mevcut service_role istemcisidir; bu dosya yeni service_role istemcisi oluşturmaz.
 *
 *  1) Süresi dolan duraklatmalar OTOMATİK devam eder (dönem sonu gerçek duraklatma süresi kadar uzar).
 *  2) Dönemi biten planlı düşürmeler uygulanır (kapasite aşımında planlı kayıt iptal edilir + bildirim).
 *  3) Duraklatılmış abonelik dönem sonu iptali / gecikme akışlarından MUAFTIR (`pausedSubscriptionIds`).
 *  4) Dönemi bitmiş 'active' abonelik → 'past_due' (`runExpireActiveToPastDue`; YALNIZ `billing.expire_to_past_due`
 *     açıksa, varsayılan KAPALI — 1-3'ün aksine bayrağa BAĞLIDIR).
 * Her iki adım da bayraktan BAĞIMSIZ çalışır: bayrak kapansa da duraklatılmış ofis takılı kalmaz. RPC'ler yoksa
 * (migration uygulanmadı) adımlar sessizce atlanır. Hata asıl cron işini bozmaz.
 */

export type LifecycleSummary = {
  resumed: number;
  downgraded: number;
  downgradeFailed: number;
  notified: number;
  skipped: boolean;
};

const BILLING_HREF = "/app/abonelik";
const MISSING_RPC = /PGRST202|42883|schema cache|does not exist|Could not find the function/i;

type RpcResult = { ok?: boolean; resumed?: number; tenantIds?: string[]; applied?: number; appliedTenantIds?: string[]; failed?: number; failedTenantIds?: string[] };

function ids(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

async function callRpc(admin: SupabaseClient, name: string): Promise<RpcResult | null> {
  const { data, error } = await admin.rpc(name);
  if (error) {
    if (!MISSING_RPC.test(`${error.code ?? ""} ${error.message ?? ""}`)) {
      console.error(`abonelik-kontrol ${name}`, error.code, error.message);
    }
    return null;
  }
  return data && typeof data === "object" && !Array.isArray(data) ? (data as RpcResult) : null;
}

export async function runSubscriptionLifecycle(admin: SupabaseClient): Promise<LifecycleSummary> {
  const out: LifecycleSummary = { resumed: 0, downgraded: 0, downgradeFailed: 0, notified: 0, skipped: true };
  const rows: NotificationRow[] = [];

  const resume = await callRpc(admin, "subscription_resume_due");
  if (resume) {
    out.skipped = false;
    const tenants = ids(resume.tenantIds);
    out.resumed = Number(resume.resumed ?? tenants.length) || 0;
    for (const tenantId of tenants) {
      rows.push({
        tenant_id: tenantId,
        title: "Aboneliğiniz devam ediyor",
        body: "Duraklatma süreniz doldu; aboneliğiniz otomatik devam ettirildi ve dönem bitişiniz duraklatma süresi kadar uzatıldı. Verileriniz yeniden düzenlenebilir.",
        href: BILLING_HREF,
        kind: "success",
      });
    }
  }

  const change = await callRpc(admin, "subscription_apply_scheduled_plan_changes");
  if (change) {
    out.skipped = false;
    const applied = ids(change.appliedTenantIds);
    const failed = ids(change.failedTenantIds);
    out.downgraded = Number(change.applied ?? applied.length) || 0;
    out.downgradeFailed = Number(change.failed ?? failed.length) || 0;
    for (const tenantId of applied) {
      rows.push({
        tenant_id: tenantId,
        title: "Paket değişikliğiniz uygulandı",
        // Planlı değişikliği ofis (düşürme) ya da Ofis 360 yöneticisi (yükseltme/düşürme) yapmış olabilir: metin yön
        // ve kişi varsaymaz.
        body: "Dönem sonu için planlanan paket değişikliği uygulandı. Sonraki yenilemede yeni paketin tutarı alınır; ayrıntılar Abonelik sayfasında.",
        href: BILLING_HREF,
        kind: "info",
      });
    }
    for (const tenantId of failed) {
      rows.push({
        tenant_id: tenantId,
        title: "Planlı paket değişikliği uygulanamadı",
        body: "Mevcut kullanımınız (kullanıcı, müşteri, portföy veya şube) seçtiğiniz paketin sınırını aşıyor; paket değişmedi. Kullanımı azaltıp değişikliği yeniden planlayabilirsiniz.",
        href: BILLING_HREF,
        kind: "warning",
      });
    }
  }

  if (rows.length > 0) {
    try {
      out.notified = await insertNotifications(admin, rows);
    } catch (e) {
      console.error("abonelik-kontrol lifecycle notify", e instanceof Error ? e.message : "hata");
    }
  }
  return out;
}

export type ExpireSummary = { enabled: boolean; candidates: number; expired: number; tenants: number; error: string | null };

/** Ayar okuyucusu (Ayar Kayıt Defteri; varsayılan KAPALI). Okunamazsa kapalı sayılır. */
export async function isExpireToPastDueEnabled(): Promise<boolean> {
  try {
    const { getSetting } = await import("@/lib/settings/read");
    return (await getSetting<boolean>("billing.expire_to_past_due")) === true;
  } catch {
    return false;
  }
}

/**
 * KÖK NEDEN ADIMI: dönemi bitmiş ama hâlâ 'active' görünen abonelik → 'past_due' (ofis 'active' ise o da 'past_due').
 * YALNIZ `billing.expire_to_past_due` AÇIKSA çalışır (varsayılan KAPALI; sahip /admin dikkat kuyruğunu inceleyip açar).
 * Kapalıyken HİÇBİR okuma/yazma yapmaz. Duraklatılmış (pause_started_at dolu) ve dönem sonu iptali bekleyen
 * (cancel_at_period_end) abonelik atlanır: onları kendi adımları kapatır.
 * YARIŞ GÜVENLİĞİ: güncelleme okuma koşulunu TEKRARLAR (status=active + dönem geçmiş); bu arada ödeme alıp dönemi
 * uzayan abonelik ezilmez. Idempotent: ikinci koşuda aday kalmaz.
 */
export async function runExpireActiveToPastDue(
  admin: SupabaseClient,
  nowIso: string,
  opts: { enabled: boolean; limit?: number },
): Promise<ExpireSummary> {
  const out: ExpireSummary = { enabled: opts.enabled, candidates: 0, expired: 0, tenants: 0, error: null };
  if (!opts.enabled) return out;
  const { data, error } = await admin
    .from("subscriptions")
    .select("id, tenant_id")
    .eq("status", "active")
    .lt("current_period_end", nowIso)
    .is("pause_started_at", null)
    .eq("cancel_at_period_end", false)
    .order("current_period_end", { ascending: true })
    .limit(opts.limit ?? 100);
  if (error) {
    out.error = `dönemi bitmiş okunamadı: ${error.message}`;
    return out;
  }
  const rows = (data ?? []) as Array<{ id: string; tenant_id: string }>;
  out.candidates = rows.length;
  if (rows.length === 0) return out;

  const subRes = await admin
    .from("subscriptions")
    .update({ status: "past_due", updated_at: nowIso })
    .in("id", rows.map((r) => r.id))
    .eq("status", "active")
    .lt("current_period_end", nowIso)
    .select("id, tenant_id");
  if (subRes.error) {
    out.error = `dönemi bitmiş yazılamadı: ${subRes.error.message}`;
    return out;
  }
  const changed = (subRes.data ?? []) as Array<{ id: string; tenant_id: string }>;
  out.expired = changed.length;
  const tenantIds = [...new Set(changed.map((r) => String(r.tenant_id)))];
  if (tenantIds.length === 0) return out;

  const tenantRes = await admin
    .from("tenants")
    .update({ status: "past_due", updated_at: nowIso })
    .in("id", tenantIds)
    .eq("status", "active")
    .select("id");
  if (tenantRes.error) {
    out.error = `dönemi bitmiş ofis yazılamadı: ${tenantRes.error.message}`;
    return out;
  }
  const changedTenants = ((tenantRes.data ?? []) as Array<{ id: string }>).map((t) => String(t.id));
  out.tenants = changedTenants.length;
  if (changedTenants.length > 0) {
    try {
      await insertNotifications(
        admin,
        changedTenants.map((tenantId) => ({
          tenant_id: tenantId,
          title: "Abonelik döneminiz sona erdi",
          body: "Ödenmiş döneminiz bitti ve yenileme ödemesi alınamadı. Kesinti yaşamamak için Paket & ödeme sayfasından ödemenizi tamamlayın.",
          href: BILLING_HREF,
          kind: "warning",
        })),
      );
    } catch (e) {
      console.error("abonelik-kontrol expire notify", e instanceof Error ? e.message : "hata");
    }
  }
  return out;
}

/**
 * Verilen abonelik kimliklerinden DURAKLATILMIŞ olanlar. Sütun yoksa/sorgu hata verirse boş küme (davranış eskisi gibi).
 * Dönem sonu iptali gibi otomatik adımlar bunları atlar: duraklatmanın dönem sonunu aşan kısmı iptal sebebi değildir.
 */
export async function pausedSubscriptionIds(admin: SupabaseClient, subscriptionIds: readonly string[]): Promise<Set<string>> {
  if (subscriptionIds.length === 0) return new Set();
  const { data, error } = await admin
    .from("subscriptions")
    .select("id")
    .in("id", [...subscriptionIds])
    .not("pause_started_at", "is", null);
  if (error || !data) return new Set();
  return new Set(data.map((r) => String((r as { id: string }).id)));
}
