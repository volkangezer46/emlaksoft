import Link from "@/components/ui/smart-link";
import { Suspense } from "react";
import { Clock3, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonCard } from "@/components/ui/viz";
import { EmptyState } from "@/components/ui/empty-state";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";
import { anomalyLostCommission } from "@/lib/listing-control/lost-commission";
import { requireModulePage } from "@/lib/require-module-page";
import { now } from "@/lib/clock";
import { getSetting } from "@/lib/settings/read";
import { formatDateTimeTr, formatTry } from "@/lib/format";
import { listAnomalies } from "@/lib/listing-control/server/readers";
import { REASON_LABELS, type ReasonCode } from "@/lib/listing-control/types";
import {
  ANOMALY_FILTERS,
  CONTROL_BASE,
  ageLabel,
  anomalyTypeLabel,
  parseAnomalyType,
  riskLabel,
  slaCountdown,
  type KpiVisual,
} from "@/components/listing-control/helpers";
import { STATUS_LABELS } from "@/components/listing-control/check-labels";
import { ControlSubNav } from "@/components/listing-control/sub-nav";
import { ControlUnavailable, VisualChip } from "@/components/listing-control/ui-parts";
import { AnomalyActions } from "@/components/listing-control/anomaly-actions";
import { getDb, loadProfileNames, loadPropertyBriefs } from "@/components/listing-control/readers";

