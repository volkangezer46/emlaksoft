import Link from "@/components/ui/smart-link";
import { BarChart3, Filter, PieChart, Trophy } from "lucide-react";
import { KpiGrid } from "@/components/ui/dashboard-grid";
import { KpiCard, computeTrend } from "@/components/ui/premium";
import { EmptyStateV3 } from "@/components/ui/empty-state";
import { createClient } from "@/lib/supabase/server";
import { getDefinitionsOrDefault, getLossReasonOptions, toLabelMap } from "@/lib/definitions";
import { lossReasonGroupLabel, lossReasonLabels } from "@/lib/loss-reason";
import { defaultLabelMap } from "@/lib/definition-defaults";
import { ICONS } from "@/lib/icons";
import { rangeLabel, periodScopeParams, periodScopeRpcArgs } from "@/lib/report-center/period-scope";
import { RankBars } from "../rank-bars";
import { shareOfTotal } from "../report-math";
import type { ReportScopeContext } from "./report-scope";

type Metrics = {
  new_customers: number;
  new_demands: number;
  new_listings: number;
  appointments: number;
  calls: number;
  offers: number;
  offers_accepted: number;
  won: number;
  won_value: number;
  lost: number;
  lost_value: number;
  commission: number | null;
};

type PeriodOverview = {
  current: Metrics;
  previous: Metrics;
  earnings_visible: boolean;
  customer_sources: { source: string; customer_count: number }[];
  roi: { source: string; customers: number; won_count: number; won_value: number }[];
  loss_reasons: { reason: string; deal_count: number; deal_value: number }[];
};

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

function qs(params: Record<string, string | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : "";
}

const SECTION = "surface-card rounded-[var(--radius-panel)] p-5";
const H2 = "font-display text-base font-bold tracking-[-0.015em] text-text";
const ICON_ACCENT = "h-4 w-4 text-accent-text";

/**
 * OA1: Dönem + kapsam performansı (report_period_overview, 20261018080002). Akış metrikleri seçili dönemde, karşılaştırma
 * aynı uzunlukta önceki dönemle. Her kart filtrelenmiş listeye gider (tarih aralığı + varsa danışman). Kaynak dağılımı,
 * kaynak ROI ve kayıp nedenleri de aynı dönem/kapsamla süzülür. Akıtılır (Suspense): üst kısım beklemez.
 */
