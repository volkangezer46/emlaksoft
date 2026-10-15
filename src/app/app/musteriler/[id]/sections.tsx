/**
 * Müşteri 360'ın AKAN kuyruk bölümleri.
 *
 * NEDEN: `page.tsx` tek bir 22 sorguluk `Promise.all` ile açılıyordu. Sorgular
 * paralel olsa da ilk boyama EN YAVAŞINI bekliyordu — ve en yavaşları sayfanın
 * EN ALTINDAKİ iki bölümdü: aday portföylerin `features` JSONB'siyle çekildiği
 * eşleştirme widget'ı ile anket + sunum sorguları.
 *
 * ÇÖZÜM: bu iki bölüm kendi `<Suspense>` sınırlarına alındı, sorguları da
 * buraya taşındı. Künye ve sekmeler artık onları beklemiyor.
 */
import { createClient } from "@/lib/supabase/server";
import type { MatchDemand } from "@/lib/matching";
import { loadDemandMatches } from "@/lib/match-candidates";
import { now as clockNow } from "@/lib/clock";
import { MatchedPropertiesWidget } from "./matched-properties-widget";
import {
  CustomerSatisfactionSection,
  type CustomerPresentationRow,
  type CustomerSurveyRow,
} from "./customer-satisfaction-section";

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-[var(--radius-panel)] bg-ink-950/[0.06] ${className}`} aria-hidden />;
}

export const MatchedSkeleton = () => <Skeleton className="h-56" />;

type ActiveDemand = { id: string }[];

const DEMAND_MATCH_COLS =
  "id, transaction_type, property_type, province_id, district_id, neighborhood_id, budget_min, budget_max, rooms, min_sqm, urgency, status, criteria";

/**
 * Portföy öneri widget'ı — TEK eşleşme okuyucusu (src/lib/match-candidates.ts, CRM-G3): talep detayı ve Eşleşme
 * sekmesiyle aynı aday sorgusu (il/işlem türüyle daraltılmış, kırpma bayraklı), aynı eşik, müşteri geri bildirimi
 * (beğenmedi gizlenir, beğendi +10) ve eşleşme durumu ("uygun değil" gizlenir, gönderim rozeti).
 * Talep satırları burada GERÇEK değerleriyle (ilçe, mahalle, kriterler) yeniden okunur; sayfanın taşıdığı kısa
 * talep listesinden yalnız kimlikler kullanılır.
 */
export async function MatchedSection({ demands, customerId }: { demands: ActiveDemand; customerId?: string }) {
  if (demands.length === 0) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("customer_demands")
    .select(DEMAND_MATCH_COLS)
    .in("id", demands.map((d) => d.id))
    .in("status", ["new", "active"]);
  const rows = ((data ?? []) as unknown as MatchDemand[]).map((d) => ({
    ...d,
    budget_min: d.budget_min != null ? Number(d.budget_min) : null,
    budget_max: d.budget_max != null ? Number(d.budget_max) : null,
    min_sqm: d.min_sqm != null ? Number(d.min_sqm) : null,
  }));
  if (rows.length === 0) return null;
  const result = await loadDemandMatches(supabase, { demands: rows, customerOf: () => customerId ?? null });

  return (
    <MatchedPropertiesWidget
      demandCount={rows.length}
      pairs={result.pairs}
      openedTokens={result.openedTokens}
      hiddenCount={result.hiddenByFeedback + result.hiddenDismissed}
      truncated={result.truncated}
      customerId={customerId}
      nowMs={clockNow()}
    />
  );
}

/**
 * Memnuniyet & Paylaşımlar — anket (migration 104) + sunum (migration 113).
 * İkisi de boşsa bileşen kendini gizler; bu yüzden fallback'i de yok.
 */
export async function SatisfactionSection({ customerId, appUrl }: { customerId: string; appUrl: string }) {
  const supabase = await createClient();
  const [{ data: surveysData }, { data: presentationsData }] = await Promise.all([
    supabase
      .from("surveys")
      .select("id, score, status, comment, public_token, sent_at, answered_at")
      .eq("customer_id", customerId)
      .order("sent_at", { ascending: false })
      .limit(10),
    supabase
      .from("presentations")
      .select("id, title, public_token, property_ids, view_count, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const presentations: CustomerPresentationRow[] = (presentationsData ?? []).map((p) => ({
    id: p.id as string,
    title: p.title as string,
    public_token: p.public_token as string,
    property_count: ((p.property_ids as string[] | null) ?? []).length,
    view_count: Number(p.view_count ?? 0),
    created_at: p.created_at as string,
  }));

  return (
    <CustomerSatisfactionSection
      surveys={(surveysData ?? []) as CustomerSurveyRow[]}
      presentations={presentations}
      appUrl={appUrl}
    />
  );
}
