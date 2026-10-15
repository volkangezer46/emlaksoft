import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRowsKeepError } from "@/lib/supabase/fetch-all";
import { trDayKey } from "@/lib/clock";
import { addDaysKey, VALIDITY_SOON_DAYS } from "@/lib/documents";
import { InsightFactsUnavailable, isMissingSchemaError } from "@/lib/insights/facts";
import { DOCUMENT_EXPIRED_MAX_DAYS, type DocumentExpiryFact } from "@/lib/insights/rules/document-expiry";

/**
 * document_expiry@1 olguları. `admin` engine'den gelir (istemci OLUŞTURULMAZ); sorgu AÇIK tenant_id filtreli.
 * Silinmiş ve örnek (is_sample) müşterilerin belgeleri dışarıda. Sütun (20261016110200) yoksa kural "etkin değil".
 */
const DAY = 86_400_000;
const daysBetweenKeys = (fromKey: string, toKey: string) =>
  Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY);

type Row = {
  id: string;
  customer_id: string;
  file_name: string;
  label: string | null;
  valid_until: string;
  customer:
    | { full_name: string | null; assigned_to: string | null; deleted_at: string | null; is_sample: boolean | null }
    | { full_name: string | null; assigned_to: string | null; deleted_at: string | null; is_sample: boolean | null }[]
    | null;
};

export async function loadDocumentExpiryFacts(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<DocumentExpiryFact[]> {
  const today = trDayKey(nowMs);
  const { data, error } = await fetchAllRowsKeepError<Row, { message: string; code?: string }>((from, to) =>
    admin
      .from("customer_files")
      .select(
        "id, customer_id, file_name, label, valid_until, customer:customers!customer_files_customer_id_fkey!inner(full_name, assigned_to, deleted_at, is_sample)",
      )
      .eq("tenant_id", tenantId)
      .not("valid_until", "is", null)
      .gte("valid_until", addDaysKey(today, -DOCUMENT_EXPIRED_MAX_DAYS))
      .lte("valid_until", addDaysKey(today, VALIDITY_SOON_DAYS))
      .is("customer.deleted_at", null)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string; code?: string } | null }>,
  );
  if (error) {
    if (error.code === "42703" || isMissingSchemaError(error)) throw new InsightFactsUnavailable("customer_files.valid_until");
    throw new Error(`customer_files(document_expiry): ${error.code ?? "hata"}`);
  }
  const facts: DocumentExpiryFact[] = [];
  for (const r of data) {
    const c = Array.isArray(r.customer) ? r.customer[0] : r.customer;
    if (!c || c.deleted_at || c.is_sample) continue;
    const key = String(r.valid_until).slice(0, 10);
    facts.push({
      fileId: r.id,
      customerId: r.customer_id,
      customerName: c.full_name,
      fileName: r.file_name,
      label: r.label,
      validUntil: key,
      daysLeft: daysBetweenKeys(today, key),
      assignedTo: c.assigned_to ?? null,
    });
  }
  return facts;
}
