/**
 * "Son indirmeler": denetim kaydından, kullanıcı bazlı (SUNUCU). Kiracıda `audit_logs` (RLS'li istemci),
 * platformda `platform_audit_logs`. Filtre değerleri denetim kaydında yalnız ham olmayan alanlar için saklıdır
 * (serbest metin "(metin)" olarak maskelidir); yeniden açarken bu alanlar atlanır.
 */
import {
  PLATFORM_REPORT_EXPORT_ACTION_NAME as PLATFORM_REPORT_EXPORT_ACTION,
  REPORT_EXPORT_ACTION_NAME as REPORT_EXPORT_ACTION,
} from "./export-actions";
import { getReport } from "./registry";
import type { ReportContext, Row } from "./types";

export type RecentDownload = {
  id: string;
  at: string;
  reportId: string;
  title: string;
  format: string;
  rows: number;
  truncated: boolean;
  filters: Record<string, string>;
};

export async function loadRecentDownloads(ctx: ReportContext, limit = 8): Promise<RecentDownload[]> {
  try {
    const platform = ctx.scope === "platform";
    const q = platform
      ? ctx.supabase.from("platform_audit_logs").select("id, created_at, entity_type, meta").eq("actor_id", ctx.userId).eq("action", PLATFORM_REPORT_EXPORT_ACTION)
      : ctx.supabase.from("audit_logs").select("id, created_at, entity_type, new_value").eq("tenant_id", ctx.tenantId!).eq("actor_id", ctx.userId).eq("action", REPORT_EXPORT_ACTION);
    const { data } = await q.order("created_at", { ascending: false }).limit(limit);
    const out: RecentDownload[] = [];
    for (const r of (data ?? []) as Row[]) {
      const v = (platform ? r.meta : r.new_value) as Row | null;
      const def = getReport(ctx.scope, String(r.entity_type ?? v?.report ?? ""));
      if (!def) continue;
      const filters: Record<string, string> = {};
      for (const [k, val] of Object.entries((v?.filters ?? {}) as Record<string, unknown>)) {
        if (typeof val === "string" && val !== "(metin)") filters[k] = val;
      }
      out.push({
        id: String(r.id),
        at: String(r.created_at),
        reportId: def.id,
        title: def.title,
        format: String(v?.format ?? ""),
        rows: Number(v?.rows ?? 0),
        truncated: v?.truncated === true,
        filters,
      });
    }
    return out;
  } catch {
    return [];
  }
}
