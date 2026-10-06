import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import { CRON_JOBS } from "@/lib/cron-jobs";

const KNOWN_JOBS: ReadonlySet<string> = new Set(CRON_JOBS.map((j) => j.job));

export type AdminBadges = { tickets: number; risk: number; sales: number };

/** Yan menü "SİSTEM" kartı: ölçülen gerçek değerler (uydurma kesintisiz süre/doluluk YOK). */
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
};

/**
 * Admin sidebar rozet sayaçları — HER admin sayfa yüklemesinde çalışıyordu (3
 * count sorgusu). Bunlar operasyonel bilgi; saniye-taze olmak zorunda değil.
 * `unstable_cache` ile 30 sn platform-genel önbellek: gezinmelerin çoğu artık
 * bu 3 sorguyu hiç yapmadan servis edilir. Service-role client kullanır (cookie
 * yok) → önbelleklenebilir; kullanıcıya özel veri taşımaz (platform geneli).
 */
const cachedBadges = unstable_cache(
  async (): Promise<AdminBadges & { health: AdminHealth }> => {
    const admin = createAdminClient();
    const t0 = now();
    const [ticketRes, riskRes, salesRes, cronRes] = await Promise.all([
      admin.from("support_tickets").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress", "waiting"]),
      admin.from("tenants").select("id", { count: "exact", head: true }).in("status", ["past_due", "suspended"]),
      admin.from("demo_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
      admin.from("cron_heartbeats").select("job, last_status, last_run_at"),
    ]);
    const dbMs = Math.max(0, now() - t0);
    const allCronRows = cronRes.error ? null : (cronRes.data ?? []);
    // Yalnız vercel.json'daki (CRON_JOBS) işler sayılır; eski/silinmiş heartbeat adları ayrı not.
    const cronRows = allCronRows ? allCronRows.filter((r) => KNOWN_JOBS.has(String(r.job))) : null;
    const unknownJobs = allCronRows
      ? allCronRows.filter((r) => !KNOWN_JOBS.has(String(r.job))).map((r) => String(r.job))
      : [];
    return {
      tickets: ticketRes.count ?? 0,
      risk: riskRes.count ?? 0,
      sales: salesRes.count ?? 0,
      health: {
        dbMs,
        ok: !ticketRes.error && !riskRes.error && !salesRes.error,
        cronTotal: cronRows ? cronRows.length : null,
        cronErrors: cronRows ? cronRows.filter((r) => r.last_status === "error").length : null,
        failedJobs: cronRows ? cronRows.filter((r) => r.last_status === "error").map((r) => String(r.job)).slice(0, 3) : [],
        unknownJobs: unknownJobs.slice(0, 5),
        lastCronAt: cronRows && cronRows.length ? cronRows.map((r) => String(r.last_run_at)).sort().at(-1) ?? null : null,
        checkedAt: now(),
      },
    };
  },
  ["admin-sidebar-badges-v5"],
  { revalidate: 30, tags: ["admin-badges"] },
);

/** Role göre görünür rozetleri döndürür; ilgisiz olanları 0'lar (sorgu yine tek cache'ten gelir). */
export async function getAdminBadges(modules: readonly string[]): Promise<AdminBadges> {
  const { health: _health, ...all } = await cachedBadges();
  void _health;
  return {
    tickets: modules.includes("tickets") ? all.tickets : 0,
    risk: modules.includes("tenants") ? all.risk : 0,
    sales: modules.includes("sales") ? all.sales : 0,
  };
}

/** Platform sağlık kartı verisi (30 sn önbellekli, rozetlerle aynı sorgu turu). */
export async function getAdminHealth(): Promise<AdminHealth> {
  return (await cachedBadges()).health;
}
