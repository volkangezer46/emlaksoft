import type { SupabaseClient } from "@supabase/supabase-js";
import { insertNotifications, type NotificationRow } from "@/lib/notify-batch";

/**
 * DURAKLATMA + PLANLI DÜŞÜRME: `abonelik-kontrol` CRON ADIMLARI (yeni cron YOK; sayı 36 kalır).
 * `admin` çağıranın (route) mevcut service_role istemcisidir; bu dosya yeni service_role istemcisi oluşturmaz.
 *
 *  1) Süresi dolan duraklatmalar OTOMATİK devam eder (dönem sonu gerçek duraklatma süresi kadar uzar).
 *  2) Dönemi biten planlı düşürmeler uygulanır (kapasite aşımında planlı kayıt iptal edilir + bildirim).
 *  3) Duraklatılmış abonelik dönem sonu iptali / gecikme akışlarından MUAFTIR (`pausedSubscriptionIds`).
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
        body: "Planladığınız daha ucuz pakete geçiş dönem sonunda uygulandı. Sonraki yenilemede yeni paketin tutarı alınır.",
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
