import type { SupabaseClient } from "@supabase/supabase-js";
import { trMonthStartMsFromKey, shiftMonthKey } from "@/lib/clock";
import { fetchAllRowsKeepError } from "@/lib/supabase/fetch-all";
import { computeComplianceReport, type ComplianceReport, type ComplianceTask } from "./actions-core";

/**
 * Yetki uyum raporu okuyucusu (aylık) — oturumlu istemci (RLS), service_role yok. Hem /app/raporlar/yetki-uyum hem
 * ofis karnesi (ofis-kontrol/karne) AYNI hesabı kullanır (tek kaynak: `computeComplianceReport`).
 *
 * Kaldırma kalemleri ay içinde AÇILAN `eids_takedown` görevlerinden; portföy oranları bugünkü kapsamdaki portföylerden
 * (e-posta teyidi EP2 `authority_eids_source`'tan; sütun yoksa oran gösterilmez). Tablo/sütun yoksa `available:false`.
 */
const CLOSED = "(sold,rented,archived,withdrawn,passive)";

type StatusRow = { authority_eids_status: string | null; authority_eids_source?: string | null };

/** Kapsamdaki portföylerin yetki durumu (sayfalı; PostgREST 1000 satır sınırı sessizce kesmesin). */
function readStatuses(supabase: SupabaseClient, tenantId: string, columns: string) {
  return fetchAllRowsKeepError<StatusRow, { message: string; code?: string }>(
    (from, to) =>
      supabase
        .from("properties")
        .select(columns)
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .eq("is_sample", false)
        .not("status", "in", CLOSED)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: StatusRow[] | null; error: { message: string; code?: string } | null }>,
    1000,
    20,
  );
}

export type ComplianceLoad =
  | { available: false }
  | { available: true; monthKey: string; report: ComplianceReport; byAdvisor: Map<string, ComplianceReport>; tasks: ComplianceTask[] };

export async function loadComplianceReport(supabase: SupabaseClient, tenantId: string, monthKey: string, nowMs: number): Promise<ComplianceLoad> {
  const startMs = trMonthStartMsFromKey(monthKey);
  const next = shiftMonthKey(monthKey, 1);
  if (!Number.isFinite(startMs) || !next) return { available: false };
  const endMs = trMonthStartMsFromKey(next);

  const [tasksRes, propsRes] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, created_at, completed_at, status, assigned_to")
      .eq("tenant_id", tenantId)
      .eq("kind", "eids_takedown")
      .neq("status", "cancelled")
      .gte("created_at", new Date(startMs).toISOString())
      .lt("created_at", new Date(endMs).toISOString())
      .limit(1000),
    readStatuses(supabase, tenantId, "authority_eids_status, authority_eids_source"),
  ]);
  if (tasksRes.error) return { available: false };

  let portfolio: { total: number; emailVerified: number; unknown: number } | null = null;
  let propRows = propsRes.data as { authority_eids_status: string | null; authority_eids_source?: string | null }[] | null;
  let sourceKnown = !propsRes.error;
  if (propsRes.error) {
    // EP2 kaynak sütunu yoksa yalnız durum okunur; e-posta oranı gösterilmez.
    const fallback = await readStatuses(supabase, tenantId, "authority_eids_status");
    propRows = fallback.error ? null : (fallback.data as { authority_eids_status: string | null }[]);
    sourceKnown = false;
  }
  if (propRows) {
    portfolio = {
      total: propRows.length,
      emailVerified: sourceKnown ? propRows.filter((p) => p.authority_eids_source === "email_verified").length : 0,
      unknown: propRows.filter((p) => !p.authority_eids_status || p.authority_eids_status === "unknown").length,
    };
  }

  const tasks = (tasksRes.data ?? []) as ComplianceTask[];
  const report = computeComplianceReport({ tasks, portfolio, nowMs });
  if (!sourceKnown) report.emailVerifiedPct = null;
  const groups = new Map<string, ComplianceTask[]>();
  for (const t of tasks) {
    const k = t.assigned_to ?? "";
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const byAdvisor = new Map<string, ComplianceReport>();
  for (const [k, list] of groups) byAdvisor.set(k, computeComplianceReport({ tasks: list, portfolio: null, nowMs }));
  return { available: true, monthKey, report, byAdvisor, tasks };
}
