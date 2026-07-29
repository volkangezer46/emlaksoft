import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export type AdminBadges = { tickets: number; risk: number; sales: number };

/**
 * Admin sidebar rozet sayaçları — HER admin sayfa yüklemesinde çalışıyordu (3
 * count sorgusu). Bunlar operasyonel bilgi; saniye-taze olmak zorunda değil.
 * `unstable_cache` ile 30 sn platform-genel önbellek: gezinmelerin çoğu artık
 * bu 3 sorguyu hiç yapmadan servis edilir. Service-role client kullanır (cookie
 * yok) → önbelleklenebilir; kullanıcıya özel veri taşımaz (platform geneli).
 */
const cachedBadges = unstable_cache(
  async (): Promise<AdminBadges> => {
    const admin = createAdminClient();
    const [ticketRes, riskRes, salesRes] = await Promise.all([
      admin.from("support_tickets").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress", "waiting"]),
      admin.from("tenants").select("id", { count: "exact", head: true }).in("status", ["past_due", "suspended"]),
      admin.from("demo_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
    ]);
    return {
      tickets: ticketRes.count ?? 0,
      risk: riskRes.count ?? 0,
      sales: salesRes.count ?? 0,
    };
  },
  ["admin-sidebar-badges"],
  { revalidate: 30, tags: ["admin-badges"] },
);

/** Role göre görünür rozetleri döndürür; ilgisiz olanları 0'lar (sorgu yine tek cache'ten gelir). */
export async function getAdminBadges(modules: readonly string[]): Promise<AdminBadges> {
  const all = await cachedBadges();
  return {
    tickets: modules.includes("tickets") ? all.tickets : 0,
    risk: modules.includes("tenants") ? all.risk : 0,
    sales: modules.includes("sales") ? all.sales : 0,
  };
}
