import Link from "next/link";
import { Suspense } from "react";
import { CheckCircle2, ClipboardCheck, Clock3, Gauge, SearchCheck, ShieldAlert, Siren, Timer, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonCard } from "@/components/ui/viz";
import { StatCard } from "@/components/app/stat-card";
import { requireModulePage } from "@/lib/require-module-page";
import { daysAgoIso } from "@/lib/clock";
import { getChangesSince, getControlSummary } from "@/lib/listing-control/server/readers";
import {
  CONTROL_BASE,
  durationLabel,
  healthyPercent,
  kpiHref,
  sumSummaryRows,
} from "@/components/listing-control/helpers";
import { rankAdvisors } from "@/components/listing-control/lifecycle-model";
import { ControlSubNav } from "@/components/listing-control/sub-nav";
import { ControlUnavailable, Panel } from "@/components/listing-control/ui-parts";
import { getDb, loadPublishLeadTimes, loadResolveStats, loadVerifiedRatio, resolveGroupNames } from "@/components/listing-control/readers";

export const metadata = { title: "İlan kontrol raporu" };

export default async function RaporPage() {
  await requireModulePage("portals", "/app/ilan-kontrol");
  return (
    <>
      <PageHeader
        eyebrow="İlan Kontrol"
        title="Günlük ve haftalık rapor"
        description="Dün ne yapıldı, bu hafta ne değişti? Hesaplanamayan değerler gösterilmez."
        breadcrumbs={[{ label: "İlan Kontrol", href: CONTROL_BASE }, { label: "Rapor" }]}
      />
      <ControlSubNav active="rapor" />
      <Suspense fallback={<div className="space-y-4"><SkeletonCard height={200} label="Günlük rapor yükleniyor" /><SkeletonCard height={260} label="Haftalık rapor yükleniyor" /></div>}>
        <ReportBody />
      </Suspense>
    </>
  );
}

type Item = { label: string; value: string | number; icon: LucideIcon; href: string; tone?: "neutral" | "success" | "warn" | "danger" };

