import Link from "next/link";
import { ArrowRight, Building2, CheckCircle2, Clock3, EyeOff, Gauge, RadioTower, Siren, AlertTriangle, Sparkles } from "lucide-react";
import { StatCard } from "@/components/app/stat-card";
import { RadialGauge } from "@/components/ui/viz";
import { TableFrame, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { formatDateTimeTr } from "@/lib/format";
import {
  CONTROL_BASE,
  GROUP_OPTIONS,
  buildChangeLines,
  buildCriticalJobs,
  buildKpiCards,
  buildMismatchBreakdown,
  healthyPercent,
  kpiHref,
  type GroupParam,
  type KpiVisual,
  type SummaryNumbers,
  type TypeCounts,
} from "./helpers";
import { CHECK_STATE_LABELS, checkStateVisual, formatPct } from "./check-labels";
import { Panel, VisualChip } from "./ui-parts";
import type { ControlChanges, TodayCheckRow } from "@/lib/listing-control/server/readers";

/** İlan Kontrol Merkezi ana ekran bölümleri (sunucu bileşenleri; hepsi gerçek sayı + tıklanabilir hedef). */

const CARD_ICON = {
  active: Building2,
  in_portals: RadioTower,
  awaiting_publish: Clock3,
  portal_missing: Siren,
  price_mismatch: AlertTriangle,
  in_review: EyeOff,
  unverifiable: Gauge,
  healthy: CheckCircle2,
} as const;

const CARD_TONE: Record<KpiVisual, "neutral" | "success" | "warn" | "danger"> = {
  healthy: "success",
  pending: "warn",
  mismatch: "warn",
  critical: "danger",
  unverifiable: "neutral",
  neutral: "neutral",
};

export function KpiStrip({ summary, group, groupId }: { summary: SummaryNumbers; group: GroupParam; groupId?: string | null }) {
  const cards = buildKpiCards(summary, group, groupId ?? null);
  return (
    <nav aria-label="İlan kontrol göstergeleri" className="grid grid-cols-1 gap-3 min-[460px]:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {cards.map((c) => (
        <div key={c.key} className="flex min-w-0 flex-col gap-1.5">
          <StatCard label={c.label} value={c.value} icon={CARD_ICON[c.key]} tone={CARD_TONE[c.visual]} href={c.href} />
          <div className="flex items-center justify-between gap-2 px-1">
            <VisualChip visual={c.visual} />
          </div>
          <p className="px-1 text-xs text-text-muted">{c.hint}</p>
        </div>
      ))}
    </nav>
  );
}

export function HealthGauge({ summary }: { summary: SummaryNumbers }) {
  const pct = healthyPercent(summary);
  const critical = summary.portal_missing;
  const review = summary.in_review;
  const tone = pct === null ? "neutral" : pct >= 85 ? "success" : pct >= 60 ? "warn" : "danger";
  return (
    <Panel title="Portföy sağlığı" description="Sağlıklı portföyün aktif portföye oranı">
      {pct === null ? (
        <p className="py-6 text-sm text-text-muted">Aktif portföy olmadığı için oran hesaplanamadı.</p>
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
          <RadialGauge value={pct} max={100} size={148} stroke={13} tone={tone} format="percent" ariaLabel="Portföy sağlığı">
            <div className="text-center">
              <div className="text-3xl font-bold tabular-nums text-text">%{pct}</div>
              <div className="text-xs text-text-muted">sağlıklı</div>
            </div>
          </RadialGauge>
          <ul className="grid w-full gap-2 text-sm">
            <li>
              <Link href={kpiHref("portal_missing")} className="focus-ring flex items-center justify-between gap-3 rounded-[var(--radius-control)] px-2 py-1.5 hover:bg-surface-hover">
                <span className="flex items-center gap-2"><Siren aria-hidden="true" className="h-4 w-4 text-danger-600" /> Kritik</span>
                <span className="font-semibold tabular-nums">{critical}</span>
              </Link>
            </li>
            <li>
              <Link href={kpiHref("in_review")} className="focus-ring flex items-center justify-between gap-3 rounded-[var(--radius-control)] px-2 py-1.5 hover:bg-surface-hover">
                <span className="flex items-center gap-2"><AlertTriangle aria-hidden="true" className="h-4 w-4 text-amber-700" /> İnceleme gerekiyor</span>
                <span className="font-semibold tabular-nums">{review}</span>
              </Link>
            </li>
            <li>
              <Link href={kpiHref("healthy")} className="focus-ring flex items-center justify-between gap-3 rounded-[var(--radius-control)] px-2 py-1.5 hover:bg-surface-hover">
                <span className="flex items-center gap-2"><CheckCircle2 aria-hidden="true" className="h-4 w-4 text-mint-700" /> Sağlıklı</span>
                <span className="font-semibold tabular-nums">{summary.healthy}</span>
              </Link>
            </li>
          </ul>
        </div>
      )}
      <div className="mt-4">
        <ButtonLink href={`${CONTROL_BASE}/anomaliler`} iconRight={ArrowRight} size="md">Sorunları İncele</ButtonLink>
      </div>
    </Panel>
  );
}

