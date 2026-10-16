import Link from "@/components/ui/smart-link";
import { Gauge } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusTile, type StatusTone } from "@/components/ui/status-tile";
import { TableFrame, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { now } from "@/lib/clock";
import { PERIODS, parsePeriod, periodRange } from "@/lib/growth-analytics/funnel";
import { readVitalsSummary, routeTable, siteSummary, type MetricSummary } from "@/lib/measure/field-data";
import { THRESHOLDS, VERDICT_LABEL, formatMetric, sentenceFor, verdictOf, type Metric, type Percentile } from "@/lib/measure/vitals";
import { requirePlatformModule } from "@/lib/platform";

export const metadata = { title: "Saha verisi" };

type SP = { gun?: string };

const METRIC_NAME: Record<"LCP" | "INP" | "CLS", string> = { LCP: "Açılış hızı", INP: "Tepki süresi", CLS: "Görsel kararlılık" };
const TONE = { iyi: "success", gelistirilmeli: "warn", kotu: "danger" } as const satisfies Record<string, StatusTone>;

function p75Text(metric: Metric, p: Percentile | null): string {
  return p ? `${p.open ? "≥ " : ""}${formatMetric(metric, p.value)}` : "—";
}

function Tile({ metric, mobile, desktop }: { metric: "LCP" | "INP" | "CLS"; mobile: MetricSummary; desktop: MetricSummary }) {
  const main = mobile.p75 ? { s: mobile, device: "mobile" as const } : desktop.p75 ? { s: desktop, device: "desktop" as const } : null;
  if (!main || !main.s.p75) {
    return <StatusTile label={METRIC_NAME[metric]} value="Veri birikiyor" hint="Henüz yeterli ölçüm yok" href="#rotalar" />;
  }
  const p = main.s.p75;
  const v = verdictOf(metric, p.value);
  const t = THRESHOLDS[metric];
  const other = main.device === "mobile" ? desktop : mobile;
  return (
    <div className="space-y-1">
      <StatusTile
        label={`${METRIC_NAME[metric]} · ${main.device === "mobile" ? "telefon" : "bilgisayar"}`}
        value={sentenceFor(metric, p, main.device)}
        hint={`${metric} p75 ${p75Text(metric, p)} · iyi ≤ ${formatMetric(metric, t.good)} · ${p.samples.toLocaleString("tr-TR")} ölçüm`}
        href="#rotalar"
        tone={TONE[v]}
        progress={main.s.good !== null ? { value: Math.round(main.s.good * 100), max: 100, label: `Ziyaretlerin %${Math.round(main.s.good * 100)}'i iyi` } : undefined}
      />
      <p className="px-1 text-xs text-text-muted">
        {main.s.good !== null ? `Ziyaretlerin %${Math.round(main.s.good * 100)}'i "iyi" eşiğinde. ` : ""}
        {other.p75 ? `${main.device === "mobile" ? "Bilgisayarda" : "Telefonda"}: ${p75Text(metric, other.p75)} (${VERDICT_LABEL[verdictOf(metric, other.p75.value)]}).` : ""}
      </p>
    </div>
  );
}

function Cell({ metric, s }: { metric: Metric; s: MetricSummary }) {
  if (!s.p75) return <span className="text-text-faint">—</span>;
  const v = verdictOf(metric, s.p75.value);
  const cls = v === "iyi" ? "text-success-strong" : v === "gelistirilmeli" ? "text-amber-900" : "text-danger-600";
  return (
    <span className={`font-semibold tabular-nums ${cls}`} title={`${VERDICT_LABEL[v]} · ${s.p75.samples} ölçüm`}>
      {p75Text(metric, s.p75)}
    </span>
  );
}

/**
 * Saha verisi: gerçek ziyaretçilerin cihazında ölçülen hız (p75, Google eşikleriyle). Yalnız toplanmış histogramı
 * okur (tek RPC); p75 sorgu anında histogramdan hesaplanır. Kutucuklarda teknik terim yalnız ikincil satırdadır.
 */
export default async function AdminFieldDataPage({ searchParams }: { searchParams?: Promise<SP> }) {
  await requirePlatformModule("sitecontent");
  const sp = (await searchParams) ?? {};
  const days = parsePeriod(sp.gun);
  const { cur } = periodRange(days, now());
  const res = await readVitalsSummary(cur.from, cur.to);
  const rows = res.ok ? res.rows : [];
  const summary = siteSummary(rows);
  const routes = routeTable(rows);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="pulse"
        eyebrow="Hız"
        icon={Gauge}
        title="Saha verisi"
        description="Gerçek ziyaretçilerin telefon ve bilgisayarında sayfalarınızın ne kadar hızlı açıldığı. Değerler ziyaretlerin %75'inin yaşadığı süredir (Google'ın ölçüsü)."
        actions={
          <SegmentedControl
            label="Dönem"
            value={String(days)}
            options={PERIODS.map((d) => ({ value: String(d), label: `${d} gün`, href: `/admin/site/hiz/saha?gun=${d}` }))}
          />
        }
      />

      {!res.ok ? (
        <EmptyState
          icon={Gauge}
          title={res.reason === "missing" ? "Hız ölçümü henüz kurulmadı" : "Saha verisi okunamadı"}
          description={res.reason === "missing" ? "Sistem güncellemesi (veritabanı) bekleniyor." : "Birkaç dakika sonra sayfayı yenileyin."}
          illustration={res.reason === "missing" ? "start" : "error"}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title="Ölçüm 13.10'da başladı; ilk veriler yarın"
          description="Ziyaretçiler herkese açık sayfaları açtıkça hız ölçümleri birikir. Ayar: Huni ve kanallar > Ölçüm ayarları."
          action={{ href: "/admin/site/reklam#olcum-ayarlari", label: "Ölçüm ayarları" }}
          illustration="start"
        />
      ) : (
        <>
          <section aria-label="Site geneli hız" className="grid gap-4 md:grid-cols-3">
            <Tile metric="LCP" mobile={summary.mobile.LCP} desktop={summary.desktop.LCP} />
            <Tile metric="INP" mobile={summary.mobile.INP} desktop={summary.desktop.INP} />
            <Tile metric="CLS" mobile={summary.mobile.CLS} desktop={summary.desktop.CLS} />
          </section>

          <Card id="rotalar" className="scroll-mt-24">
            <CardHeader>
              <div>
                <CardTitle>Sayfa × cihaz</CardTitle>
                <CardDescription>
                  Her satır bir sayfa şablonu ve cihaz türüdür (vitrin ve ilan sayfaları tek şablonda toplanır). &quot;Statik&quot; sütunu ana sayfanın hızlı HTML sürümünü, &quot;Normal&quot; uygulama sürümünü gösterir.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <TableFrame minWidth={720} stickyFirst>
                <Table className="w-full text-left text-sm">
                  <THead>
                    <TR className="border-b border-line text-xs uppercase tracking-wide text-text-muted">
                      <TH scope="col" className="px-4 py-2 font-semibold">Sayfa</TH>
                      <TH scope="col" className="px-4 py-2 font-semibold">Cihaz</TH>
                      <TH scope="col" align="right" className="px-4 py-2 font-semibold">Ölçüm</TH>
                      <TH scope="col" align="right" className="px-4 py-2 font-semibold">Açılış (LCP)</TH>
                      <TH scope="col" align="right" className="px-4 py-2 font-semibold">Tepki (INP)</TH>
                      <TH scope="col" align="right" className="px-4 py-2 font-semibold">Kayma (CLS)</TH>
                      <TH scope="col" align="right" className="px-4 py-2 font-semibold">Statik / Normal</TH>
                    </TR>
                  </THead>
                  <TBody className="divide-y divide-line">
                    {routes.map((r) => (
                      <TR key={`${r.path}-${r.device}`}>
                        <TD className="max-w-[16rem] truncate px-4 py-2.5 font-mono text-xs text-ink-950" title={r.path}>
                          {r.path.includes("[") || r.path === "(taşma)" ? (
                            r.path
                          ) : (
                            <Link href={`/admin/site/seo?sekme=sayfalar&sayfa=${encodeURIComponent(r.path)}#editor`} className="focus-ring rounded hover:underline">
                              {r.path}
                            </Link>
                          )}
                        </TD>
                        <TD className="px-4 py-2.5">{r.device === "mobile" ? "Telefon" : "Bilgisayar"}</TD>
                        <TD align="right" className="px-4 py-2.5 tabular-nums">{r.samples.toLocaleString("tr-TR")}</TD>
                        <TD align="right" className="px-4 py-2.5"><Cell metric="LCP" s={r.lcp} /></TD>
                        <TD align="right" className="px-4 py-2.5"><Cell metric="INP" s={r.inp} /></TD>
                        <TD align="right" className="px-4 py-2.5"><Cell metric="CLS" s={r.cls} /></TD>
                        <TD align="right" className="px-4 py-2.5 text-xs tabular-nums text-text-muted">
                          {r.lcpStatic || r.lcpNormal ? `${p75Text("LCP", r.lcpStatic)} / ${p75Text("LCP", r.lcpNormal)}` : "—"}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableFrame>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
