import { redirect } from "next/navigation";
import { Activity, BellRing, ClipboardCheck, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { now, trDayKey, trDayStartIso } from "@/lib/clock";
import { HIGH_RISK_ACTIONS } from "@/lib/audit-labels";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow } from "@/components/ui/stat-row";
import { loadFeedPage, normalizeFeedFilters } from "@/lib/oversight/feed-query";
import { loadAdvisorOptions, loadAlerts, loadProfileNames } from "@/lib/oversight/load";
import { loadOversightSettings } from "@/lib/oversight/store";
import { OversightNav } from "./_components/oversight-nav";
import { FeedFiltersForm } from "./_components/feed-filters";
import { FeedList, feedAssignedIds } from "./_components/feed-list";
import { PrivacyNote } from "./_components/privacy-note";

const PATH = "/app/ofis-kontrol";

export default async function OfisKontrolPage({ searchParams }: { searchParams?: Promise<Record<string, string | undefined>> }) {
  const { tenantId, role } = await requireModulePage("dashboard", PATH);
  // Danışman yalnız kendi akışını görür.
  if (!tenantId || !hasOfficeWideDataScope(role)) redirect(`${PATH}/benim`);

  const sp = (await searchParams) ?? {};
  const filters = normalizeFeedFilters(sp);
  const page = Math.max(1, Number.parseInt(sp.sayfa ?? "1", 10) || 1);

  const supabase = await createClient();
  const nowMs = now();
  const today = trDayKey(nowMs);

  const settings = await loadOversightSettings(supabase, tenantId);
  const dayStart = trDayStartIso(nowMs);
  const todayCount = (high: boolean) => {
    let q = supabase
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .not("actor_id", "is", null)
      .gte("created_at", dayStart);
    if (high) q = q.in("action", [...HIGH_RISK_ACTIONS]);
    return q;
  };
  const [feed, alerts, advisors, pendingApprovals, todayAll, todayHigh] = await Promise.all([
    loadFeedPage(supabase, tenantId, filters, page),
    loadAlerts(supabase, tenantId, settings.thresholds, nowMs),
    loadAdvisorOptions(supabase, tenantId),
    supabase
      .from("approval_requests")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "bekliyor"),
    todayCount(false),
    todayCount(true),
  ]);

  const names = new Map(advisors.map((a) => [a.id, a.name]));
  const missing = [...feed.rows.map((r) => r.actor_id), ...feedAssignedIds(feed.rows)].filter((id): id is string => Boolean(id) && !names.has(id as string));
  if (missing.length) for (const [id, n] of await loadProfileNames(supabase, tenantId, missing)) names.set(id, n);

  const highOpen = alerts.open.filter((a) => a.severity === "yuksek").length;
  const todayQs = (extra: Record<string, string>) => `${PATH}?${new URLSearchParams({ from: today, ...extra }).toString()}`;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Ofis"
        title="Ofis Kontrol Merkezi"
        description="Danışmanların ilan, müşteri, randevu, anlaşma ve dışa aktarma işlemleri tek zaman çizelgesinde. Uyarılar kural tabanlıdır; her biri nedenini ve ilgili kaydı gösterir."
      />
      <OversightNav active="akis" office openAlerts={alerts.open.length} />

      <StatRow
        label="Ofis kontrol özeti"
        items={[
          { label: "Açık uyarı", value: alerts.open.length, href: `${PATH}/uyarilar`, icon: <BellRing />, attention: alerts.open.length > 0 },
          { label: "Yüksek önemli", value: highOpen, href: `${PATH}/uyarilar?onem=yuksek`, icon: <ShieldAlert />, attention: highOpen > 0 },
          {
            label: "Bekleyen onay",
            value: pendingApprovals.count ?? 0,
            href: "/app/onaylar?durum=bekliyor",
            icon: <ClipboardCheck />,
            attention: (pendingApprovals.count ?? 0) > 0,
          },
          { label: "Bugünkü işlem", value: todayAll.count ?? 0, href: todayQs({}), hint: "bugünün akışı", icon: <Activity /> },
          { label: "Bugün yüksek risk", value: todayHigh.count ?? 0, href: todayQs({ risk: "yuksek" }), icon: <ShieldAlert />, attention: (todayHigh.count ?? 0) > 0 },
        ]}
      />
      {alerts.partial ? (
        <p className="text-xs text-text-muted">Uyarı taraması çok sayıda kayıt nedeniyle son kayıtlarla sınırlandı; eski olaylar eksik olabilir.</p>
      ) : null}

      <FeedFiltersForm filters={filters} advisors={advisors} basePath={PATH} />
      <p className="text-xs text-text-muted">
        {feed.total.toLocaleString("tr-TR")} işlem
        {filters.aktor ? ` · ${names.get(filters.aktor) ?? "seçili danışman"}` : ""}
        {feed.totalPages > 1 ? ` · sayfa ${feed.page}/${feed.totalPages}` : ""}
      </p>
      <FeedList data={feed} names={names} filters={filters} basePath={PATH} />

      <PrivacyNote audience="office" />
    </div>
  );
}
