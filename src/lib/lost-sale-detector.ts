import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";

export type LostSaleLead = {
  id:         string;
  full_name:  string;
  phone:      string | null;
  reason:     "no_follow_up" | "no_match_sent" | "no_call" | "overdue_demand";
  reasonLabel: string;
  daysSince:  number;
  urgency:    "critical" | "warning";
};

/**
 * Kayıp satış riski taşıyan müşterileri tespit eder.
 * 
 * Kriterler:
 * 1. Son 14+ gün hiç çağrı/iletişim kaydı yok (aktif talep varken)
 * 2. Aktif talebi olan ama hiç portföy eşleşmesi gönderilmemiş müşteriler
 * 3. 30+ gün önce oluşturulan ama hâlâ "new" statüsünde talepler
 */
export async function detectLostSaleRisks(limit = 20): Promise<LostSaleLead[]> {
  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const now = Date.now();
  const day = 86_400_000;

  // Aktif talepleri olan müşterileri çek
  const { data: activeCustomers } = await supabase
    .from("customers")
    .select("id, full_name, phone, created_at")
    .is("deleted_at", null)
    .eq("tenant_id", gate.tenantId)
    .limit(200);

  if (!activeCustomers?.length) return [];

  const customerIds = activeCustomers.map((c) => c.id);

  // Son iletişim tarihleri (calls + communications birleşik)
  const [{ data: calls }, { data: comms }, { data: demands }, { data: matches }] = await Promise.all([
    supabase
      .from("calls")
      .select("customer_id, started_at")
      .in("customer_id", customerIds)
      .order("started_at", { ascending: false }),
    supabase
      .from("communications")
      .select("customer_id, created_at")
      .in("customer_id", customerIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("customer_demands")
      .select("customer_id, status, created_at")
      .in("customer_id", customerIds)
      .neq("status", "closed"),
    supabase
      .from("matches")
      .select("customer_id, created_at")
      .in("customer_id", customerIds)
      .order("created_at", { ascending: false }),
  ]);

  // customer bazında grupla
  const lastCallMap   = new Map<string, number>();
  const lastCommMap   = new Map<string, number>();
  const demandMap     = new Map<string, { status: string; created_at: string }[]>();
  const lastMatchMap  = new Map<string, number>();

  for (const c of calls ?? []) {
    if (!lastCallMap.has(c.customer_id)) {
      lastCallMap.set(c.customer_id, new Date(c.started_at).getTime());
    }
  }
  for (const c of comms ?? []) {
    if (!lastCommMap.has(c.customer_id)) {
      lastCommMap.set(c.customer_id, new Date(c.created_at).getTime());
    }
  }
  for (const d of demands ?? []) {
    const arr = demandMap.get(d.customer_id) ?? [];
    arr.push({ status: d.status, created_at: d.created_at });
    demandMap.set(d.customer_id, arr);
  }
  for (const m of matches ?? []) {
    if (!lastMatchMap.has(m.customer_id)) {
      lastMatchMap.set(m.customer_id, new Date(m.created_at).getTime());
    }
  }

  const risks: LostSaleLead[] = [];

  for (const customer of activeCustomers) {
    const customerDemands = demandMap.get(customer.id) ?? [];
    if (!customerDemands.length) continue; // aktif talebi yok, atla

    const lastCall  = lastCallMap.get(customer.id);
    const lastComm  = lastCommMap.get(customer.id);
    const lastTouch = Math.max(lastCall ?? 0, lastComm ?? 0);
    const lastMatch = lastMatchMap.get(customer.id);
    const daysSinceTouch = lastTouch ? Math.floor((now - lastTouch) / day) : 999;
    const daysSinceMatch = lastMatch ? Math.floor((now - lastMatch) / day) : 999;

    // Kural 1: 14+ gün dokunulmamış, aktif talep var
    if (daysSinceTouch >= 14) {
      risks.push({
        id:          customer.id,
        full_name:   customer.full_name,
        phone:       customer.phone ?? null,
        reason:      "no_follow_up",
        reasonLabel: `${daysSinceTouch} gündür iletişim yok`,
        daysSince:   daysSinceTouch,
        urgency:     daysSinceTouch >= 30 ? "critical" : "warning",
      });
      continue;
    }

    // Kural 2: Hiç eşleşme gönderilmemiş veya 21+ gün önce
    if (daysSinceMatch >= 21) {
      risks.push({
        id:          customer.id,
        full_name:   customer.full_name,
        phone:       customer.phone ?? null,
        reason:      "no_match_sent",
        reasonLabel: lastMatch ? `${daysSinceMatch} gündür portföy gönderilmedi` : "Hiç portföy gönderilmedi",
        daysSince:   daysSinceMatch,
        urgency:     !lastMatch ? "critical" : "warning",
      });
      continue;
    }

    // Kural 3: 30+ günlük "new" talep
    const staleNew = customerDemands.find(
      (d) => d.status === "new" &&
        Math.floor((now - new Date(d.created_at).getTime()) / day) >= 30,
    );
    if (staleNew) {
      const days = Math.floor((now - new Date(staleNew.created_at).getTime()) / day);
      risks.push({
        id:          customer.id,
        full_name:   customer.full_name,
        phone:       customer.phone ?? null,
        reason:      "overdue_demand",
        reasonLabel: `${days} gündür "yeni" statüsünde talep`,
        daysSince:   days,
        urgency:     days >= 60 ? "critical" : "warning",
      });
    }
  }

  // Aciliyete ve süreye göre sırala
  return risks
    .sort((a, b) => {
      if (a.urgency !== b.urgency) return a.urgency === "critical" ? -1 : 1;
      return b.daysSince - a.daysSince;
    })
    .slice(0, limit);
}

/** Tahmini kayıp ciro (basit hesap: müşteri başı ortalama 500K TL × kayıp oranı) */
export function estimateLostRevenue(risks: LostSaleLead[]): number {
  const critical = risks.filter((r) => r.urgency === "critical").length;
  const warning  = risks.filter((r) => r.urgency === "warning").length;
  // Kaba tahmin — gerçek veri yokken
  return (critical * 500_000 + warning * 200_000) * 0.02; // %2 komisyon
}