export async function PeriodOverview({ ctx, lossRate }: { ctx: ReportScopeContext; lossRate: number }) {
  const supabase = await createClient();
  const [res, sourceDefs, lossOptions] = await Promise.all([
    supabase.rpc("report_period_overview", periodScopeRpcArgs(ctx.period, ctx.scope)),
    getDefinitionsOrDefault("customer_source"),
    getLossReasonOptions(),
  ]);
  if (res.error || !res.data) {
    return (
      <section className={SECTION} role="status">
        <p className="text-sm text-text-muted">Dönem raporu şu an okunamadı. Sayfayı yenileyin; sorun sürerse destek ekibine yazın.</p>
      </section>
    );
  }
  const data = res.data as unknown as PeriodOverview;
  const cur = data.current;
  const prev = data.previous;
  const { period, scope } = ctx;
  const n = (v: unknown) => Number(v ?? 0);
  const prevText = `Önceki dönem (${rangeLabel(period.prevFrom, period.prevTo)})`;
  const dateQ = { from: period.from, to: period.to };
  const adv = scope.profileId;
  const scopedNote = ctx.scopeLabel ? ` · ${ctx.scopeLabel}` : "";

  const SOURCE_LABELS: Record<string, string> = { ...defaultLabelMap("customer_source"), ...toLabelMap(sourceDefs) };
  const sourceLabel = (s: string) => SOURCE_LABELS[s] ?? s;
  const sourceTotal = Math.max(1, n(cur.new_customers));
  const sourceItems = data.customer_sources.slice(0, 8).map((r) => {
    const value = r.source === "Belirtilmedi" ? null : r.source;
    return {
      key: r.source,
      label: value ? sourceLabel(value) : r.source,
      href: `/app/musteriler${qs({ source: value, ...dateQ, assigned: adv })}`,
      value: n(r.customer_count),
      valueText: `${n(r.customer_count)} · %${shareOfTotal(n(r.customer_count), sourceTotal)}`,
    };
  });
  const roiRows = data.roi.map((r) => ({ source: r.source, customers: n(r.customers), wonCount: n(r.won_count), wonValue: n(r.won_value) }));
  const roiWonCount = roiRows.reduce((s, r) => s + r.wonCount, 0);
  const roiWonValue = roiRows.reduce((s, r) => s + r.wonValue, 0);
  const roiTop = roiRows.slice(0, 8);
  const bestSource = roiTop[0] && roiTop[0].wonValue > 0 ? roiTop[0].source : null;
  const roiItems = roiTop.map((r) => ({
    key: r.source,
    label: sourceLabel(r.source),
    href: `/app/musteriler${qs({ source: r.source === "Belirtilmedi" ? null : r.source, assigned: adv })}`,
    value: r.wonValue,
    valueText: `${money(r.wonValue)} · ${r.customers} yeni müşteri · ${r.wonCount} kazanılan${r.source === bestSource ? " · en değerli kaynak" : ""}`,
  }));

  const lossLabels = lossReasonLabels(lossOptions);
  const lossGroups = new Map<string, { reason: string; count: number; value: number }>();
  for (const row of data.loss_reasons) {
    const reason = lossReasonGroupLabel(row.reason, lossLabels);
    const g = lossGroups.get(reason) ?? { reason, count: 0, value: 0 };
    g.count += n(row.deal_count);
    g.value += n(row.deal_value);
    lossGroups.set(reason, g);
  }
  const lossAll = [...lossGroups.values()].sort((a, b) => b.count - a.count || b.value - a.value);
  const lostCount = lossAll.reduce((s, r) => s + r.count, 0);
  const lostValue = lossAll.reduce((s, r) => s + r.value, 0);
  const lostCommission = (v: number) => Math.round(v * (lossRate / 100));
  const lostHref = `/app/anlasmalar${qs({ gorunum: "liste", asama: "lost", ...dateQ, danisman: adv })}`;
  const lossItems = lossAll.slice(0, 8).map((r) => ({
    key: r.reason,
    label: r.reason,
    href: lostHref,
    value: r.count,
    valueText: `${r.count} · %${shareOfTotal(r.count, lostCount)} · ${money(r.value)}${r.value > 0 ? ` · ≈ ${money(lostCommission(r.value))} komisyon` : ""}`,
  }));
  const funnelHref = `/app/raporlar/huni${qs(periodScopeParams(period, scope))}`;

  return (
    <>
      <section aria-labelledby="donem-baslik" className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="donem-baslik" className={H2}>
            Dönem performansı · {period.label}
          </h2>
          <p className="text-xs text-text-muted">
            {rangeLabel(period.from, period.to)}
            {scopedNote} · önceki eşdeğer dönemle kıyas
          </p>
        </div>
        <KpiGrid label="Dönem göstergeleri">
          <KpiCard
            label="Yeni müşteri"
            value={String(n(cur.new_customers))}
            icon={ICONS.musteri}
            tone="brand"
            href={`/app/musteriler${qs({ ...dateQ, assigned: adv })}`}
            trend={computeTrend(n(cur.new_customers), n(prev.new_customers))}
            previousText={`${prevText} ${n(prev.new_customers)}`}
          />
          <KpiCard
            label="Yeni talep"
            value={String(n(cur.new_demands))}
            icon={ICONS.talep}
            tone="success"
            href={`/app/talepler${qs(dateQ)}`}
            trend={computeTrend(n(cur.new_demands), n(prev.new_demands))}
            previousText={`${prevText} ${n(prev.new_demands)}`}
          />
          <KpiCard
            label="Randevu"
            value={String(n(cur.appointments))}
            icon={ICONS.randevu}
            tone="brand"
            href={`/app/randevular${qs({ danisman: adv, tarih: period.from })}`}
            trend={computeTrend(n(cur.appointments), n(prev.appointments))}
            previousText={`${prevText} ${n(prev.appointments)} · iptal hariç`}
          />
          <KpiCard
            label="Teklif"
            value={String(n(cur.offers))}
            icon={ICONS.teklif}
            tone="gold"
            href={`/app/teklifler${qs({ ...dateQ, danisman: adv })}`}
            trend={computeTrend(n(cur.offers), n(prev.offers))}
            previousText={`${prevText} ${n(prev.offers)} · ${n(cur.offers_accepted)} kabul`}
          />
          <KpiCard
            label="Kazanılan anlaşma"
            value={String(n(cur.won))}
            icon={Trophy}
            tone="success"
            href={`/app/anlasmalar${qs({ gorunum: "liste", asama: "won", ...dateQ, danisman: adv })}`}
            trend={computeTrend(n(cur.won), n(prev.won))}
            previousText={`${money(n(cur.won_value))} · önceki ${n(prev.won)} anlaşma`}
          />
          <KpiCard
            label="Kaybedilen anlaşma"
            value={String(n(cur.lost))}
            icon={ICONS.alarm}
            tone="danger"
            href={lostHref}
            trend={computeTrend(n(cur.lost), n(prev.lost), true)}
            previousText={`${money(n(cur.lost_value))} · önceki ${n(prev.lost)} anlaşma`}
          />
          {data.earnings_visible && cur.commission != null ? (
            <KpiCard
              label="Komisyon (brüt)"
              value={money(n(cur.commission))}
              icon={ICONS.komisyon}
              tone="gold"
              href="/app/komisyon"
              trend={computeTrend(n(cur.commission), n(prev.commission))}
              previousText={`${prevText} ${money(n(prev.commission))}`}
            />
          ) : null}
          <KpiCard
            label="Yeni portföy"
            value={String(n(cur.new_listings))}
            icon={ICONS.portfoy}
            tone="neutral"
            href={`/app/portfoyler${qs({ danisman: adv })}`}
            trend={computeTrend(n(cur.new_listings), n(prev.new_listings))}
            previousText={`${prevText} ${n(prev.new_listings)}`}
          />
        </KpiGrid>
        <Link
          href={funnelHref}
          className="focus-ring lift surface-card flex min-h-14 items-center gap-3 rounded-[var(--radius-card)] p-3 transition hover:bg-surface-hover"
        >
          <Filter className={ICON_ACCENT} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block font-display text-sm font-bold text-text">Satış hunisinde aç</span>
            <span className="block text-xs text-text-muted">Aynı dönem ve kapsamda müşteri → randevu → teklif → kazanılan; kaynak ve danışman kırılımı</span>
          </span>
        </Link>
      </section>

      {sourceItems.length > 0 ? (
        <section className={SECTION}>
          <div className="flex flex-wrap items-center gap-2">
            <PieChart className={ICON_ACCENT} aria-hidden="true" />
            <h2 className={H2}>Yeni müşteri kaynakları · {period.label}</h2>
            <span className="ml-auto text-xs tabular-nums text-text-muted">{n(cur.new_customers)} yeni müşteri · en yüksek 8 kaynak</span>
          </div>
          <RankBars className="mt-3" items={sourceItems} ariaLabel="Müşteri kaynak dağılımı" seriesLabel="Müşteri" />
        </section>
      ) : null}

      <section className={SECTION}>
        <div className="flex flex-wrap items-center gap-2">
          <Trophy className={ICON_ACCENT} aria-hidden="true" />
          <h2 className={H2}>Kaynak ROI · {period.label}</h2>
          {roiTop.length > 0 ? (
            <span className="ml-auto text-xs tabular-nums text-text-muted">
              {roiWonCount} kazanılan · {money(roiWonValue)} · en yüksek 8 kaynak
            </span>
          ) : null}
        </div>
        {roiTop.length === 0 ? (
          <EmptyStateV3
            illustration="rapor"
            icon={<BarChart3 />}
            title="Bu dönemde kaynak verisi yok"
            description="Dönemde yeni müşteri kaydı ya da kazanılan anlaşma olunca kaynakların getirisi burada karşılaştırılır."
            action={<Link href="/app/musteriler" className="text-sm font-semibold text-accent-text hover:underline">Müşterilere git</Link>}
          />
        ) : (
          <RankBars className="mt-3" items={roiItems} format="money" color="var(--viz-2)" ariaLabel="Kaynak bazında kazanılan değer" seriesLabel="Kazanılan değer" />
        )}
      </section>

      <section className={SECTION}>
        <div className="flex flex-wrap items-center gap-2">
          <ICONS.alarm className="h-4 w-4 text-[color:var(--viz-neg)]" aria-hidden="true" />
          <h2 className={H2}>Kayıp nedenleri · {period.label}</h2>
          {lostCount > 0 ? (
            <span className="ml-auto text-xs tabular-nums text-text-muted">
              {lostCount} kaybedilen · {money(lostValue)} · tahmini kaçan komisyon ≈ {money(lostCommission(lostValue))} (%{lossRate})
            </span>
          ) : null}
        </div>
        {lossItems.length === 0 ? (
          <EmptyStateV3
            illustration="rapor"
            icon={<BarChart3 />}
            title="Bu dönemde kaybedilen anlaşma yok"
            description="Anlaşma tahtasında “Kaybedildi”ye taşınan kartlar nedenleriyle burada toplanır."
            action={<Link href="/app/anlasmalar" className="text-sm font-semibold text-accent-text hover:underline">Anlaşma tahtasına git</Link>}
          />
        ) : (
          <RankBars className="mt-3" items={lossItems} color="var(--viz-neg)" ariaLabel="Kayıp nedenleri" seriesLabel="Kaybedilen anlaşma" />
        )}
      </section>
    </>
  );
}
