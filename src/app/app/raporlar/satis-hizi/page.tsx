import Link from "@/components/ui/smart-link";
import { AlertTriangle, Gauge, Hourglass, Timer, Users, Zap } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { KpiGrid } from "@/components/ui/dashboard-grid";
import { KpiTile } from "@/components/ui/premium/kpi-card";
import { computeTrend } from "@/components/ui/premium";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { now } from "@/lib/clock";
import { getStageLabels } from "@/lib/definitions";
import { ICONS } from "@/lib/icons";
import { periodScopeParams, periodScopeRpcArgs, rangeLabel } from "@/lib/report-center/period-scope";
import {
  MIN_CLOSED_FOR_VELOCITY,
  salesVelocity,
  stageConversionPct,
  stageHistoricalWinRate,
  type StageVelocityRow,
} from "@/lib/forecast/velocity";
import { ReportScopeBar } from "../_parts/report-scope-bar";
import { loadReportScopeContext } from "../_parts/report-scope";
import { formatTryAmount } from "@/lib/format";
import { IconChip } from "@/components/ui/icons";

export const metadata = { title: "Satış hızı · Raporlar" };

const PATH = "/app/raporlar/satis-hizi";

type Totals = {
  won: number;
  lost: number;
  won_value: number;
  avg_cycle_days: number | null;
  prev_won: number;
  prev_lost: number;
  prev_won_value: number;
  prev_avg_cycle_days: number | null;
};
type AdvisorRow = {
  profile_id: string;
  full_name: string | null;
  open_count: number;
  open_value: number;
  won: number;
  lost: number;
  won_value: number;
  avg_cycle_days: number | null;
};
type Velocity = { stages: StageVelocityRow[]; totals: Totals; open: { open_count: number; open_value: number }; advisors: AdvisorRow[] };

function money(n: number) {
  return formatTryAmount(n);
}
function days(v: number | null | undefined) {
  return v == null ? "—" : `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(Number(v))} gün`;
}
function pctText(v: number | null) {
  return v == null ? "—" : `%${v}`;
}
function qs(params: Record<string, string | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : "";
}

/**
 * Araştırma 3 + SP1: Satış hızı. Aşamada geçen gün, aşama dönüşümü, kapanış süresi ve danışman kırılımı
 * (`deal_stage_velocity`, 20261018080000; aşama geçmişi `deal_stage_events`). Hız formülü `src/lib/forecast/velocity.ts`.
 */
