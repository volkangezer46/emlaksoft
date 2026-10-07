import { Activity } from "lucide-react";
import { ChartCard } from "@/components/ui/chart-frame";
import { AreaTrendChart } from "@/components/ui/lazy-charts";
import { EmptyState } from "@/components/ui/empty-state";
import { daysAgoIso, now } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { dailyCounts } from "./trend";

/** Kaynak başına tarama tavanı: tavana ulaşan seri kırpık olabilir → eğri çizilmez (uydurma yok). */
const SCAN_LIMIT = 1000;

/**
 * SON 30 GÜN AKTİVİTE EĞRİSİ (Performansım): kişinin KENDİ çağrı (handled_by), randevu (assigned_to) ve teklif
 * (created_by) kayıtlarının günlük toplamı. Yalnız tarih kolonları çekilir; RLS + açık kişi süzgeci. Bir kaynak tavana
 * ulaşırsa ya da sorgu hata verirse eğri çizilmez, bunun yerine dürüst bir not gösterilir.
 */
export async function Son30Gun({ userId }: { userId: string }) {
  const supabase = await createClient();
  const since = daysAgoIso(30);
  const [calls, appts, offers] = await Promise.all([
    supabase.from("calls").select("started_at").eq("handled_by", userId).gte("started_at", since).limit(SCAN_LIMIT),
    supabase.from("appointments").select("scheduled_at").eq("assigned_to", userId).gte("scheduled_at", since).limit(SCAN_LIMIT),
    supabase.from("offers").select("created_at").eq("created_by", userId).gte("created_at", since).limit(SCAN_LIMIT),
  ]);
  const failed = Boolean(calls.error || appts.error || offers.error);
  const capped = [calls.data, appts.data, offers.data].some((d) => (d?.length ?? 0) >= SCAN_LIMIT);
  const dates = [
    ...(calls.data ?? []).map((r) => r.started_at as string),
    ...(appts.data ?? []).map((r) => r.scheduled_at as string),
    ...(offers.data ?? []).map((r) => r.created_at as string),
  ];
  const series = failed || capped ? null : dailyCounts(dates, now(), 30);
  const total = series ? series.reduce((s, p) => s + p.value, 0) : 0;

  return (
    <ChartCard
      as="h2"
      title="Son 30 gün aktivite"
      subtitle="Günlük arama, randevu ve teklif"
      icon={Activity}
      tone="brand"
      href="/app/performansim?sekme=aktivite"
      hrefLabel="Etkinlikler"
      height={0}
      className="h-full"
    >
      {series ? (
        <>
          <p className="text-sm tabular-nums text-text-muted">
            <span className="ds-num text-lg text-text">{total.toLocaleString("tr-TR")}</span> kayıt · son 30 gün
          </p>
          <div className="mt-3 h-44">
            <AreaTrendChart
              data={series.map((p) => ({ label: p.label, value: p.value }))}
              tone="brand"
              format="number"
              name="Aktivite"
              ariaLabel="Son 30 gün günlük çağrı, randevu ve teklif toplamı"
            />
          </div>
        </>
      ) : (
        <EmptyState
          variant="compact"
          illustration="rapor"
          title={failed ? "Aktivite verisi şu an okunamadı" : capped ? "Kayıt sayısı tarama sınırını aştı" : "Son 30 günde aktivite yok"}
          description={failed || capped ? "Ayrıntı Etkinlikler sekmesinde." : "Çağrı, randevu ve teklif kaydı oluştukça günlük eğri burada çizilir."}
        />
      )}
    </ChartCard>
  );
}
