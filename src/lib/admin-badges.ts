import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import { TICKET_OPEN_STATUSES } from "@/lib/support/ticket-contract";
import { CRON_JOBS } from "@/lib/cron-jobs";
import { getOpsReadinessSignals, type ReadinessSignal } from "@/lib/admin/ops-readiness";
import { ADMIN_BADGES_TAG } from "@/lib/admin/counter-tags";

const KNOWN_JOBS: ReadonlySet<string> = new Set(CRON_JOBS.map((j) => j.job));

/**
 * Yan menü sayaçları (anahtarlar `nav.ts` AdminBadgeKey; renk kuralı `ADMIN_BADGE_TONE`): açık talep, riskli ofis
 * (gecikmiş/askıda), vadesi geçmiş açık fatura, süresi dolmamış bekleyen dört göz onayı ve açık KVKK başvurusu.
 */
export type AdminBadges = { tickets: number; risk: number; approvals: number; payments: number; kvkk: number };

/** Üst çubuk sistem durumu çipi: ölçülen gerçek değerler (uydurma kesintisiz süre/doluluk YOK). */
export type AdminHealth = {
  /** Sayaç sorgularının toplam gidiş-dönüş süresi (ms) — veritabanı yanıt süresi göstergesi. */
  dbMs: number;
  /** Tüm sorgular hatasız döndü mü. */
  ok: boolean;
  cronTotal: number | null;
  cronErrors: number | null;
  /** Son çalışması hatalı biten cron işlerinin adları (en çok 3): kart hangi iş olduğunu söyler. */
  failedJobs?: string[];
  /** cron_heartbeats'te olup vercel.json'da tanımlı olmayan (eski/silinmiş) iş adları; sayıma katılmaz. */
  unknownJobs?: string[];
  lastCronAt: string | null;
  /** Ölçümün yapıldığı an (ms; 30 sn önbellek turu). Kartta "Son kontrol" olarak gösterilir. */
  checkedAt?: number;
  /** Operasyon hazırlık sinyalleri (uyarı kanalı, kritik uyarı teslimi, yedek, tatbikat, e-posta); çipi "uyarı" yapar. */
  readiness?: ReadinessSignal[] | null;
};

/**
 * Admin sidebar rozet sayaçları + sistem sağlığı. Ofis riski ve cron nabzı operasyonel bilgi: `unstable_cache` ile 30 sn
 * platform-genel önbellek (service-role, kullanıcıya özel veri yok). AÇIK TALEP sayısı ise önbelleksiz tek HEAD sayımıdır
 * (`liveOpenTickets`): rozet ve Kontrol paneli aynı anda aynı sayıyı gösterir (bayat 30 sn rozet yok). Kabuk bu sayıları
 * BEKLEMEZ: layout söz (promise) olarak verir, rozet küçük Suspense sınırında akar.
 */
const cachedBadges = unstable_cache(
  async (): Promise<{ risk: number; approvals: number; payments: number; kvkk: number; health: AdminHealth }> => {
    const admin = createAdminClient();
    const t0 = now();
    const nowIso = new Date(t0).toISOString();
    const [riskRes, cronRes, approvalsRes, paymentsRes, kvkkRes] = await Promise.all([
      admin.from("tenants").select("id", { count: "exact", head: true }).in("status", ["past_due", "suspended"]),
      admin.from("cron_heartbeats").select("job, last_status, last_run_at"),
      // Onaylar sayfasının "bekleyen" süzgeciyle aynı küme (süresi dolan talep sayılmaz).
      admin.from("platform_approval_requests").select("id", { count: "exact", head: true }).eq("status", "pending").gt("expires_at", nowIso),
      // Tahsilat: vadesi geçmiş açık fatura (yaşlandırma listesinin kaynağı).
      admin.from("invoices").select("id", { count: "exact", head: true }).eq("status", "open").lt("due_at", nowIso),
      // KVKK: doğrudan başvurularda açık / işlemde olanlar (KVKK sayfasının sekme sayacıyla aynı).
      admin.from("platform_kvkk_requests").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
    ]);
    const dbMs = Math.max(0, now() - t0);
    const allCronRows = cronRes.error ? null : (cronRes.data ?? []);
    // Yalnız vercel.json'daki (CRON_JOBS) işler sayılır; eski/silinmiş heartbeat adları ayrı not.
    const cronRows = allCronRows ? allCronRows.filter((r) => KNOWN_JOBS.has(String(r.job))) : null;
    const unknownJobs = allCronRows
      ? allCronRows.filter((r) => !KNOWN_JOBS.has(String(r.job))).map((r) => String(r.job))
      : [];
    return {
      risk: riskRes.count ?? 0,
      // Okunamayan sayaç 0 (rozet çizilmez); sıfır gibi uydurulmaz, yalnız gizlenir.
      approvals: approvalsRes.error ? 0 : (approvalsRes.count ?? 0),
      payments: paymentsRes.error ? 0 : (paymentsRes.count ?? 0),
      kvkk: kvkkRes.error ? 0 : (kvkkRes.count ?? 0),
      health: {
        dbMs,
        ok: !riskRes.error,
        cronTotal: cronRows ? cronRows.length : null,
        cronErrors: cronRows ? cronRows.filter((r) => r.last_status === "error").length : null,
        failedJobs: cronRows ? cronRows.filter((r) => r.last_status === "error").map((r) => String(r.job)).slice(0, 3) : [],
        unknownJobs: unknownJobs.slice(0, 5),
        lastCronAt: cronRows && cronRows.length ? cronRows.map((r) => String(r.last_run_at)).sort().at(-1) ?? null : null,
        checkedAt: now(),
      },
    };
  },
  ["admin-sidebar-badges-v8"],
  { revalidate: 30, tags: [ADMIN_BADGES_TAG] },
);

/** Açık (open/in_progress/waiting) talep sayısı: önbelleksiz tek HEAD sayımı, istek içinde bir kez. Okunamazsa null. */
export const liveOpenTickets = cache(async (): Promise<number | null> => {
  const { count, error } = await createAdminClient()
    .from("support_tickets")
    .select("id", { count: "exact", head: true })
    .in("status", [...TICKET_OPEN_STATUSES]);
  if (error) {
    console.error("admin badges open tickets", error.code);
    return null;
  }
  return count ?? 0;
});

/** Role göre görünür rozetleri döndürür; ilgisiz olanları 0'lar. */
export async function getAdminBadges(modules: readonly string[]): Promise<AdminBadges> {
  const wantsTickets = modules.includes("tickets");
  const [all, tickets] = await Promise.all([cachedBadges(), wantsTickets ? liveOpenTickets() : Promise.resolve(0)]);
  const has = (m: string) => modules.includes(m);
  return {
    tickets: wantsTickets ? (tickets ?? 0) : 0,
    risk: has("tenants") ? all.risk : 0,
    approvals: has("billing") || has("tenants") || has("personel") ? all.approvals : 0,
    payments: has("billing") ? all.payments : 0,
    kvkk: wantsTickets ? all.kvkk : 0,
  };
}

/** Platform sağlık kartı verisi (30 sn önbellekli, rozetlerle aynı sorgu turu) + operasyon hazırlık sinyalleri (60 sn). */
export async function getAdminHealth(): Promise<AdminHealth> {
  const [base, readiness] = await Promise.all([cachedBadges(), getOpsReadinessSignals().catch(() => null)]);
  return { ...base.health, readiness };
}
