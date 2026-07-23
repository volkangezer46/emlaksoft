/**
 * Ofis sağlık skoru v1 — 0–100.
 * Ağırlıklar: portal teyit sağlığı, açık talep, eşleşme potansiyeli, randevu, kapanış disiplini.
 */
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
