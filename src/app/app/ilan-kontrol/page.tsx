import { measureAll } from "@/lib/server-timing";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { SkeletonCard } from "@/components/ui/viz";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";
import { requireModulePage } from "@/lib/require-module-page";
import { daysAgoIso } from "@/lib/clock";
import { getChangesSince, getControlSummary, getDistrictSummary, listTodayChecks, type ControlSummaryRow } from "@/lib/listing-control/server/readers";
import { buildOwnerQuestions, pickRiskDistrict, type OwnerQuestion } from "@/components/listing-control/owner-questions";
import { DistrictBreakdown, OwnerQuestions } from "@/components/listing-control/owner-sections";
import { loadOverdueAdvisors } from "@/components/listing-control/ops-readers";
import { rankAdvisors } from "@/components/listing-control/lifecycle-model";
import {
  buildExecutiveSummary,
  parseGroupParam,
  scopeCaption,
  scopeOfGroup,
  sumSummaryRows,
  healthyPercent,
  type GroupParam,
} from "@/components/listing-control/helpers";
import {
  ChangesSince,
  CriticalJobs,
  ExecutiveSummaryCard,
  GroupSwitcher,
  GroupTable,
  HealthGauge,
  KpiStrip,
  MismatchCard,
  TodayChecks,
  type GroupRowView,
  type TodayCheckView,
} from "@/components/listing-control/dashboard-sections";
import { DailySyncSection } from "@/components/listing-control/daily-sync-section";
import { ControlSubNav } from "@/components/listing-control/sub-nav";
import { ControlUnavailable } from "@/components/listing-control/ui-parts";
import { countOpenAnomalies, getDb, loadPropertyBriefs, resolveGroupNames, loadPublishLeadTimes } from "@/components/listing-control/readers";
import { durationLabel } from "@/components/listing-control/helpers";