export default async function SalesVelocityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tenantId, role, userId } = await requireModulePage("reports", "/app/raporlar");
  const sp = await searchParams;
  const supabase = await createClient();
  const [ctx, stageLabels] = await Promise.all([
    loadReportScopeContext(supabase, { sp, role, userId, tenantId, nowMs: now(), defaultPeriod: "son-90" }),
    getStageLabels(),
  ]);
  const { data, error } = await supabase.rpc("deal_stage_velocity", periodScopeRpcArgs(ctx.period, ctx.scope));
  const header = (
    <PageHeader icon={<IconChip icon={Zap} size="lg" />}
      eyebrow="Raporlar"
      title="Satış hızı"
      description="Anlaşmalar her aşamada kaç gün bekliyor, nerede kayboluyor ve ne kadar sürede kapanıyor?"
    />
  );
  if (error || !data) {
    return (
      <div className="space-y-6">
        {header}
        <ReportScopeBar path={PATH} ctx={ctx} />
        <EmptyState icon={AlertTriangle} title="Satış hızı raporu şu an okunamadı" description="Sayfayı yenileyin. Sorun sürerse destek ekibine yazın." action={{ href: "/app/raporlar", label: "Raporlara dön" }} />
      </div>
    );
  }
  const v = data as unknown as Velocity;
  const t = v.totals;
  const { period, scope } = ctx;
  const adv = scope.profileId;
  const label = (k: string) => stageLabels[k as keyof typeof stageLabels]?.label ?? k;
  const vel = salesVelocity({
    openCount: Number(v.open.open_count),
    won: Number(t.won),
    lost: Number(t.lost),
    wonValue: Number(t.won_value),
    avgCycleDays: t.avg_cycle_days != null ? Number(t.avg_cycle_days) : null,
  });
  const prevVel = salesVelocity({
    openCount: Number(v.open.open_count),
    won: Number(t.prev_won),
    lost: Number(t.prev_lost),
    wonValue: Number(t.prev_won_value),
    avgCycleDays: t.prev_avg_cycle_days != null ? Number(t.prev_avg_cycle_days) : null,
  });
  const winPct = vel.winRate != null ? Math.round(vel.winRate * 100) : null;
  const prevWinPct = prevVel.winRate != null ? Math.round(prevVel.winRate * 100) : null;
  const wonHref = `/app/anlasmalar${qs({ gorunum: "liste", asama: "won", from: period.from, to: period.to, danisman: adv })}`;
  const openHref = `/app/anlasmalar${qs({ gorunum: "liste", asama: "acik", danisman: adv })}`;
  const anyData = Number(v.open.open_count) > 0 || Number(t.won) + Number(t.lost) > 0 || v.stages.some((s) => Number(s.entered) > 0);
  const slowest = [...v.stages].filter((s) => s.median_days != null && Number(s.exited) >= 3).sort((a, b) => Number(b.median_days) - Number(a.median_days))[0];

  return (
    <div className="space-y-6">
      {header}
      <ReportScopeBar path={PATH} ctx={ctx} />

      {!anyData ? (
        <EmptyState
          icon={Timer}
          illustration="rapor"
          title="Bu dönemde anlaşma hareketi yok"
          description={`${rangeLabel(period.from, period.to)} arasında aşama değişikliği ya da kapanış olmadı. Dönemi genişletin.`}
          action={{ href: `${PATH}?donem=bu-yil`, label: "Bu yılı göster" }}
        />
      ) : (
        <>
          <KpiGrid label="Satış hızı özeti">
            <KpiTile
              label="Satış hızı (30 gün, tahmin)"
              value={vel.per30Days != null ? money(vel.per30Days) : "—"}
              icon={Gauge}
              tone="gold"
              href={openHref}
              trend={vel.per30Days != null && prevVel.per30Days != null ? computeTrend(vel.per30Days, prevVel.per30Days) : undefined}
              hint={
                vel.per30Days != null
                  ? `${Number(v.open.open_count)} açık × %${winPct} × ${money(Math.round(vel.avgDealValue ?? 0))} ÷ ${days(t.avg_cycle_days)}`
                  : `Hesap için dönemde en az ${MIN_CLOSED_FOR_VELOCITY} sonuçlanan anlaşma ve açık anlaşma gerekir`
              }
            />
            <KpiTile
              label="Kazanma oranı"
              value={pctText(winPct)}
              icon={ICONS.komisyon}
              tone="success"
              href={wonHref}
              trend={winPct != null && prevWinPct != null ? computeTrend(winPct, prevWinPct) : undefined}
              hint={`${Number(t.won)} kazanılan · ${Number(t.lost)} kaybedilen`}
            />
            <KpiTile
              label="Ortalama kapanış süresi"
              value={days(t.avg_cycle_days)}
              icon={Hourglass}
              tone="brand"
              href={wonHref}
              trend={t.avg_cycle_days != null && t.prev_avg_cycle_days != null ? computeTrend(Number(t.avg_cycle_days), Number(t.prev_avg_cycle_days), true) : undefined}
              hint="açılıştan kazanmaya"
            />
            <KpiTile
              label="Süren anlaşmalar"
              value={money(Number(v.open.open_value))}
              icon={ICONS.portfoy}
              tone="neutral"
              href={openHref}
              hint={`${Number(v.open.open_count)} açık anlaşma`}
            />
          </KpiGrid>

          <section aria-labelledby="asama-baslik" className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="asama-baslik" className="font-display text-base font-bold text-text">
                Aşama bazında süre ve dönüşüm
              </h2>
              <p className="text-xs text-text-muted">Süre: dönemde aşamadan çıkan anlaşmaların o aşamada geçirdiği gün</p>
            </div>
            <TableFrame stack minWidth={860}>
              <Table>
                <THead>
                  <TR>
                    <TH>Aşama</TH>
                    <TH align="right">Giren</TH>
                    <TH align="right">Ortalama</TH>
                    <TH align="right">Medyan</TH>
                    <TH align="right">İlerleme</TH>
                    <TH align="right">Kaybedilen</TH>
                    <TH align="right">Şu an açık</TH>
                    <TH align="right">Bekleme (ort.)</TH>
                    <TH align="right">Kazanma olasılığı</TH>
                  </TR>
                </THead>
                <TBody>
                  {v.stages.map((s) => {
                    const conv = stageConversionPct({ advanced: Number(s.advanced), lost: Number(s.lost) });
                    const hist = stageHistoricalWinRate({ hist_won: Number(s.hist_won), hist_closed: Number(s.hist_closed) });
                    const stageHref = `/app/anlasmalar${qs({ gorunum: "liste", asama: s.stage, danisman: adv })}`;
                    return (
                      <TR key={s.stage}>
                        <TD label="Aşama">
                          <Link href={stageHref} className="focus-ring rounded-[var(--radius-control)] font-semibold text-text hover:text-accent-text hover:underline">
                            {label(s.stage)}
                          </Link>
                        </TD>
                        <TD label="Giren" align="right" className="numeric">{Number(s.entered)}</TD>
                        <TD label="Ortalama" align="right" className="numeric">{days(s.avg_days)}</TD>
                        <TD label="Medyan" align="right" className="numeric">{days(s.median_days)}</TD>
                        <TD label="İlerleme" align="right" className="numeric">{pctText(conv)}</TD>
                        <TD label="Kaybedilen" align="right" className="numeric">
                          {Number(s.lost) > 0 ? (
                            <Link href={`/app/anlasmalar${qs({ gorunum: "liste", asama: "lost", from: period.from, to: period.to, danisman: adv })}`} className="focus-ring rounded-[var(--radius-control)] text-danger-strong hover:underline">
                              {Number(s.lost)}
                            </Link>
                          ) : (
                            0
                          )}
                        </TD>
                        <TD label="Şu an açık" align="right" className="numeric">
                          <Link href={stageHref} className="focus-ring rounded-[var(--radius-control)] hover:underline">
                            {Number(s.open_now)}
                          </Link>
                          <span className="block text-xs text-text-faint">{money(Number(s.open_value))}</span>
                        </TD>
                        <TD label="Bekleme (ort.)" align="right" className="numeric">{days(s.open_avg_age_days)}</TD>
                        <TD label="Kazanma olasılığı" align="right" className="numeric">
                          {hist != null ? `%${Math.round(hist * 100)}` : <span className="text-text-faint" title="Bu aşamadan geçip sonuçlanan en az 10 anlaşma gerekir">veri az</span>}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableFrame>
            {slowest ? (
              <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-text">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong" aria-hidden="true" />
                En uzun bekleme “{label(slowest.stage)}” aşamasında: medyan {days(slowest.median_days)}. Bu aşamadaki kartlar için sonraki adımı planlayın.
              </p>
            ) : null}
          </section>

          {v.advisors.length > 0 ? (
            <section aria-labelledby="danisman-hiz" className="space-y-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-accent-text" aria-hidden="true" />
                <h2 id="danisman-hiz" className="font-display text-base font-bold text-text">
                  Danışmana göre
                </h2>
              </div>
              <TableFrame stack minWidth={760}>
                <Table>
                  <THead>
                    <TR>
                      <TH>Danışman</TH>
                      <TH align="right">Açık</TH>
                      <TH align="right">Kazanılan</TH>
                      <TH align="right">Kazanma oranı</TH>
                      <TH align="right">Kapanış süresi</TH>
                      <TH align="right">Hız (30 gün)</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {v.advisors.map((a) => {
                      const av = salesVelocity({ openCount: Number(a.open_count), won: Number(a.won), lost: Number(a.lost), wonValue: Number(a.won_value), avgCycleDays: a.avg_cycle_days });
                      return (
                        <TR key={a.profile_id}>
                          <TD label="Danışman">
                            <Link
                              href={`${PATH}${qs(periodScopeParams(period, { ...scope, profileId: a.profile_id }))}`}
                              className="focus-ring rounded-[var(--radius-control)] font-semibold text-text hover:text-accent-text hover:underline"
                            >
                              {a.full_name ?? "—"}
                            </Link>
                          </TD>
                          <TD label="Açık" align="right" className="numeric">
                            <Link href={`/app/anlasmalar${qs({ gorunum: "liste", asama: "acik", danisman: a.profile_id })}`} className="focus-ring rounded-[var(--radius-control)] hover:underline">
                              {Number(a.open_count)}
                            </Link>
                            <span className="block text-xs text-text-faint">{money(Number(a.open_value))}</span>
                          </TD>
                          <TD label="Kazanılan" align="right" className="numeric">
                            <Link href={`/app/anlasmalar${qs({ gorunum: "liste", asama: "won", from: period.from, to: period.to, danisman: a.profile_id })}`} className="focus-ring rounded-[var(--radius-control)] hover:underline">
                              {Number(a.won)}
                            </Link>
                            <span className="block text-xs text-text-faint">{money(Number(a.won_value))}</span>
                          </TD>
                          <TD label="Kazanma oranı" align="right" className="numeric">{av.winRate != null ? `%${Math.round(av.winRate * 100)}` : "—"}</TD>
                          <TD label="Kapanış süresi" align="right" className="numeric">{days(a.avg_cycle_days)}</TD>
                          <TD label="Hız (30 gün)" align="right" className="numeric">{av.per30Days != null ? money(av.per30Days) : "—"}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableFrame>
            </section>
          ) : null}

          <p className="text-xs text-text-faint">
            Satış hızı bir tahmindir: açık anlaşma sayısı × dönemin kazanma oranı × ortalama kazanılan tutar ÷ ortalama kapanış süresi. Aşama geçmişi, aşama değişikliklerinin
            kaydedilmeye başlandığı tarihten (ve önceki etkinlik kayıtlarından) hesaplanır.
          </p>
        </>
      )}
    </div>
  );
}
