import { AlertTriangle, ArrowRight, CheckCircle2, Inbox } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { StatRow } from "@/components/ui/stat-row";
import { assignHref } from "@/lib/office-center/logic";
import { loadUnassignedProperties } from "@/lib/office-center/store";
import { getSettings } from "@/lib/settings/read";
import { ASSIGN_SLA_HOURS_KEY } from "@/lib/settings/registry/tenant";
import { assignBranchOf } from "../../ilan-havuzu/assignment-section";
import type { TabContext } from "./context";

/**
 * Atamalar: YALNIZ ÖZET. Atama tek ekranda yapılır: İlan Havuzu (danışmansız ilan + akıllı öneri + geçmiş).
 * Her sayı İlan Havuzu'nun ilgili görünümüne gider (sıfır çıkmaz metrik); kopya atama paneli burada yok.
 */
export async function AssignmentsTab({ ctx }: { ctx: TabContext }) {
  const settings = await getSettings([ASSIGN_SLA_HOURS_KEY], { tenantId: ctx.tenantId });
  const slaHours = Number(settings[ASSIGN_SLA_HOURS_KEY] ?? 24);
  const branchId = await assignBranchOf(ctx);
  const monthAgoIso = new Date(ctx.nowMs - 30 * 86_400_000).toISOString();
  const [unassigned, assignedMonth] = await Promise.all([
    loadUnassignedProperties(ctx.supabase, ctx.tenantId, { nowMs: ctx.nowMs, slaHours, limit: 50, branchId }),
    ctx.supabase.from("pool_assignments").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).gte("created_at", monthAgoIso),
  ]);
  const historyAvailable = !assignedMonth.error;

  return (
    <div className="space-y-5">
      <StatRow
        label="Atama özeti"
        items={[
          { label: "Danışmansız ilan", value: unassigned.failed ? "—" : unassigned.total, href: assignHref(), icon: <Inbox />, attention: unassigned.total > 0 },
          { label: "SLA'sı geçen", value: unassigned.failed ? "—" : unassigned.breached, href: assignHref("gecikmis"), icon: <AlertTriangle />, attention: unassigned.breached > 0, hint: `${slaHours} saat sınırı` },
          { label: "Son 30 gün atama", value: historyAvailable ? assignedMonth.count ?? 0 : "—", href: assignHref("gecmis"), icon: <CheckCircle2 /> },
        ]}
      />
      <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold text-ink-950">Atama İlan Havuzu&apos;nda yapılır</p>
          <p className="text-sm text-text-muted">Danışmansız ilanlar, akıllı öneri, atama geçmişi, iptal ve yeniden atama tek ekranda.</p>
        </div>
        <ButtonLink href={assignHref()} iconRight={ArrowRight}>
          İlan Havuzu&apos;na git
        </ButtonLink>
      </div>
    </div>
  );
}
