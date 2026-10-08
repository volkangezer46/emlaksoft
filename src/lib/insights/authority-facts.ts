import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRowsKeepError } from "@/lib/supabase/fetch-all";
import { trDayKey } from "@/lib/clock";
import { InsightFactsUnavailable, isMissingSchemaError } from "@/lib/insights/facts";
import { AUTHORITY_EXPIRED_MAX_DAYS, type AuthorityExpiredFact } from "@/lib/insights/rules/authority-expired";

/**
 * authority_expired@1 olguları. `admin` engine'den gelir (istemci OLUŞTURULMAZ); sorgu AÇIK tenant_id filtreli, örnek veri
 * (is_sample) ve kapanmış portföyler dışarıda. Yalnız yayında (`live`) ve danışmanı olan portföy.
 */
const DAY = 86_400_000;
const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetweenKeys = (fromKey: string, toKey: string) => Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY);

export async function loadExpiredAuthorities(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<AuthorityExpiredFact[]> {
  const today = trDayKey(nowMs);
  const { data, error } = await fetchAllRowsKeepError<
    { id: string; title: string | null; property_code: string | null; assigned_to: string | null; authorization_end: string },
    { message: string; code?: string }
  >((from, to) =>
    admin
      .from("properties")
      .select("id, title, property_code, assigned_to, authorization_end")
      .eq("tenant_id", tenantId)
      .eq("status", "live")
      .eq("is_sample", false)
      .is("deleted_at", null)
      .not("assigned_to", "is", null)
      .lt("authorization_end", today)
      .gte("authorization_end", addDays(today, -AUTHORITY_EXPIRED_MAX_DAYS))
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (error) {
    if (isMissingSchemaError(error)) throw new InsightFactsUnavailable("properties(authority_expired)");
    throw new Error(`properties(authority_expired): ${error.code ?? "hata"}`);
  }
  return data.map((p) => ({
    propertyId: p.id,
    assignedTo: String(p.assigned_to),
    label: p.title ?? p.property_code,
    endDate: String(p.authorization_end).slice(0, 10),
    daysOverdue: daysBetweenKeys(String(p.authorization_end).slice(0, 10), today),
  }));
}
