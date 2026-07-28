/**
 * Müşteri 360'ın AKAN kuyruk bölümleri.
 *
 * NEDEN: `page.tsx` tek bir 22 sorguluk `Promise.all` ile açılıyordu. Sorgular
 * paralel olsa da ilk boyama EN YAVAŞINI bekliyordu — ve en yavaşları sayfanın
 * EN ALTINDAKİ iki bölümdü: 100 aktif portföyün `features` JSONB'siyle çekildiği
 * eşleştirme widget'ı ile anket + sunum sorguları.
 *
 * ÇÖZÜM: bu iki bölüm kendi `<Suspense>` sınırlarına alındı, sorguları da
 * buraya taşındı. Künye ve sekmeler artık onları beklemiyor.
 * Görünüm/davranış aynı: bileşenler ve props'ları değişmedi.
 */
import { createClient } from "@/lib/supabase/server";
import { fetchTenantMatchingWeights, type MatchProperty } from "@/lib/matching";
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

type ActiveDemand = Parameters<typeof MatchedPropertiesWidget>[0]["demands"];

/**
 * Portföy öneri widget'ı — aday portföyler + ofise özel eşleştirme ağırlıkları.
 * Sayfanın en pahalı sorgusu (100 satır, `features` JSONB dahil) buradaydı.
 */
export async function MatchedSection({ demands }: { demands: ActiveDemand }) {
  const supabase = await createClient();
  const [{ data: propertiesForMatch }, weights] = await Promise.all([
    supabase
      .from("properties")
      .select("id, property_code, title, transaction_type, property_type, status, list_price, province_id, district_id, features")
      .is("deleted_at", null)
      .in("status", ["live", "draft", "Yayında"])
      .order("created_at", { ascending: false })
      .limit(100),
    fetchTenantMatchingWeights(supabase),
  ]);

  const properties = (propertiesForMatch ?? []).map((p) => ({
    ...p,
    list_price: p.list_price != null ? Number(p.list_price) : null,
    features: (p.features ?? {}) as MatchProperty["features"],
  })) as MatchProperty[];

  return <MatchedPropertiesWidget demands={demands} properties={properties} weights={weights} />;
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
