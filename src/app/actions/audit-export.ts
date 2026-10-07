"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { trDayKey } from "@/lib/clock";
import { mapAudit, toCsv } from "@/lib/export-entities";
import { hasOfficeWideDataScope } from "@/lib/permission-data-scope";
import { getEffectivePermissions } from "@/lib/permissions-effective";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { logActivity } from "@/lib/activity";
import { applyAuditFilters, normalizeAuditFilters, type AuditFilters } from "@/lib/audit-filters";
import type { ExportResult } from "@/app/actions/export";
import { actionErrorMessage } from "@/lib/action-errors";

const EXPORT_LIMIT = 2000;

/**
 * Denetim kaydı CSV'si EKRANDAKİ filtreyi uygular (tarih, aktör, risk, işlem türü, arama).
 * Kapsam kuralı `exportAuditCsv` ile aynı: ofis geneli + earnings_all yoksa yalnız kendi kayıtları.
 */
export async function exportAuditCsvFiltered(filters: Partial<AuditFilters> = {}): Promise<ExportResult> {
  const gate = await requirePermission("settings", "view");
  if (!gate.ok) return { error: gate.error };
  const f = normalizeAuditFilters(filters);

  const supabase = await createClient();
  let q = applyAuditFilters(
    supabase
      .from("audit_logs")
      .select("action, entity_type, entity_id, actor_id, old_value, new_value, created_at")
      .eq("tenant_id", gate.tenantId)
      .order("created_at", { ascending: false })
      .limit(EXPORT_LIMIT),
    f,
  );
  const seeAll = canSeeAllEarnings(await getEffectivePermissions(gate.tenantId, gate.role, gate.userId));
  if (!hasOfficeWideDataScope(gate.role) || !seeAll) q = q.eq("actor_id", gate.userId);
  const { data, error } = await q;
  if (error) {
    console.error("exportAuditCsvFiltered", error);
    return { error: actionErrorMessage(error, "Dışa aktarma başarısız. Lütfen tekrar deneyin.") };
  }

  const actorIds = [...new Set((data ?? []).map((r) => r.actor_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (actorIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("tenant_id", gate.tenantId)
      .in("id", actorIds);
    for (const p of profiles ?? []) names.set(p.id, p.full_name);
  }

  const rows = (data ?? []).map((r) => mapAudit(r, names));
  const truncated = rows.length >= EXPORT_LIMIT;
  let csv = toCsv(rows);
  if (truncated) csv += `\n"UYARI: Yalnızca ilk ${EXPORT_LIMIT} kayıt dışa aktarıldı. Tamamı için filtreyi daraltın."`;
  const filename = `denetim-${trDayKey()}.csv`;
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "export.csv",
    entityType: "denetim",
    newValue: { rows: rows.length, truncated, filename, filtered: Object.values(f).some(Boolean) },
  });
  return { csv, filename, truncated, rowCount: rows.length, entity: "denetim" };
}
