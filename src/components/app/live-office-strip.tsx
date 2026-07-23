"use client";

import { useAppApi } from "@/hooks/use-app-api";

type Bootstrap = {
  counts: {
    customers: number;
    properties: number;
    demands: number;
    unreadNotifications: number;
  };
  officeScore: { score: number; label: string };
};

/** Tenant-safe cache strip — useAppApi canlı tüketimi */
export function LiveOfficeStrip({ tenantId }: { tenantId: string | null }) {
  const { data, loading, error } = useAppApi<Bootstrap>(tenantId, "/api/app/bootstrap", { ttl: 30_000 });

  if (!tenantId) return null;

  const counts = data?.counts;
  const score = data?.officeScore;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[14px] border border-line bg-surface/80 px-3 py-2 text-[11px] shadow-[var(--shadow-xs)] backdrop-blur">
      <span className="status-pulse h-1.5 w-1.5 rounded-full bg-mint-500" />
      <span className="font-bold text-ink-950">Canlı önbellek</span>
      {loading && !data ? <span className="text-text-faint">yükleniyor…</span> : null}
      {error ? <span className="text-danger-500">sync hatası</span> : null}
      {counts ? (
        <>
          <span className="rounded-full bg-brand-600/10 px-2 py-0.5 font-semibold text-brand-600">{counts.customers} müşteri</span>
          <span className="rounded-full bg-mint-500/10 px-2 py-0.5 font-semibold text-mint-700">{counts.properties} portföy</span>
          <span className="rounded-full bg-amber-400/15 px-2 py-0.5 font-semibold text-amber-700">{counts.demands} talep</span>
          {score ? (
            <span className="ml-auto font-bold text-ink-950">
              Skor {score.score} · {score.label}
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
