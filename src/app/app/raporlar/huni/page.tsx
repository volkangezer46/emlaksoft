import { financePath } from "@/lib/finance/routes";
import Link from "@/components/ui/smart-link";
import { AlertTriangle, Filter, Megaphone, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { KpiGrid } from "@/components/ui/dashboard-grid";
import { KpiTile } from "@/components/ui/premium/kpi-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { now } from "@/lib/clock";
import { ICONS } from "@/lib/icons";
import { getDefinitionsOrDefault, toLabelMap } from "@/lib/definitions";
import { defaultLabelMap } from "@/lib/definition-defaults";
import { formatLeadSource } from "@/lib/lead-sources";
import { periodScopeParams, periodScopeRpcArgs, rangeLabel } from "@/lib/report-center/period-scope";
import { funnelSteps, pct, sourceRoi, weakestStep, type FunnelStep } from "@/lib/report-center/funnel-math";
import { ReportScopeBar } from "../_parts/report-scope-bar";
import { loadReportScopeContext } from "../_parts/report-scope";
import { formatTryAmount } from "@/lib/format";
import { IconChip } from "@/components/ui/icons";

export const metadata = { title: "Müşteriden satışa · Raporlar" };

const PATH = "/app/raporlar/huni";

type Row = {
  customers: number;
  appointments: number;
  offers: number;
  won: number;
  won_value: number;
  commission: number | null;
};
type SourceRow = Row & { source: string; cost: number | null; median_days_to_won: number | null };
type AdvisorRow = Row & { profile_id: string | null; full_name: string | null };
type Funnel = {
  totals: Row & { median_days_to_appt: number | null; median_days_to_offer: number | null; median_days_to_won: number | null };
  sources: SourceRow[];
  advisors: AdvisorRow[];
  earnings_visible: boolean;
  expenses_visible: boolean;
  cost_unattributed: number | null;
};

function money(n: number) {
  return formatTryAmount(n);
}
function pctText(v: number | null) {
  return v == null ? "—" : `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(v)}`;
}
function daysText(v: number | null | undefined) {
  return v == null ? "—" : `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(Number(v))} gün`;
}
function qs(params: Record<string, string | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : "";
}

const STEP_TONE: Record<FunnelStep["key"], string> = {
  customers: "var(--viz-1)",
  appointments: "var(--viz-3)",
  offers: "var(--viz-5)",
  won: "var(--viz-2)",
};

/**
 * OA2 + araştırma 2: Satış hunisi. Dönemde gelen müşteri KOHORTU (kaynak ve danışman kırılımlı): randevuya, teklife ve
 * kazanılan anlaşmaya kaç müşteri ulaştı, komisyon ve kaynak maliyeti. Tanımlar `report_sales_funnel` (20261018080002).
 * Dönem/kapsam Raporlar genel bakışla aynı URL kontratı (`?donem=&sube=&takim=&danisman=`).
 */
export default async function SalesFunnelPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tenantId, role, userId } = await requireModulePage("reports", "/app/raporlar");
  const sp = await searchParams;
  const supabase = await createClient();
  const nowMs = now();
  const [ctx, sourceDefs] = await Promise.all([
    loadReportScopeContext(supabase, { sp, role, userId, tenantId, nowMs }),
    getDefinitionsOrDefault("customer_source"),
  ]);
  const { data, error } = await supabase.rpc("report_sales_funnel", periodScopeRpcArgs(ctx.period, ctx.scope));
  const labels = new Map(Object.entries({ ...defaultLabelMap("customer_source"), ...toLabelMap(sourceDefs) }));
  const sourceLabel = (s: string) => (s === "Belirtilmedi" ? "Belirtilmedi" : (formatLeadSource(s, labels) ?? s));

  const header = (
    <PageHeader icon={<IconChip icon={Filter} size="lg" />}
      eyebrow="Raporlar"
      title="Müşteriden satışa"
      description="Dönemde gelen müşterilerin kaçı randevuya, teklife ve kazanılan anlaşmaya ulaştı? Kaynak ve danışman kırılımı."
    />
  );

  if (error || !data) {
    return (
      <div className="space-y-6">
        {header}
        <ReportScopeBar path={PATH} ctx={ctx} />
        <EmptyState
          icon={AlertTriangle}
          title="Huni raporu şu an okunamadı"
          description="Sayfayı yenileyin. Sorun sürerse destek ekibine yazın."
          action={{ href: "/app/raporlar", label: "Raporlara dön" }}
        />
      </div>
    );
  }

  const f = data as unknown as Funnel;
  const t = f.totals;
  const steps = funnelSteps({ customers: Number(t.customers), appointments: Number(t.appointments), offers: Number(t.offers), won: Number(t.won) });
  const weakest = weakestStep(steps);
  const { period, scope } = ctx;
  const adv = scope.profileId;
  const fromTo = { from: period.from, to: period.to };
  const stepHref: Record<FunnelStep["key"], string> = {
    customers: `/app/musteriler${qs({ ...fromTo, assigned: adv })}`,
    appointments: `/app/randevular${qs({ danisman: adv, tarih: period.from })}`,
    offers: `/app/teklifler${qs({ from: period.from, danisman: adv })}`,
    won: `/app/anlasmalar${qs({ gorunum: "liste", asama: "won", from: period.from, danisman: adv })}`,
  };
  const stepMedian: Partial<Record<FunnelStep["key"], number | null>> = {
    appointments: t.median_days_to_appt,
    offers: t.median_days_to_offer,
    won: t.median_days_to_won,
  };
  const maxValue = Math.max(1, steps[0].value);
  const totalCost = f.expenses_visible ? f.sources.reduce((s, r) => s + Number(r.cost ?? 0), 0) + Number(f.cost_unattributed ?? 0) : null;
  const totalRoi = sourceRoi({ customers: Number(t.customers), won: Number(t.won), cost: totalCost, commission: f.earnings_visible ? Number(t.commission ?? 0) : null });

  return (
    <div className="space-y-6">
      {header}
      <ReportScopeBar path={PATH} ctx={ctx} />

      {steps[0].value === 0 && f.sources.every((s) => !s.cost) ? (
        <EmptyState
          icon={Filter}
          illustration="rapor"
          title="Bu dönemde yeni müşteri yok"
          description={`${rangeLabel(period.from, period.to)} arasında${ctx.scopeLabel ? ` (${ctx.scopeLabel})` : ""} kaydedilen müşteri olmadığı için huni boş. Dönemi genişletin.`}
          action={{ href: `${PATH}?donem=bu-yil`, label: "Bu yılı göster" }}
        />
      ) : (
        <>
          <KpiGrid label="Huni özeti">
            <KpiTile label="Yeni müşteri" value={steps[0].value} icon={ICONS.musteri} tone="brand" href={stepHref.customers} hint={rangeLabel(period.from, period.to)} />
            <KpiTile
              label="Kazanma oranı"
              value={pctText(steps[3].overallPct)}
              icon={ICONS.komisyon}
              tone="success"
              href={stepHref.won}
              hint={`${steps[3].value} müşteri kazanıldı · medyan ${daysText(t.median_days_to_won)}`}
            />
            <KpiTile label="Kazanılan ciro" value={money(Number(t.won_value))} icon={ICONS.portfoy} tone="gold" href={stepHref.won} hint="kohortun kazanılan anlaşma tutarı" />
            {f.earnings_visible ? (
              <KpiTile
                label="Komisyon (brüt)"
                value={money(Number(t.commission ?? 0))}
                icon={ICONS.komisyon}
                tone="gold"
                href={financePath("komisyon")}
                hint={totalRoi.roiMultiple != null ? `Pazarlama giderinin ${totalRoi.roiMultiple}× katı` : "kohortun komisyonu"}
              />
            ) : (
              <KpiTile label="Teklif oranı" value={pctText(steps[2].overallPct)} icon={ICONS.teklif} tone="neutral" href={stepHref.offers} hint="müşteriden teklife" />
            )}
          </KpiGrid>

          <section className="surface-card rounded-[var(--radius-panel)] p-4 sm:p-5" aria-labelledby="huni-baslik">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="huni-baslik" className="font-display text-base font-bold text-text">
                Aşama dönüşümü
              </h2>
              <p className="text-xs text-text-muted">Kohort: {rangeLabel(period.from, period.to)} arasında kaydedilen müşteriler · sonraki adımlar dönem sonrasını da sayar</p>
            </div>
            <ol className="mt-4 space-y-2.5">
              {steps.map((s, i) => (
                <li key={s.key}>
                  <Link
                    href={stepHref[s.key]}
                    className="focus-ring group block rounded-[var(--radius-card)] px-2 py-2 transition hover:bg-surface-hover"
                    aria-label={`${s.label}: ${s.value}${s.stepPct != null ? `, önceki adımdan ${pctText(s.stepPct)}` : ""} — listede aç`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-sm">
                      <span className="font-semibold text-text">
                        {i + 1}. {s.label}
                      </span>
                      <span className="numeric text-xs text-text-muted">
                        <span className="font-display text-base font-extrabold text-text">{s.value}</span>
                        {s.stepPct != null ? <> · önceki adımdan {pctText(s.stepPct)}</> : null}
                        {i > 0 && s.overallPct != null ? <> · toplamın {pctText(s.overallPct)}</> : null}
                        {stepMedian[s.key] != null ? <> · medyan {daysText(stepMedian[s.key])}</> : null}
                      </span>
                    </div>
                    <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                      <div
                        className="h-full rounded-full transition-[width] duration-500"
                        style={{ width: `${Math.max(s.value > 0 ? 2 : 0, Math.round((s.value / maxValue) * 100))}%`, background: STEP_TONE[s.key] }}
                      />
                    </div>
                    {s.dropped > 0 ? <p className="mt-1 text-xs text-text-faint">{s.dropped} müşteri bu adıma geçmedi</p> : null}
                  </Link>
                </li>
              ))}
            </ol>
            {weakest && weakest.stepPct != null && steps[0].value >= 10 ? (
              <p className="mt-3 flex items-start gap-2 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-text">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong" aria-hidden="true" />
                En çok kayıp “{weakest.label}” adımında: önceki adımdan geçiş {pctText(weakest.stepPct)}.
              </p>
            ) : null}
          </section>

          <section aria-labelledby="kaynak-baslik" className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Megaphone className="h-4 w-4 text-accent-text" aria-hidden="true" />
              <h2 id="kaynak-baslik" className="font-display text-base font-bold text-text">
                Kaynağa göre huni ve getiri
              </h2>
              {f.expenses_visible ? (
                <span className="text-xs text-text-muted">Maliyet: dönemdeki gider kayıtları (portal giderleri portala, aynı adlı kategori kaynağa bağlanır)</span>
              ) : null}
            </div>
            {f.sources.length === 0 ? (
              <p className="text-sm text-text-muted">Bu dönemde kaynak verisi yok.</p>
            ) : (
              <TableFrame stack minWidth={880}>
                <Table>
                  <THead>
                    <TR>
                      <TH>Kaynak</TH>
                      <TH align="right">Müşteri</TH>
                      <TH align="right">Randevu</TH>
                      <TH align="right">Teklif</TH>
                      <TH align="right">Kazanılan</TH>
                      <TH align="right">Ciro</TH>
                      {f.earnings_visible ? <TH align="right">Komisyon</TH> : null}
                      {f.expenses_visible ? <TH align="right">Maliyet</TH> : null}
                      {f.expenses_visible ? <TH align="right">Müşteri başı</TH> : null}
                      {f.expenses_visible && f.earnings_visible ? <TH align="right">Getiri</TH> : null}
                    </TR>
                  </THead>
                  <TBody>
                    {f.sources.map((r) => {
                      const src = r.source === "Belirtilmedi" ? null : r.source;
                      const roi = sourceRoi({ customers: Number(r.customers), won: Number(r.won), cost: r.cost, commission: r.commission });
                      const href = `/app/musteriler${qs({ source: src, ...fromTo, assigned: adv })}`;
                      return (
                        <TR key={r.source}>
                          <TD label="Kaynak">
                            <Link href={href} className="focus-ring rounded-[var(--radius-control)] font-semibold text-text hover:text-accent-text hover:underline">
                              {sourceLabel(r.source)}
                            </Link>
                          </TD>
                          <TD label="Müşteri" align="right" className="numeric">
                            <Link href={href} className="focus-ring rounded-[var(--radius-control)] hover:underline">{Number(r.customers)}</Link>
                          </TD>
                          <TD label="Randevu" align="right" className="numeric">
                            {Number(r.appointments)} <span className="text-text-faint">{pctText(pct(Number(r.appointments), Number(r.customers)))}</span>
                          </TD>
                          <TD label="Teklif" align="right" className="numeric">
                            {Number(r.offers)} <span className="text-text-faint">{pctText(pct(Number(r.offers), Number(r.customers)))}</span>
                          </TD>
                          <TD label="Kazanılan" align="right" className="numeric">
                            {Number(r.won)} <span className="text-text-faint">{pctText(pct(Number(r.won), Number(r.customers)))}</span>
                          </TD>
                          <TD label="Ciro" align="right" className="numeric">{money(Number(r.won_value))}</TD>
                          {f.earnings_visible ? <TD label="Komisyon" align="right" className="numeric">{money(Number(r.commission ?? 0))}</TD> : null}
                          {f.expenses_visible ? (
                            <TD label="Maliyet" align="right" className="numeric">
                              {Number(r.cost ?? 0) > 0 ? <Link href={financePath()} className="focus-ring rounded-[var(--radius-control)] hover:underline">{money(Number(r.cost))}</Link> : "—"}
                            </TD>
                          ) : null}
                          {f.expenses_visible ? <TD label="Müşteri başı" align="right" className="numeric">{roi.costPerCustomer != null ? money(roi.costPerCustomer) : "—"}</TD> : null}
                          {f.expenses_visible && f.earnings_visible ? (
                            <TD label="Getiri" align="right" className={`numeric font-semibold ${roi.roiMultiple != null && roi.roiMultiple < 1 ? "text-danger-strong" : "text-text"}`}>
                              {roi.roiMultiple != null ? `${new Intl.NumberFormat("tr-TR").format(roi.roiMultiple)}×` : "—"}
                            </TD>
                          ) : null}
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableFrame>
            )}
            {f.expenses_visible && Number(f.cost_unattributed ?? 0) > 0 ? (
              <Link
                href={financePath()}
                className="focus-ring flex min-h-11 items-center gap-2 rounded-[var(--radius-card)] border border-line px-3 py-2 text-xs text-text-muted transition hover:bg-surface-hover"
              >
                <Megaphone className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Kaynağa bağlanmamış pazarlama gideri: <span className="font-semibold text-text">{money(Number(f.cost_unattributed))}</span>. Gideri portal seçerek ya da kaynak adıyla kategorilendirirseniz kaynağa yazılır.
                </span>
              </Link>
            ) : null}
          </section>

          {f.advisors.length > 0 ? (
            <section aria-labelledby="danisman-baslik" className="space-y-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-accent-text" aria-hidden="true" />
                <h2 id="danisman-baslik" className="font-display text-base font-bold text-text">
                  Danışmana göre huni
                </h2>
              </div>
              <TableFrame stack minWidth={720}>
                <Table>
                  <THead>
                    <TR>
                      <TH>Danışman</TH>
                      <TH align="right">Müşteri</TH>
                      <TH align="right">Randevu</TH>
                      <TH align="right">Teklif</TH>
                      <TH align="right">Kazanılan</TH>
                      <TH align="right">Ciro</TH>
                      {f.earnings_visible ? <TH align="right">Komisyon</TH> : null}
                    </TR>
                  </THead>
                  <TBody>
                    {f.advisors.map((a) => {
                      const id = a.profile_id;
                      const listHref = `/app/musteriler${qs({ ...fromTo, assigned: id })}`;
                      return (
                        <TR key={id ?? "atanmamis"}>
                          <TD label="Danışman">
                            {id ? (
                              <Link
                                href={`${PATH}${qs(periodScopeParams(period, { ...scope, profileId: id }))}`}
                                className="focus-ring rounded-[var(--radius-control)] font-semibold text-text hover:text-accent-text hover:underline"
                              >
                                {a.full_name ?? "—"}
                              </Link>
                            ) : (
                              <span className="text-text-muted">Atanmamış</span>
                            )}
                          </TD>
                          <TD label="Müşteri" align="right" className="numeric">
                            {id ? <Link href={listHref} className="focus-ring rounded-[var(--radius-control)] hover:underline">{Number(a.customers)}</Link> : Number(a.customers)}
                          </TD>
                          <TD label="Randevu" align="right" className="numeric">
                            {Number(a.appointments)} <span className="text-text-faint">{pctText(pct(Number(a.appointments), Number(a.customers)))}</span>
                          </TD>
                          <TD label="Teklif" align="right" className="numeric">
                            {Number(a.offers)} <span className="text-text-faint">{pctText(pct(Number(a.offers), Number(a.customers)))}</span>
                          </TD>
                          <TD label="Kazanılan" align="right" className="numeric">
                            {Number(a.won)} <span className="text-text-faint">{pctText(pct(Number(a.won), Number(a.customers)))}</span>
                          </TD>
                          <TD label="Ciro" align="right" className="numeric">{money(Number(a.won_value))}</TD>
                          {f.earnings_visible ? <TD label="Komisyon" align="right" className="numeric">{money(Number(a.commission ?? 0))}</TD> : null}
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableFrame>
            </section>
          ) : null}

          <p className="text-xs text-text-faint">
            Tanımlar: randevu = iptal edilmemiş randevu, teklif = taslak dışındaki teklif, kazanılan = “Kazanıldı” aşamasındaki anlaşma (müşteriye bağlı). Danışman karnesindeki
            “Satış” sayısı kabul edilen teklifi sayar; iki sayı farklı olabilir.
          </p>
        </>
      )}
    </div>
  );
}
