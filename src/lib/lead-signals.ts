import type { SupabaseClient } from "@supabase/supabase-js";

/** customer_lead_signals RPC satırı (müşteri başına etkileşim özeti). */
export type LeadSignalRow = {
  customer_id: string;
  active_demands: number;
  comms: number;
  appts: number;
  calls: number;
  last_activity: string | null;
};

/** RPC başına id sayısı (customer_heat_signals ile aynı; URL/gövde boyutu ve plan maliyeti için). */
export const LEAD_SIGNAL_CHUNK = 500;

function isMissingFunction(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return /could not find the function|does not exist/i.test(error.message ?? "");
}

/**
 * Yalnız verilen müşteri id'leri için lead sinyalleri. Eski `customer_lead_signals(p_tenant_id)`
 * tenant'taki TÜM müşterileri döndürür ve PostgREST 1000 satırda keser; bu yardımcı yeni
 * `(p_tenant_id, p_customer_ids)` aşırı yüklemesini kullanır (migration 20260826001400).
 * Migration henüz uygulanmamışsa eski imzaya düşer ve sonucu id'lere göre süzer (güvenli geri dönüş).
 * Hata değer olarak döner; çağıran assertQueryBatchSucceeded ile ya da kendi politikasıyla ele alır.
 */
export async function fetchLeadSignals(
  supabase: SupabaseClient,
  tenantId: string | null | undefined,
  customerIds: readonly string[],
): Promise<{ data: LeadSignalRow[]; error: { code?: string; message?: string } | null }> {
  if (!tenantId || customerIds.length === 0) return { data: [], error: null };
  const ids = [...new Set(customerIds)];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += LEAD_SIGNAL_CHUNK) chunks.push(ids.slice(i, i + LEAD_SIGNAL_CHUNK));

  const results = await Promise.all(
    chunks.map((c) => supabase.rpc("customer_lead_signals", { p_tenant_id: tenantId, p_customer_ids: c })),
  );
  const missing = results.find((r) => isMissingFunction(r.error));
  if (missing) {
    // Yeni aşırı yükleme yok (migration uygulanmamış): eski imza, istenen id'lere süzülür.
    const legacy = await supabase.rpc("customer_lead_signals", { p_tenant_id: tenantId });
    if (legacy.error) return { data: [], error: legacy.error };
    const wanted = new Set(ids);
    return {
      data: ((legacy.data ?? []) as LeadSignalRow[]).filter((r) => wanted.has(r.customer_id)),
      error: null,
    };
  }
  const failed = results.find((r) => r.error);
  if (failed) return { data: [], error: failed.error };
  return { data: results.flatMap((r) => (r.data as LeadSignalRow[] | null) ?? []), error: null };
}
