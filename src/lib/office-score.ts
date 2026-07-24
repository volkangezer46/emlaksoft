/**
 * Ofis sağlık skoru v1 — 0–100.
 * Ağırlıklar: portal teyit sağlığı, açık talep, eşleşme potansiyeli, randevu, kapanış disiplini.
 */
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type OfficeScoreInputs = {
  openDemands: number;
  livePortals: number;
  overdueConfirmations: number;
  closures30d: number;
  appointments7d: number;
  calls7d: number;
};

export function computeOfficeScore(input: OfficeScoreInputs): {
  score: number;
  label: string;
} {
  let score = 42;

  score += Math.min(18, input.openDemands * 4);
  score += Math.min(16, input.livePortals * 3);
  score += Math.min(12, input.appointments7d * 3);
  score += Math.min(10, input.calls7d * 2);
  score += Math.min(12, input.closures30d * 4);

  // Gecikmiş teyit cezası
  score -= Math.min(28, input.overdueConfirmations * 7);

  score = Math.max(0, Math.min(100, Math.round(score)));

  const label =
    score >= 80 ? "Güçlü" : score >= 60 ? "İyi" : score >= 40 ? "Orta" : "Riskli";

  return { score, label };
}

/**
 * İstek başına tek kez hesaplanan ofis skoru. Layout (her navigasyonda) ve
 * dashboard aynı istekte çağırınca 5 sorgu tekrar etmez (React `cache()`).
 */
export const getCachedOfficeScore = cache(async () => {
  const supabase = await createClient();
  const inputs = await loadOfficeScoreInputs(supabase);
  return computeOfficeScore(inputs);
});

/** Belirli bir tenant için ofis skoru girdileri — admin client + açık tenant filtresi
 *  (RLS'siz ortamda, ör. unstable_cache içinde çalışabilmesi için). */
async function loadOfficeScoreInputsForTenant(tenantId: string): Promise<OfficeScoreInputs> {
  const admin = createAdminClient();
  const now = Date.now();
  const d7 = new Date(now - 7 * 86_400_000).toISOString();
  const d30 = new Date(now - 30 * 86_400_000).toISOString();

  const [
    { count: openDemands },
    { data: portals },
    { count: closures30d },
    { count: appointments7d },
    { count: calls7d },
  ] = await Promise.all([
    admin.from("customer_demands").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).in("status", ["new", "active", "matched"]),
    admin.from("portal_listings").select("id, status, last_confirmed_at").eq("tenant_id", tenantId).eq("status", "live").limit(500),
    admin.from("listing_closures").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("created_at", d30),
    admin.from("appointments").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("scheduled_at", d7),
    admin.from("calls").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("started_at", d7),
  ]);

  const livePortals = portals?.length ?? 0;
  const overdueConfirmations = (portals ?? []).filter((p: { last_confirmed_at: string | null }) => {
    if (!p.last_confirmed_at) return true;
    return p.last_confirmed_at < d7;
  }).length;

  return {
    openDemands: openDemands ?? 0,
    livePortals,
    overdueConfirmations,
    closures30d: closures30d ?? 0,
    appointments7d: appointments7d ?? 0,
    calls7d: calls7d ?? 0,
  };
}

/**
 * Navigasyonlar arası cache'li ofis skoru (tenant başına, 3 dk).
 * app layout her navigasyonda çağırıyor; cache sayesinde 5 sorgu her seferinde
 * çalışmaz. Cache anahtarı tenantId içerdiğinden çapraz-ofis sızıntısı yoktur.
 */
export function getOfficeScoreCached(tenantId: string) {
  return unstable_cache(
    async () => computeOfficeScore(await loadOfficeScoreInputsForTenant(tenantId)),
    ["office-score", tenantId],
    { revalidate: 180, tags: [`office-score:${tenantId}`] },
  )();
}

export async function loadOfficeScoreInputs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<OfficeScoreInputs> {
  const now = Date.now();
  const d7 = new Date(now - 7 * 86_400_000).toISOString();
  const d30 = new Date(now - 30 * 86_400_000).toISOString();
  const confirmDue = new Date(now - 7 * 86_400_000).toISOString();

  const [
    { count: openDemands },
    { data: portals },
    { count: closures30d },
    { count: appointments7d },
    { count: calls7d },
  ] = await Promise.all([
    supabase
      .from("customer_demands")
      .select("id", { count: "exact", head: true })
      .in("status", ["new", "active", "matched"]),
    supabase
      .from("portal_listings")
      .select("id, status, last_confirmed_at")
      .eq("status", "live")
      .limit(500),
    supabase
      .from("listing_closures")
      .select("id", { count: "exact", head: true })
      .gte("created_at", d30),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .gte("scheduled_at", d7),
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .gte("started_at", d7),
  ]);

  const livePortals = portals?.length ?? 0;
  const overdueConfirmations = (portals ?? []).filter((p: { last_confirmed_at: string | null }) => {
    if (!p.last_confirmed_at) return true;
    return p.last_confirmed_at < confirmDue;
  }).length;

  return {
    openDemands: openDemands ?? 0,
    livePortals,
    overdueConfirmations,
    closures30d: closures30d ?? 0,
    appointments7d: appointments7d ?? 0,
    calls7d: calls7d ?? 0,
  };
}