export const metadata = { title: "İlan uyarı kuyruğu" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const PAGE_SIZE = 25;

const RISK_VISUAL: Record<string, KpiVisual> = { critical: "critical", high: "critical", medium: "mismatch", low: "pending", none: "neutral" };

export default async function AnomalilerPage({ searchParams }: { searchParams: SearchParams }) {
  const { perms, tenantId } = await requireModulePage("portals", "/app/ilan-kontrol");
  const canEdit = (perms.portals ?? []).includes("edit");
  const sp = await searchParams;
  const type = parseAnomalyType(sp.tur);
  const advisorRaw = Array.isArray(sp.danisman) ? sp.danisman[0] : sp.danisman;
  const advisorId = advisorRaw && /^[0-9a-fA-F-]{36}$/.test(advisorRaw) ? advisorRaw : null;
  const propertyRaw = Array.isArray(sp.portfoy) ? sp.portfoy[0] : sp.portfoy;
  const propertyId = propertyRaw && /^[0-9a-fA-F-]{36}$/.test(propertyRaw) ? propertyRaw : null;
  const page = Math.max(1, Math.floor(Number(Array.isArray(sp.sayfa) ? sp.sayfa[0] : sp.sayfa) || 1));
  return (
    <>
      <PageHeader
        eyebrow="İlan Kontrol"
        title="Bugün ilgilenmeniz gereken sorunlar"
        description="Risk puanı en yüksek uyarı en üstte. Her uyarı için önce açıklama girilir; açıklamasız uyarı kapatılamaz."
        breadcrumbs={[{ label: "İlan Kontrol", href: CONTROL_BASE }, { label: "Uyarı kuyruğu" }]}
      />
      <ControlSubNav active="anomaliler" closures={effectiveCanAccessModule(perms, "leak")} />
      <TypeFilters active={type} advisorId={advisorId} propertyId={propertyId} />
      <Suspense fallback={<SkeletonCard height={480} label="Uyarılar yükleniyor" />}>
        <QueueBody type={type} advisorId={advisorId} propertyId={propertyId} page={page} canEdit={canEdit} tenantId={tenantId} />
      </Suspense>
    </>
  );
}

function hrefFor(type: string | null, advisorId: string | null, page = 1, propertyId: string | null = null) {
  const q = new URLSearchParams();
  if (type) q.set("tur", type);
  if (advisorId) q.set("danisman", advisorId);
  if (propertyId) q.set("portfoy", propertyId);
  if (page > 1) q.set("sayfa", String(page));
  const s = q.toString();
  return `${CONTROL_BASE}/anomaliler${s ? `?${s}` : ""}`;
}

function TypeFilters({ active, advisorId, propertyId }: { active: string | null; advisorId: string | null; propertyId: string | null }) {
  const chip = (on: boolean) =>
    `focus-ring inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-semibold transition ${on ? "border-brand-500 bg-brand-600 text-white" : "border-line bg-surface text-text hover:border-brand-400"}`;
  return (
    <nav aria-label="Uyarı türü" className="mb-4 flex flex-wrap gap-1.5">
      <Link href={hrefFor(null, advisorId, 1, propertyId)} aria-current={active === null ? "page" : undefined} className={chip(active === null)}>Tümü</Link>
      {ANOMALY_FILTERS.map((f) => (
        <Link key={f.value} href={hrefFor(f.value, advisorId, 1, propertyId)} aria-current={active === f.value ? "page" : undefined} className={chip(active === f.value)}>
          {f.label}
        </Link>
      ))}
    </nav>
  );
}

async function QueueBody({ type, advisorId, propertyId, page, canEdit, tenantId }: { type: string | null; advisorId: string | null; propertyId: string | null; page: number; canEdit: boolean; tenantId: string | null | undefined }) {
  const db = await getDb();
  const res = await listAnomalies(db, { type, advisorId, propertyId, page, pageSize: PAGE_SIZE });
  if (!res.available) return <ControlUnavailable />;
  const filtered = Boolean(type || advisorId || propertyId);
  if (res.rows.length === 0) {
    return (
      <EmptyState
        icon={ShieldAlert}
        variant="panel"
        title={filtered ? "Bu filtrede açık uyarı yok" : "Açık uyarı yok"}
        description="Şu an ilgilenmeniz gereken bir sorun görünmüyor. Yeni bir sorun tespit edilirse burada listelenir."
        secondary={filtered ? { href: `${CONTROL_BASE}/anomaliler`, label: "Filtreyi temizle" } : { href: CONTROL_BASE, label: "Genel görünüme dön" }}
      />
    );
  }
  const nowMs = now();
  // Ofis tanımı: portföyde oran yoksa kaçan komisyon tahmininde kullanılan yedek oran.
  const defaultRate = tenantId ? await getSetting<number>("office.commission.default_rate", { tenantId }) : undefined;
  const [briefs, names] = await Promise.all([
    loadPropertyBriefs(db, res.rows.map((r) => r.property_id)),
    loadProfileNames(db, res.rows.map((r) => r.advisor_id)),
  ]);
  const totalPages = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">{res.total} uyarı{type ? ` · ${anomalyTypeLabel(type)}` : ""}</p>
      <ul className="space-y-2.5">
        {res.rows.map((r) => {
          const b = briefs.get(r.property_id);
          const risk = riskLabel(r.risk_score);
          const sla = r.status === "explained" ? null : slaCountdown(r.sla_due_at, nowMs);
          const lost = anomalyLostCommission(r.type, { listPrice: b?.price ?? null, commissionRate: b?.commissionRate ?? null, defaultRate });
          const priceDetail = r.type === "price_mismatch" ? (r.details as { crmPrice?: number; portals?: { portal: string; price: number }[] }) : null;
          const dupDetail = r.type === "duplicate" ? (r.details as { otherPropertyId?: string; otherCode?: string; label?: string; signals?: string[] }) : null;
          const unregDetail = r.type === "unregistered_listing" ? (r.details as { portal?: string; externalId?: string; score?: number }) : null;
          return (
            <li key={r.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 gap-3">
                  <div className="w-24 shrink-0 text-center">
                    <div className="text-2xl font-bold tabular-nums text-text">{r.risk_score ?? "-"}<span className="text-xs font-medium text-text-muted">/100</span></div>
                    <VisualChip visual={RISK_VISUAL[risk.level] ?? "neutral"} label={risk.label} />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <p className="font-semibold text-text">{anomalyTypeLabel(r.type)}</p>
                    <Link href={`/app/portfoyler/${r.property_id}?sekme=portallar`} className="focus-ring block truncate rounded text-sm text-accent-text hover:underline">
                      <span className="font-mono text-xs text-text-muted">{b?.code ?? "-"}</span> {b?.title ?? "Portföy"}
                      {b?.price != null ? ` · ${formatTry(b.price)}` : ""}
                    </Link>
                    <p className="text-sm text-text-muted">
                      Danışman: {r.advisor_id ? (names.get(r.advisor_id) ?? "-") : "Atanmamış"} · Açık kalma: {ageLabel(r.first_seen_at, nowMs)} · {STATUS_LABELS[r.status] ?? r.status}
                    </p>
                    {lost ? (
                      <p className="text-sm font-medium text-danger-600">
                        Tahmini kaçan komisyon: {formatTry(lost.amount)}
                        <span className="font-normal text-text-muted"> (liste fiyatı üzerinden %{lost.rate}; işlem doğrulanmadı, Kalkan ile aynı hesap)</span>
                      </p>
                    ) : null}
                    {priceDetail?.crmPrice && priceDetail.portals?.length ? (
                      <p className="text-sm text-text-muted">
                        CRM {formatTry(priceDetail.crmPrice)}
                        {priceDetail.portals.map((p) => ` · ${p.portal} ${formatTry(p.price)}`).join("")}
                      </p>
                    ) : null}
                    {dupDetail?.otherPropertyId ? (
                      <p className="text-sm text-text-muted">
                        {dupDetail.label ?? "Olası kopya"}:{" "}
                        <Link href={`/app/portfoyler/${dupDetail.otherPropertyId}`} className="focus-ring rounded font-semibold text-accent-text hover:underline">
                          {dupDetail.otherCode ?? "diğer portföy"}
                        </Link>
                        {dupDetail.signals?.length ? ` · ${dupDetail.signals.join(", ")}` : ""}
                      </p>
                    ) : null}
                    {unregDetail?.externalId ? (
                      <p className="text-sm text-text-muted">
                        {unregDetail.portal ?? "Portal"} ilan no <span className="font-mono">{unregDetail.externalId}</span> CRM&apos;de kayıtlı değil
                        {typeof unregDetail.score === "number" ? ` · bu portföy olma olasılığı %${Math.round(unregDetail.score)}` : ""} ·{" "}
                        <Link href={`/app/portfoyler/${r.property_id}?sekme=portallar#portal-bagla`} className="focus-ring rounded font-semibold text-accent-text hover:underline">Bu portföye bağla</Link>
                      </p>
                    ) : null}
                    {r.explained_reason_code ? (
                      <p className="text-sm text-text-muted">Açıklama: {REASON_LABELS[r.explained_reason_code as ReasonCode] ?? "-"}</p>
                    ) : null}
                    {sla ? (
                      <p className={`inline-flex items-center gap-1 text-xs font-semibold ${sla.overdue ? "text-danger-600" : "text-text-muted"}`}>
                        <Clock3 aria-hidden="true" className="h-3.5 w-3.5" /> {sla.overdue ? "Süre doldu: " : "Süre: "}{sla.label}
                        {r.sla_due_at ? <span className="font-normal text-text-muted"> ({formatDateTimeTr(r.sla_due_at)})</span> : null}
                      </p>
                    ) : null}
                  </div>
                </div>
                <AnomalyActions
                  canEdit={canEdit}
                  a={{ id: r.id, propertyId: r.property_id, portalListingId: r.portal_listing_id, status: r.status, explainedReason: r.explained_reason_code }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {totalPages > 1 ? (
        <nav aria-label="Sayfalama" className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={hrefFor(type, advisorId, page - 1, propertyId)} className="focus-ring rounded px-2 py-1 font-semibold text-accent-text hover:underline">← Önceki</Link> : <span />}
          <span className="text-text-muted">Sayfa {page} / {totalPages}</span>
          {page < totalPages ? <Link href={hrefFor(type, advisorId, page + 1, propertyId)} className="focus-ring rounded px-2 py-1 font-semibold text-accent-text hover:underline">Sonraki →</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