export function CriticalJobs({ counts, inReview }: { counts: TypeCounts; inReview: number }) {
  const jobs = buildCriticalJobs(counts, inReview);
  return (
    <Panel title="Bugün ilgilenmeniz gereken sorunlar" description="Her satır ilgili uyarı listesini açar">
      {jobs.length === 0 ? (
        <p className="flex items-center gap-2 py-4 text-sm text-text-muted">
          <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-mint-700" /> Şu an müdahale gerektiren açık sorun yok.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {jobs.map((j) => (
            <li key={j.key}>
              <Link href={j.href} className="focus-ring group flex min-h-11 items-center justify-between gap-3 py-2.5 text-sm">
                <span className="text-text">{j.label}</span>
                <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-text-faint transition group-hover:translate-x-0.5 group-hover:text-text" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function ChangesSince({ changes, sinceLabel }: { changes: ControlChanges | null; sinceLabel: string }) {
  return (
    <Panel title="Dünden beri değişenler" description={sinceLabel}>
      {!changes ? (
        <p className="py-4 text-sm text-text-muted">Bu dönem için değişiklik verisi yok.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {buildChangeLines(changes).map((c) => (
            <li key={c.key}>
              <Link href={c.href} className="focus-ring surface-interactive flex min-h-14 flex-col justify-center rounded-[var(--radius-control)] border border-line px-3 py-2 hover:border-brand-400">
                <span className="text-lg font-semibold tabular-nums text-text">{c.value}</span>
                <span className="text-xs text-text-muted">{c.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function MismatchCard({ summary, counts }: { summary: SummaryNumbers; counts: TypeCounts }) {
  const m = buildMismatchBreakdown(summary, counts);
  return (
    <Panel
      title="Toplu uyuşmazlık"
      description={`${m.active} aktif portföy, ${m.inPortals} portalda yayında: ${m.difference} fark`}
    >
      <ul className="divide-y divide-line text-sm">
        {m.parts.map((p) => (
          <li key={p.key}>
            <Link href={p.href} className="focus-ring flex min-h-11 items-center justify-between gap-3 py-2">
              <span>{p.label}</span>
              <span className="font-semibold tabular-nums">{p.count}</span>
            </Link>
          </li>
        ))}
        {m.other > 0 ? (
          <li className="flex min-h-11 items-center justify-between gap-3 py-2 text-text-muted">
            <span>Diğer (hazırlanıyor, kapanış sürecinde vb.)</span>
            <span className="font-semibold tabular-nums">{m.other}</span>
          </li>
        ) : null}
      </ul>
      <p className="mt-2 text-xs text-text-muted">
        Fark kalemleri portföy durumundan türetilir; kalemler birbiriyle örtüşebilir. Portal envanteri dosyası (CSV/API) yüklendiğinde ilan numarası bazlı karşılaştırma ayrıca çalışır.
      </p>
    </Panel>
  );
}

export function GroupSwitcher({ active, basePath = CONTROL_BASE }: { active: GroupParam; basePath?: string }) {
  return (
    <nav aria-label="Gruplama" className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-medium text-text-muted">Kırılım:</span>
      {GROUP_OPTIONS.map((g) => {
        const on = g.value === active;
        return (
          <Link
            key={g.value}
            href={g.value === "ofis" ? basePath : `${basePath}?gruplama=${g.value}`}
            aria-current={on ? "page" : undefined}
            className={`focus-ring inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-semibold transition ${on ? "border-brand-500 bg-brand-600 text-white" : "border-line bg-surface text-text hover:border-brand-400"}`}
          >
            {g.label}
          </Link>
        );
      })}
    </nav>
  );
}

export type GroupRowView = SummaryNumbers & { id: string | null; name: string; ratio: number | null; leadLabel?: string };

export function GroupTable({ rows, group }: { rows: GroupRowView[]; group: GroupParam }) {
  const label = GROUP_OPTIONS.find((g) => g.value === group)?.label ?? "Grup";
  const cell = (n: number, kpi: Parameters<typeof kpiHref>[0], r: GroupRowView) =>
    r.id || group === "ofis" ? (
      <Link href={kpiHref(kpi, group, r.id)} className="focus-ring rounded px-1 font-semibold tabular-nums text-accent-text hover:underline">{n}</Link>
    ) : (
      <span className="tabular-nums">{n}</span>
    );
  return (
    <TableFrame minWidth={760}>
      <Table>
        <caption className="sr-only">{label} bazında ilan kontrol özeti</caption>
        <THead>
          <TR>
            <TH>{label}</TH>
            <TH align="right">Aktif</TH>
            <TH align="right">Portalda</TH>
            <TH align="right">Yayın bekleyen</TH>
            <TH align="right">Portal kayıp</TH>
            <TH align="right">İnceleme</TH>
            <TH align="right">Sağlık</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id ?? "atanmamis"}>
              <TD className="font-medium text-text">{r.name}</TD>
              <TD align="right">{cell(r.total_active, "active", r)}</TD>
              <TD align="right">{cell(r.in_portals, "in_portals", r)}</TD>
              <TD align="right">{cell(r.awaiting_publish, "awaiting_publish", r)}</TD>
              <TD align="right">{cell(r.portal_missing, "portal_missing", r)}</TD>
              <TD align="right">{cell(r.in_review, "in_review", r)}</TD>
              <TD align="right">
                {r.ratio === null ? (
                  <span className="text-text-muted">Hesaplanamadı</span>
                ) : (
                  <Link href={kpiHref("healthy", group, r.id)} className="focus-ring inline-flex items-center gap-1 rounded px-1 font-semibold tabular-nums hover:underline">
                    {r.ratio >= 85 ? <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-mint-700" /> : r.ratio >= 60 ? <Clock3 aria-hidden="true" className="h-3.5 w-3.5 text-amber-700" /> : <Siren aria-hidden="true" className="h-3.5 w-3.5 text-danger-600" />}
                    {formatPct(r.ratio)}
                  </Link>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableFrame>
  );
}

export function ExecutiveSummaryCard({ sentences }: { sentences: string[] }) {
  return (
    <section aria-label="Günün özeti" className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:p-5">
      <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-text">
        <Sparkles aria-hidden="true" className="h-4 w-4 text-accent" /> Günün özeti
      </h2>
      <ul className="space-y-1.5 text-sm text-text">
        {sentences.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-text-muted">Bu özet, yukarıdaki gerçek sayılardan kurallarla otomatik üretilir; tahmin içermez.</p>
    </section>
  );
}

export type TodayCheckView = TodayCheckRow & { code: string; title: string };

export function TodayChecks({ rows, unverifiable }: { rows: TodayCheckView[]; unverifiable: number }) {
  return (
    <Panel title="Bugünkü kontroller" description="Sırası gelen portal ilanı kontrolleri">
      {unverifiable > 0 ? (
        <Alert tone="warning" className="mb-3">
          <Link href={kpiHref("unverifiable")} className="font-semibold underline">{unverifiable} portföyün portal kontrolü yapılamadı</Link>; bu portföyler sağlıklı sayılmadı. Portal bağlantısını veya ilan numarasını kontrol edin.
        </Alert>
      ) : null}
      {rows.length === 0 ? (
        <p className="py-3 text-sm text-text-muted">Şu an sırası gelmiş kontrol yok.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.portal_listing_id}>
              <Link href={`/app/portfoyler/${r.property_id}?sekme=portallar`} className="focus-ring flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 truncate text-text"><span className="font-mono text-xs text-text-muted">{r.code}</span> {r.title}</span>
                <span className="flex items-center gap-2">
                  <VisualChip visual={checkStateVisual(r.check_state)} label={CHECK_STATE_LABELS[r.check_state] ?? r.check_state} />
                  {r.next_check_at ? <span className="text-xs text-text-muted">{formatDateTimeTr(r.next_check_at)}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
