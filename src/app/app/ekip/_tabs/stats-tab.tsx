import Link from "@/components/ui/smart-link";
import { Activity, AlertTriangle, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { StatRow } from "@/components/ui/stat-row";
import { assignHref, computeTeamHealth, tabHref } from "@/lib/office-center/logic";
import { loadOfficeAdvisors, loadOfficeStatistics, loadUnassignedProperties } from "@/lib/office-center/store";
import { getSettings } from "@/lib/settings/read";
import { ASSIGN_SLA_HOURS_KEY, UNASSIGNED_ALERT_KEY } from "@/lib/settings/registry/tenant";
import type { TabContext } from "./context";

/**
 * İstatistikler: gerçek sayımlar (sahte skor yok) ve ekip sağlığı (eşikler ofis ayarından). Her sayı filtreli hedefe
 * gider. Danışman sıralaması tek yerde: Ekip karnesi (/app/danisman-kpi) ve Lig (/app/lig).
 */
export async function StatsTab({ ctx }: { ctx: TabContext }) {
  const viewer = { userId: ctx.userId, role: ctx.role, perms: ctx.perms };
  const settings = await getSettings([ASSIGN_SLA_HOURS_KEY, UNASSIGNED_ALERT_KEY], { tenantId: ctx.tenantId });
  const slaHours = Number(settings[ASSIGN_SLA_HOURS_KEY] ?? 24);
  const [stats, unassigned, advisors] = await Promise.all([
    loadOfficeStatistics(ctx.supabase, ctx.tenantId, ctx.nowMs),
    loadUnassignedProperties(ctx.supabase, ctx.tenantId, { nowMs: ctx.nowMs, slaHours, limit: 1 }),
    loadOfficeAdvisors(ctx.supabase, ctx.tenantId, viewer, ctx.nowMs),
  ]);
  const idle30 = advisors.rows.filter((r) => r.isActive && ["owner", "gm", "branch_manager", "team_lead", "advisor"].includes(r.role) && (!r.lastActivityAt || ctx.nowMs - Date.parse(r.lastActivityAt) > 30 * 86_400_000)).length;
  const health = computeTeamHealth({ stats, breachedUnassigned: unassigned.breached, unassignedThreshold: Number(settings[UNASSIGNED_ALERT_KEY] ?? 5), advisorsWithoutActivity30d: idle30 });
  const tone = health.level === "healthy" ? "bg-mint-500/10 text-mint-700" : health.level === "warning" ? "bg-amber-500/10 text-amber-700" : "bg-danger-500/10 text-danger-600";

  return (
    <div className="space-y-6">
      <StatRow
        label="Ofis performansı (bu ay)"
        items={[
          { label: "Açık portföy", value: stats.totalProperties, href: "/app/portfoyler" },
          { label: "Yayında", value: stats.liveProperties, href: "/app/portfoyler?status=live" },
          { label: "Danışmansız", value: stats.unassignedProperties, href: assignHref(), attention: stats.unassignedProperties > 0 },
          { label: "Kazanılan anlaşma", value: stats.wonDealsThisMonth, href: "/app/anlasmalar?gorunum=liste&asama=won", hint: "bu ay" },
          { label: "Aktif kiralama", value: stats.activeRentals, href: "/app/kiralama" },
          { label: "Havuz ataması", value: stats.assignmentsAvailable ? stats.assignmentsThisMonth : "—", href: assignHref("gecmis"), hint: "bu ay" },
          { label: "Aktif / pasif üye", value: `${stats.activeAdvisors} / ${stats.inactiveAdvisors}`, href: tabHref("danismanlar") },
        ]}
      />
      {stats.failed ? (
        <Alert tone="warning" title="Bazı sayılar okunamadı">
          Sorgulardan biri hata verdi; gösterilen değerler eksik olabilir. Sayfayı yenileyin.
        </Alert>
      ) : null}

      <section aria-labelledby="oc-saglik" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="oc-saglik" className="flex items-center gap-2 font-display font-bold text-ink-950">
            <Activity className="h-4 w-4 text-brand-600" aria-hidden="true" /> Ekip sağlığı
          </h2>
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
            {health.level === "healthy" ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
            {health.level === "healthy" ? "Sağlıklı" : health.level === "warning" ? "Uyarı" : "Kritik"}
          </span>
        </div>
        {health.alerts.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">
            Eşik aşımı yok: danışmansız ilan, atama süre sınırı, aktivitesiz danışman ve iptal oranı sınırların içinde. Eşikler:{" "}
            <Link href="/app/ayarlar/merkez?grup=atama" className="font-semibold text-brand-600 hover:underline">
              Kurallar ve varsayılanlar
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {health.alerts.map((a) => (
              <li key={a.text}>
                <Link href={a.href} className="focus-ring inline-flex items-center gap-1 text-sm font-medium text-ink-950 hover:text-brand-600">
                  {a.text} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

    </div>
  );
}
