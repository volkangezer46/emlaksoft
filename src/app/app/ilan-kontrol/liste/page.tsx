import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonCard } from "@/components/ui/viz";
import { EmptyState } from "@/components/ui/empty-state";
import { TableFrame, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";
import { requireModulePage } from "@/lib/require-module-page";
import { formatDateTimeTr, formatTry } from "@/lib/format";
import { listControlProperties } from "@/lib/listing-control/server/readers";
import { KPI_KEYS, KPI_LABELS, STAGE_LABELS, type KpiKey, type LifecycleStage } from "@/lib/listing-control/types";
import {
  CONTROL_BASE,
  decodeCursor,
  encodeCursor,
  isKpiKey,
  kpiHref,
  parseGroupParam,
  scopeOfGroup,
  KPI_VISUAL,
  type GroupParam,
} from "@/components/listing-control/helpers";
import { ControlSubNav } from "@/components/listing-control/sub-nav";
import { ControlUnavailable, VisualChip } from "@/components/listing-control/ui-parts";
import { getDb, loadPropertyBriefs, loadProfileNames } from "@/components/listing-control/readers";

export const metadata = { title: "İlan kontrol listesi" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const HEALTH_VISUAL = { green: "healthy", yellow: "pending", orange: "mismatch", red: "critical", gray: "unverifiable" } as const;
const HEALTH_LABEL = { green: "Sağlıklı", yellow: "Kontrol bekliyor", orange: "Uyuşmazlık", red: "Kritik", gray: "Kontrol edilemiyor" } as const;

export default async function IlanKontrolListePage({ searchParams }: { searchParams: SearchParams }) {
  const { perms } = await requireModulePage("portals", "/app/ilan-kontrol");
  const sp = await searchParams;
  const kpiRaw = Array.isArray(sp.kpi) ? sp.kpi[0] : sp.kpi;
  const kpi: KpiKey = isKpiKey(kpiRaw) ? kpiRaw : "active";
  const group = parseGroupParam(sp.gruplama);
  const groupId = typeof sp.grup === "string" && /^[0-9a-fA-F-]{36}$/.test(sp.grup) ? sp.grup : null;
  const cursor = decodeCursor(sp.imlec);
  return (
    <>
      <PageHeader
        eyebrow="İlan Kontrol"
        title={KPI_LABELS[kpi]}
        description="Bu liste, ana ekrandaki sayıyla aynı kaynaktan gelir; risk puanı en yüksek portföy en üstte."
        breadcrumbs={[{ label: "İlan Kontrol", href: CONTROL_BASE }, { label: KPI_LABELS[kpi] }]}
      />
      <ControlSubNav active="liste" closures={effectiveCanAccessModule(perms, "leak")} />
      <nav aria-label="Gösterge filtresi" className="mb-4 flex flex-wrap gap-1.5">
        {KPI_KEYS.map((k) => (
          <Link
            key={k}
            href={kpiHref(k, group, groupId)}
            aria-current={k === kpi ? "page" : undefined}
            className={`focus-ring inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-semibold ${k === kpi ? "border-brand-500 bg-brand-600 text-white" : "border-line bg-surface text-text hover:border-brand-400"}`}
          >
            {KPI_LABELS[k]}
          </Link>
        ))}
      </nav>
      <Suspense fallback={<SkeletonCard height={420} label="Liste yükleniyor" />}>
        <ListBody kpi={kpi} group={group} groupId={groupId} cursor={cursor} />
      </Suspense>
    </>
  );
}

async function ListBody({ kpi, group, groupId, cursor }: { kpi: KpiKey; group: GroupParam; groupId: string | null; cursor: { riskScore: number; propertyId: string } | null }) {
  const db = await getDb();
  const res = await listControlProperties(db, kpi, { groupBy: scopeOfGroup(group), groupId, limit: 50, after: cursor });
  if (!res.available) return <ControlUnavailable />;
  if (res.rows.length === 0) {
    return (
      <EmptyState
        variant="panel"
        title="Bu başlıkta portföy yok"
        description={KPI_VISUAL[kpi].visual === "healthy" ? "Bu gruba giren portföy bulunamadı." : "Bu başlıkta şu an sorunlu portföy görünmüyor."}
        secondary={{ href: CONTROL_BASE, label: "Genel görünüme dön" }}
      />
    );
  }
  const briefs = await loadPropertyBriefs(db, res.rows.map((r) => r.property_id));
  const names = await loadProfileNames(db, res.rows.map((r) => r.advisor_id));
  const next = encodeCursor(res.nextCursor);
  const q = new URLSearchParams({ kpi });
  if (group !== "ofis") q.set("gruplama", group);
  if (groupId) q.set("grup", groupId);
  return (
    <div className="space-y-3">
      <TableFrame minWidth={820}>
        <Table>
          <caption className="sr-only">{KPI_LABELS[kpi]} portföy listesi</caption>
          <THead>
            <TR>
              <TH>Portföy</TH>
              <TH>Danışman</TH>
              <TH>Aşama</TH>
              <TH>Durum</TH>
              <TH align="right">Risk</TH>
              <TH align="right">Portalda</TH>
              <TH>Son doğrulama</TH>
            </TR>
          </THead>
          <TBody>
            {res.rows.map((r) => {
              const b = briefs.get(r.property_id);
              const color = (r.health_color ?? "gray") as keyof typeof HEALTH_VISUAL;
              return (
                <TR key={r.property_id}>
                  <TD>
                    <Link href={`/app/portfoyler/${r.property_id}?sekme=portallar`} className="focus-ring rounded font-medium text-accent-text hover:underline">
                      <span className="font-mono text-xs text-text-muted">{b?.code ?? "-"}</span> {b?.title ?? "Portföy"}
                    </Link>
                    {b?.price != null ? <div className="text-xs text-text-muted">{formatTry(b.price)}</div> : null}
                  </TD>
                  <TD>{r.advisor_id ? (names.get(r.advisor_id) ?? "-") : "Atanmamış"}</TD>
                  <TD>{STAGE_LABELS[r.lifecycle_stage as LifecycleStage] ?? r.lifecycle_stage}</TD>
                  <TD>
                    <VisualChip visual={HEALTH_VISUAL[color] ?? "unverifiable"} label={`${HEALTH_LABEL[color] ?? "Kontrol edilemiyor"}${r.health_score !== null ? ` · ${r.health_score}` : ""}`} />
                  </TD>
                  <TD align="right"><span className="font-semibold tabular-nums">{r.risk_score}</span></TD>
                  <TD align="right"><span className="tabular-nums">{r.portals_live}</span></TD>
                  <TD>{r.last_verified_at ? formatDateTimeTr(r.last_verified_at) : <span className="text-text-muted">Hiç doğrulanmadı</span>}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </TableFrame>
      {next ? (
        <div className="flex justify-end">
          <Link href={`${CONTROL_BASE}/liste?${q.toString()}&imlec=${encodeURIComponent(next)}`} className="focus-ring inline-flex min-h-10 items-center rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-semibold hover:border-brand-400">
            Sonraki 50 portföy
          </Link>
        </div>
      ) : null}
    </div>
  );
}

