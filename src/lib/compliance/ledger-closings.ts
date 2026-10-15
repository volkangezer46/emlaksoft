import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Kapanmış (kazanılmış) ama yasal kayıt defterine işlenmemiş anlaşmalar (SP7). Oturumlu istemciyle okunur: anlaşma
 * görünürlüğü ve defter görünürlüğü RLS'tedir (danışman yalnız kendi kayıtlarını görür; bu yüzden bir meslektaşın
 * işlediği anlaşma danışmana "işlenmemiş" görünebilir — ofis sahibi/genel müdür ofisin tamamını görür).
 * Pencere: son 365 gün. Tablo/sütun yoksa boş liste + `available: false`.
 */
export type UnrecordedClosing = {
  id: string;
  dealType: "sale" | "rent";
  amount: number | null;
  closedDay: string;
  propertyLabel: string | null;
  customerName: string | null;
};

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function loadUnrecordedClosings(
  supabase: SupabaseClient,
  opts: { sinceDay: string; limit?: number },
): Promise<{ available: boolean; items: UnrecordedClosing[]; total: number }> {
  const { data: deals, error } = await supabase
    .from("deals")
    .select(
      "id, deal_type, deal_value, updated_at, property:properties!deals_property_id_fkey(title, property_code), customer:customers!deals_customer_id_fkey(full_name)",
    )
    .eq("stage", "won")
    .gte("updated_at", `${opts.sinceDay}T00:00:00+03:00`)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) return { available: false, items: [], total: 0 };
  const rows = (deals ?? []) as {
    id: string;
    deal_type: "sale" | "rent";
    deal_value: number | string | null;
    updated_at: string;
    property: Rel<{ title: string | null; property_code: string | null }>;
    customer: Rel<{ full_name: string | null }>;
  }[];
  if (rows.length === 0) return { available: true, items: [], total: 0 };

  const ids = rows.map((r) => r.id);
  const [ledgerRes, closedRes] = await Promise.all([
    supabase.from("compliance_ledger_entries").select("deal_id").in("deal_id", ids).limit(1000),
    // Kapanış anı (A8 deals.closed_at); sütun yoksa updated_at kullanılır.
    supabase.from("deals").select("id, closed_at").in("id", ids),
  ]);
  if (ledgerRes.error) return { available: false, items: [], total: 0 };
  const recorded = new Set(((ledgerRes.data ?? []) as { deal_id: string | null }[]).map((r) => r.deal_id).filter(Boolean));
  const closedAt = new Map<string, string>(
    closedRes.error
      ? []
      : ((closedRes.data ?? []) as { id: string; closed_at: string | null }[])
          .filter((r) => r.closed_at)
          .map((r) => [r.id, String(r.closed_at)]),
  );
  const trDay = (iso: string) => {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10) : iso.slice(0, 10);
  };

  const missing = rows.filter((r) => !recorded.has(r.id));
  const items = missing.slice(0, opts.limit ?? 20).map((r) => {
    const property = one(r.property);
    const customer = one(r.customer);
    return {
      id: r.id,
      dealType: r.deal_type,
      amount: r.deal_value != null && Number(r.deal_value) > 0 ? Number(r.deal_value) : null,
      closedDay: trDay(closedAt.get(r.id) ?? r.updated_at),
      propertyLabel: property?.title ?? property?.property_code ?? null,
      customerName: customer?.full_name ?? null,
    };
  });
  return { available: true, items, total: missing.length };
}
