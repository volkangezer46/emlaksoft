import Link from "@/components/ui/smart-link";
import { HandCoins } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { daysAgoIso, now, trParts } from "@/lib/clock";
import { formatTry } from "@/lib/format";
import { getSettings } from "@/lib/settings/read";
import { DEFAULT_COMMISSION_RATE } from "@/lib/commission";
import { buildPipelineForecast, LOOKBACK_DAYS, MIN_CLOSED } from "@/lib/forecast/pipeline";
import { earningInRange, fetchCommissionRows, trYearPeriod } from "@/lib/team/advisor-metrics";
import { summarizeAdvisorEarning } from "@/lib/team/advisor-share";

/**
 * KOMİSYONUM (Performansım): bekleyen pay · bu yıl tahsil edilen pay · açık anlaşmalardan TAHMİNİ brüt komisyon — tek kart.
 * Kazanç gizliliği: yalnız oturum açanın KENDİ payı (`fetchCommissionRows` seeAll=false; owner/gm dahil başkasının satırı
 * çekilmez). Pay hesabı Cüzdan ile aynı (`advisorShare`). Tahmin `buildPipelineForecast` ile, yalnız kendi anlaşmalarından;
 * son 12 ayda en az 10 kapanış yoksa sayı gösterilmez ("tahmin" etiketli, paylaşım öncesi BRÜT).
 */
export async function Komisyonum({ userId, tenantId, officeWide }: { userId: string; tenantId: string | null; officeWide: boolean }) {
  if (!tenantId) return null;
  const supabase = await createClient();
  const nowMs = now();
  const sinceIso = daysAgoIso(LOOKBACK_DAYS * 2);
  const [{ data: profile }, commission, dealsRes, settings] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    fetchCommissionRows(supabase, { tenantId, viewerId: userId, seeAll: false, limit: 1000 }),
    // max_rows (1000) sınırı: sayfalı okuma; eksikse (error) tahmin gösterilmez.
    fetchAllRows<{ deal_type: string; stage: string; deal_value: number | string | null; created_at: string; updated_at: string }>((from, to) =>
      supabase
        .from("deals")
        .select("id, deal_type, stage, deal_value, created_at, updated_at")
        .eq("tenant_id", tenantId)
        .eq("assigned_to", userId)
        .eq("is_sample", false)
        .or(`stage.not.in.(won,lost),updated_at.gte.${sinceIso}`)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    getSettings(["office.commission.default_rate"], { tenantId }),
  ]);
  if (commission.error) return null;
  const fullName = (profile?.full_name as string | undefined) ?? null;
  const all = summarizeAdvisorEarning(commission.rows, fullName, userId);
  const year = earningInRange(commission.rows, trYearPeriod(trParts(nowMs).year), fullName, userId);
  const ratePct = Number(settings["office.commission.default_rate"] ?? DEFAULT_COMMISSION_RATE) || DEFAULT_COMMISSION_RATE;
  const forecast = dealsRes.error
    ? null
    : buildPipelineForecast(
        ((dealsRes.data ?? []) as { deal_type: string; stage: string; deal_value: number | string | null; created_at: string; updated_at: string }[]).map((d) => ({
          dealType: d.deal_type,
          stage: d.stage,
          dealValue: d.deal_value != null ? Number(d.deal_value) : null,
          createdAt: d.created_at,
          updatedAt: d.updated_at,
        })),
        nowMs,
        ratePct,
      );
  if (all.count === 0 && (!forecast || (forecast.ok ? forecast.openCount === 0 : forecast.closed === 0))) return null;
  const openDealsHref = `/app/anlasmalar?gorunum=liste&asama=acik${officeWide ? `&danisman=${userId}` : ""}`;

  const tile = "focus-ring flex min-h-[5.5rem] flex-col justify-center rounded-[var(--radius-control)] border border-line px-4 py-3 hover:border-brand-400";
  return (
    <section aria-labelledby="komisyonum-baslik" className="ds-card ds-pad">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="komisyonum-baslik" className="flex items-center gap-2 font-display font-bold text-ink-950">
          <HandCoins className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" /> Komisyonum
        </h2>
        <Link href="/app/cuzdan" className="focus-ring rounded-[var(--radius-control)] px-1 text-xs font-semibold text-[var(--accent-text)]">
          Kazanç dökümü
        </Link>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Link href="/app/cuzdan" className={tile}>
          <span className="text-xs text-text-muted">Bekleyen payım</span>
          <span className="text-xl font-bold tabular-nums text-ink-950">{formatTry(all.pending)}</span>
          <span className="text-xs text-text-faint">Müşteriden tahsil bekleyen</span>
        </Link>
        <Link href="/app/cuzdan" className={tile}>
          <span className="text-xs text-text-muted">Tahsil edilen · bu yıl</span>
          <span className="text-xl font-bold tabular-nums text-ink-950">{formatTry(year.collected)}</span>
          <span className="text-xs text-text-faint">Payına düşen</span>
        </Link>
        <Link href={openDealsHref} className={tile}>
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            Tahmini (brüt) <span className="rounded-full bg-amber-400/15 px-1.5 text-xs font-bold text-amber-700">Tahmin</span>
          </span>
          {forecast?.ok ? (
            <>
              <span className="text-xl font-bold tabular-nums text-ink-950">{formatTry(forecast.total)}</span>
              <span className="text-xs text-text-faint">{forecast.valuedCount} açık anlaşma · kazanma oranın × %{forecast.commissionRatePct}</span>
            </>
          ) : (
            <span className="text-xs text-text-muted">
              Tahmin için son 12 ayda en az {MIN_CLOSED} kapanışın gerekir{forecast && !forecast.ok ? ` (şu an ${forecast.closed})` : ""}.
            </span>
          )}
        </Link>
      </div>
      <p className="mt-2 text-xs text-text-faint">Tahmin paylaşım öncesi brüt komisyondur; payın anlaşma kapanınca komisyon paylaşımıyla kesinleşir.</p>
    </section>
  );
}
