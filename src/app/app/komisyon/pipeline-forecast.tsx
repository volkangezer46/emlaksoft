import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings/read";
import { DEFAULT_COMMISSION_RATE } from "@/lib/commission";
import { buildPipelineForecast, LOOKBACK_DAYS, MIN_CLOSED } from "@/lib/forecast/pipeline";
import { formatTry } from "@/lib/format";
import { now } from "@/lib/clock";

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/**
 * Komisyon merkezi: açık satış hattının olasılık ağırlıklı komisyon TAHMİNİ (ofis geneli; yalnız tüm kazancı görebilenler).
 * Veri yetersizse kart "tahmin için yeterli geçmiş yok" der, sayı göstermez. Yöntem `src/lib/forecast/pipeline.ts`.
 */
export async function PipelineForecastCard({ tenantId }: { tenantId: string }) {
  const supabase = await createClient();
  const sinceIso = new Date(now() - LOOKBACK_DAYS * 2 * 86_400_000).toISOString();
  const [{ data, error }, settings] = await Promise.all([
    supabase
      .from("deals")
      .select("deal_type, stage, deal_value, created_at, updated_at")
      .eq("tenant_id", tenantId)
      .eq("is_sample", false)
      .or(`stage.not.in.(won,lost),updated_at.gte.${sinceIso}`)
      .limit(5000),
    getSettings(["office.commission.default_rate"], { tenantId }),
  ]);
  if (error) return null;
  const ratePct = Number(settings["office.commission.default_rate"] ?? DEFAULT_COMMISSION_RATE) || DEFAULT_COMMISSION_RATE;
  const r = buildPipelineForecast(
    ((data ?? []) as { deal_type: string; stage: string; deal_value: number | string | null; created_at: string; updated_at: string }[]).map((d) => ({
      dealType: d.deal_type,
      stage: d.stage,
      dealValue: d.deal_value != null ? Number(d.deal_value) : null,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    })),
    now(),
    ratePct,
  );

  return (
    <section aria-labelledby="pipeline-tahmin" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pipeline-tahmin" className="flex items-center gap-2 font-display font-bold text-ink-950">
          <TrendingUp className="h-4 w-4 text-brand-600" aria-hidden /> Satış hattı komisyon tahmini
        </h2>
        <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-xs font-bold text-amber-700">Tahmin</span>
      </div>
      {!r.ok ? (
        <p className="mt-2 text-sm text-text-muted">
          {r.reason} Şu an: {r.closed} kapanış. Kaybedilen anlaşmaları &quot;kayıp&quot; olarak işaretlemek tahmini mümkün kılar.
        </p>
      ) : (
        <>
          <Link href="/app/anlasmalar?gorunum=liste&asama=acik" className="focus-ring mt-2 block rounded-[var(--radius-control)]">
            <p className="font-display text-2xl font-extrabold text-ink-950">{formatTry(r.total)}</p>
            <p className="text-xs text-text-muted">
              {r.valuedCount} açık anlaşmadan beklenen komisyon (komisyon oranı %{r.commissionRatePct})
            </p>
          </Link>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {r.months.map((m) => (
              <div key={m.key} className="rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2">
                <p className="text-xs text-text-muted">{monthLabel(m.key)}</p>
                <p className="text-sm font-semibold text-ink-950">{formatTry(m.amount)}</p>
              </div>
            ))}
            <div className="rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2">
              <p className="text-xs text-text-muted">Sonrası</p>
              <p className="text-sm font-semibold text-ink-950">{formatTry(r.later)}</p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-text-faint">
            Yöntem: son 12 ayın kazanma oranı{" "}
            {r.winRates.map((w) => `${w.dealType === "rent" ? "kiralama" : "satış"} %${Math.round(w.rate * 100)} (${w.closed} kapanış)`).join(", ")}
            {r.medianCycleDays != null ? `; medyan kapanış süresi ${r.medianCycleDays} gün` : ""}. Aşama bazlı olasılık kullanılmaz (aşama geçmişi tutulmuyor).
            {r.excludedNoValue > 0 ? ` Tutarı girilmemiş ${r.excludedNoValue} anlaşma dahil değil.` : ""}
            {r.excludedLowData > 0 ? ` En az ${MIN_CLOSED} kapanışı olmayan türdeki ${r.excludedLowData} anlaşma dahil değil.` : ""}
          </p>
        </>
      )}
    </section>
  );
}