export const metadata = { title: "İlan Kontrol Merkezi" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const OWNER_QUESTION_ROLES = new Set(["owner", "gm", "branch_manager", "team_lead"]);

export default async function IlanKontrolPage({ searchParams }: { searchParams: SearchParams }) {
  const { role, perms } = await requireModulePage("portals", "/app/ilan-kontrol");
  const sp = await searchParams;
  const group = parseGroupParam(sp.gruplama);
  const management = OWNER_QUESTION_ROLES.has(role ?? "");
  return (
    <>
      <PageHeader
        eyebrow="Portföy"
        title="İlan Kontrol Merkezi"
        description={`Hiçbir portföy gözden kaybolmasın: portallarda yayında olanlar, kaybolanlar ve ilgilenmeniz gerekenler. Kapsam: ${scopeCaption(role)}.`}
        actions={
          <>
            <ButtonLink href="/app/ilan-kontrol/anomaliler" size="md">Uyarı kuyruğu</ButtonLink>
            <ButtonLink href="/app/ilan-kontrol/envanter" size="md" variant="secondary">Portal listesiyle karşılaştır</ButtonLink>
          </>
        }
      />
      <ControlSubNav active="genel" closures={effectiveCanAccessModule(perms, "leak")} />
      <div className="mb-6">
        <Suspense fallback={<SkeletonCard height={150} label="Günlük kontrol yükleniyor" />}>
          <DailySyncSection canDecide={management && ["owner", "gm", "branch_manager"].includes(role ?? "")} />
        </Suspense>
      </div>
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardBody group={group} management={management} />
      </Suspense>
    </>
  );
}

async function DashboardBody({ group, management }: { group: GroupParam; management: boolean }) {
  const db = await getDb();

  const nowIso = daysAgoIso(0);
  // Kırılım zinciri (özet -> adlar) ana turun İÇİNDE başlar: ana sorgularla paralel, sona kuyruklanmaz.
  const groupRowsPromise: Promise<GroupRowView[]> =
    group === "ofis"
      ? Promise.resolve([])
      : (async () => {
          const grouped = await getControlSummary(db, scopeOfGroup(group));
          const names = await resolveGroupNames(db, scopeOfGroup(group), grouped.rows.map((r) => r.group_id));
          return grouped.rows
            .map((r) => ({
              ...r,
              id: r.group_id,
              name: r.group_id ? (names.get(r.group_id) ?? "Bilinmeyen") : "Atanmamış",
              ratio: healthyPercent(r),
            }))
            .sort((a, b) => b.total_active - a.total_active);
        })();
  // Bugünün künyeleri listTodayChecks biter bitmez, kalan sorgulardan BAĞIMSIZ çekilir.
  const todayPromise = (async () => {
    const t = await listTodayChecks(db, nowIso, 8);
    const rows = t.available ? t.rows : [];
    const briefs = await loadPropertyBriefs(db, rows.map((r) => r.property_id));
    return { rows, briefs };
  })();
  const [tenantRes, anomalies, changes, publishStats, districts, overdue, advisorRes, groupRows, todayData] = await measureAll("ilan-kontrol-veri", [
    getControlSummary(db, "tenant"),
    countOpenAnomalies(db, nowIso),
    getChangesSince(db, daysAgoIso(1)),
    loadPublishLeadTimes(db, daysAgoIso(90)),
    getDistrictSummary(db),
    management ? loadOverdueAdvisors(db, nowIso) : Promise.resolve({ available: false, rows: [] as { advisorId: string; count: number }[] }),
    management ? getControlSummary(db, "advisor") : Promise.resolve({ available: false, rows: [] as ControlSummaryRow[] }),
    groupRowsPromise,
    todayPromise,
  ]);
  if (!tenantRes.available) return <ControlUnavailable />;
  const { rows: todayRows, briefs } = todayData;

  const summary = sumSummaryRows(tenantRes.rows);
  const sentences = buildExecutiveSummary(summary, { overdueSla: anomalies.overdue });

  // 12 soru: danışman kırılımı + süresi geçen uyarı sahipleri (adlar tek sorguda).
  let questions: OwnerQuestion[] = [];
  if (management) {
    const advisorNames = await resolveGroupNames(db, "advisor", [
      ...advisorRes.rows.map((r) => r.group_id),
      ...overdue.rows.slice(0, 3).map((r) => r.advisorId),
    ]);
    const ranked = rankAdvisors(
      advisorRes.rows.map((r) => ({ id: r.group_id, name: r.group_id ? (advisorNames.get(r.group_id) ?? "Danışman") : "Atanmamış", total_active: r.total_active, healthy: r.healthy, portal_missing: r.portal_missing, in_review: r.in_review })),
    );
    questions = buildOwnerQuestions({
      summary,
      counts: anomalies.counts,
      changes: changes.available ? changes.changes : null,
      worstAdvisor: ranked.worst?.id
        ? { id: ranked.worst.id, name: ranked.worst.name, issues: ranked.worst.portal_missing + ranked.worst.in_review, active: ranked.worst.total_active }
        : null,
      overdueAdvisors: overdue.rows.slice(0, 3).map((r) => ({ id: r.advisorId, name: advisorNames.get(r.advisorId) ?? "Danışman", count: r.count })),
      riskDistrict: districts.available ? pickRiskDistrict(districts.rows) : null,
    });
  }

  const todayView: TodayCheckView[] = todayRows.map((r) => ({
    ...r,
    code: briefs.get(r.property_id)?.code ?? "-",
    title: briefs.get(r.property_id)?.title ?? "Portföy",
  }));

  return (
    <div className="space-y-6">
      <ExecutiveSummaryCard sentences={sentences} />
      <KpiStrip summary={summary} group="ofis" />
      {questions.length > 0 ? <OwnerQuestions questions={questions} /> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <HealthGauge summary={summary} />
        <CriticalJobs counts={anomalies.counts} inReview={summary.in_review} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChangesSince changes={changes.available ? changes.changes : null} sinceLabel="Son 24 saat" />
        <MismatchCard summary={summary} counts={anomalies.counts} />
      </div>
      <section aria-label="Kırılım" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-text">Nerede problem var?</h2>
          <GroupSwitcher active={group} />
        </div>
        {group === "ofis" ? (
          <p className="text-sm text-text-muted">
            Şube, takım veya danışman seçerek sorunların nerede toplandığını görün.
            {publishStats.available && publishStats.overallHours !== null ? ` Ortalama yayına alma süresi: ${durationLabel(publishStats.overallHours)}.` : ""}
          </p>
        ) : groupRows.length === 0 ? (
          <p className="text-sm text-text-muted">Bu kırılım için gösterilecek veri yok.</p>
        ) : (
          <GroupTable rows={groupRows} group={group} />
        )}
      </section>
      {districts.available ? <DistrictBreakdown rows={districts.rows} /> : null}
      <TodayChecks rows={todayView} unverifiable={summary.unverifiable} />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <SkeletonCard height={112} variant="card" label="Günün özeti yükleniyor" />
      <SkeletonCard height={168} label="Göstergeler yükleniyor" />
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonCard height={260} label="Portföy sağlığı yükleniyor" />
        <SkeletonCard height={260} label="Kritik işler yükleniyor" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonCard height={200} label="Değişenler yükleniyor" />
        <SkeletonCard height={200} label="Uyuşmazlık yükleniyor" />
      </div>
    </div>
  );
}