function Grid({ items }: { items: Item[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 min-[460px]:grid-cols-2 lg:grid-cols-4">
      {items.map((i) => (
        <StatCard key={i.label} label={i.label} value={i.value} icon={i.icon} href={i.href} tone={i.tone ?? "neutral"} />
      ))}
    </div>
  );
}

async function ReportBody() {
  const db = await getDb();
  const [tenantRes, day, week, publishStats, resolve, verified, advisorRes] = await Promise.all([
    getControlSummary(db, "tenant"),
    getChangesSince(db, daysAgoIso(1)),
    getChangesSince(db, daysAgoIso(7)),
    loadPublishLeadTimes(db, daysAgoIso(7)),
    loadResolveStats(db, daysAgoIso(7)),
    loadVerifiedRatio(db),
    getControlSummary(db, "advisor"),
  ]);
  if (!tenantRes.available) return <ControlUnavailable />;
  const s = sumSummaryRows(tenantRes.rows);
  const pct = healthyPercent(s);

  const names = await resolveGroupNames(db, "advisor", advisorRes.rows.map((r) => r.group_id));
  const ranks = rankAdvisors(
    advisorRes.rows.map((r) => ({ id: r.group_id, name: r.group_id ? (names.get(r.group_id) ?? "Danışman") : "Atanmamış", total_active: r.total_active, healthy: r.healthy, portal_missing: r.portal_missing, in_review: r.in_review })),
  );

  const dayItems: Item[] = [];
  if (day.available && day.changes) {
    const c = day.changes;
    dayItems.push(
      { label: "Dün yapılan kontrol", value: c.checks_total, icon: ClipboardCheck, href: kpiHref("in_portals") },
      { label: "Kontrol edilemeyen deneme", value: c.checks_unverifiable, icon: Gauge, href: kpiHref("unverifiable"), tone: c.checks_unverifiable > 0 ? "warn" : "neutral" },
      { label: "Yeni tespit edilen sorun", value: c.anomalies_opened, icon: ShieldAlert, href: `${CONTROL_BASE}/anomaliler`, tone: c.anomalies_opened > 0 ? "warn" : "neutral" },
      { label: "Portalda yeni kaybolan ilan", value: c.newly_missing, icon: Siren, href: `${CONTROL_BASE}/anomaliler?tur=portal_missing`, tone: c.newly_missing > 0 ? "danger" : "neutral" },
    );
  }
  const stateItems: Item[] = [
    { label: "Sağlıklı", value: s.healthy, icon: CheckCircle2, href: kpiHref("healthy"), tone: "success" },
    { label: "İnceleme / uyuşmazlık", value: s.in_review, icon: ShieldAlert, href: kpiHref("in_review"), tone: s.in_review > 0 ? "warn" : "neutral" },
    { label: "Kritik (portal kayıp)", value: s.portal_missing, icon: Siren, href: kpiHref("portal_missing"), tone: s.portal_missing > 0 ? "danger" : "neutral" },
    { label: "Kontrol edilemeyen", value: s.unverifiable, icon: Gauge, href: kpiHref("unverifiable") },
  ];
  const weekItems: Item[] = [];
  if (week.available && week.changes) {
    weekItems.push(
      { label: "Haftada kaybolan ilan", value: week.changes.newly_missing, icon: TrendingDown, href: `${CONTROL_BASE}/anomaliler?tur=portal_missing`, tone: week.changes.newly_missing > 0 ? "danger" : "neutral" },
      { label: "Haftada yeniden görünür olan", value: week.changes.recovered, icon: TrendingUp, href: kpiHref("in_portals"), tone: "success" },
      { label: "Haftada çözülen sorun", value: week.changes.anomalies_closed, icon: CheckCircle2, href: `${CONTROL_BASE}/anomaliler`, tone: "success" },
    );
  }
  if (publishStats.available && publishStats.overallHours !== null) {
    weekItems.push({ label: "Ortalama yayına alma süresi", value: durationLabel(publishStats.overallHours), icon: Timer, href: `${CONTROL_BASE}/liste?kpi=awaiting_publish` });
  }
  if (resolve.available && resolve.avgHours !== null) {
    weekItems.push({ label: "Ortalama çözülme süresi", value: durationLabel(resolve.avgHours), icon: Clock3, href: `${CONTROL_BASE}/anomaliler` });
  }
  if (verified.available && verified.percent !== null) {
    weekItems.push({ label: "Portal uygunluk (doğrulanan ilan)", value: `%${verified.percent}`, icon: SearchCheck, href: kpiHref("in_portals") });
  }

  return (
    <div className="space-y-6">
      <Panel title="Dün" description="Son 24 saatte yapılan kontroller ve yeni tespitler">
        {dayItems.length ? <Grid items={dayItems} /> : <p className="text-sm text-text-muted">Dün için kontrol verisi yok.</p>}
      </Panel>
      <Panel title="Şu anki durum" description={`Aktif ${s.total_active} portföyün dağılımı${pct !== null ? ` · sağlık %${pct}` : ""}. Geçmiş günlerin anlık görüntüsü tutulmadığı için yalnız bugünün dağılımı gösterilir.`}>
        <Grid items={stateItems} />
      </Panel>
      <Panel title="Son 7 gün" description="Haftalık eğilim">
        {weekItems.length ? <Grid items={weekItems} /> : <p className="text-sm text-text-muted">Haftalık değerler için yeterli veri yok.</p>}
      </Panel>
      {ranks.best || ranks.worst ? (
        <Panel title="Danışman karşılaştırması" description="En az 3 aktif portföyü olan danışmanlar arasında">
          <ul className="grid gap-3 sm:grid-cols-2">
            {ranks.best ? (
              <li className="rounded-[var(--radius-control)] border border-line p-3 text-sm">
                <p className="flex items-center gap-1.5 font-semibold text-text"><Trophy aria-hidden="true" className="h-4 w-4 text-mint-700" /> En sağlıklı portföy</p>
                <Link href={`/app/ekip/${ranks.best.id}`} className="focus-ring rounded text-accent-text hover:underline">{ranks.best.name}</Link>
                <span className="text-text-muted"> · %{Math.round((ranks.best.healthy / ranks.best.total_active) * 100)} sağlıklı ({ranks.best.total_active} aktif)</span>
              </li>
            ) : null}
            {ranks.worst ? (
              <li className="rounded-[var(--radius-control)] border border-line p-3 text-sm">
                <p className="flex items-center gap-1.5 font-semibold text-text"><ShieldAlert aria-hidden="true" className="h-4 w-4 text-danger-600" /> En çok sorunlu portföy</p>
                <Link href={`/app/ekip/${ranks.worst.id}`} className="focus-ring rounded text-accent-text hover:underline">{ranks.worst.name}</Link>
                <span className="text-text-muted"> · {ranks.worst.portal_missing} kayıp, {ranks.worst.in_review} inceleme ({ranks.worst.total_active} aktif)</span>
              </li>
            ) : null}
          </ul>
          <p className="mt-2 text-xs text-text-muted">Bu karşılaştırma ilanları puanlar, kişileri değil; yalnız iş planlamak için kullanın.</p>
        </Panel>
      ) : null}
    </div>
  );
}
