/**
 * Anlaşma seçici/rozet etiketi TEK kaynağı (görev formu, görev kartı, gider/teklif bağları).
 * "Müşteri · Portföy kodu" ; ikisi de yoksa işlem türü. Saf modül (istemci de kullanır).
 */
type Rel<T> = T | T[] | null | undefined;

function one<T>(v: Rel<T>): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export type DealOptionSource = {
  id: string;
  deal_type?: string | null;
  customer?: Rel<{ full_name?: string | null }>;
  property?: Rel<{ property_code?: string | null; title?: string | null }>;
};

export function dealOptionLabel(d: DealOptionSource): string {
  const customer = one(d.customer)?.full_name?.trim() || null;
  const prop = one(d.property);
  const propText = prop?.property_code?.trim() || prop?.title?.trim() || null;
  const parts = [customer, propText].filter((x): x is string => Boolean(x));
  if (parts.length > 0) return parts.join(" · ");
  return d.deal_type === "rent" ? "Kiralama anlaşması" : "Satış anlaşması";
}

/** Gömme seçimi: deals tablosundan etiket için gereken alanlar (FK adlı). */
export const DEAL_OPTION_SELECT =
  "id, deal_type, customer:customers!deals_customer_id_fkey(full_name), property:properties!deals_property_id_fkey(property_code, title)";
