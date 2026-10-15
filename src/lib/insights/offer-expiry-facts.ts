import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRowsKeepError } from "@/lib/supabase/fetch-all";
import { trDayKey } from "@/lib/clock";
import { addDaysToKey, daysUntilOfferExpiry, OFFER_REMINDER_STATUSES } from "@/lib/offer-expiry";
import { InsightFactsUnavailable, isMissingSchemaError } from "@/lib/insights/facts";
import { OFFER_EXPIRY_WINDOW_DAYS, type OfferExpiryFact } from "@/lib/insights/rules/offer-expiry";

/**
 * offer_expiry@1 olguları. `admin` engine'den gelir (istemci OLUŞTURULMAZ); sorgu AÇIK tenant_id filtreli.
 * Yalnız yanıt bekleyen (OFFER_REMINDER_STATUSES) ve geçerliliği bugün…+3 gün olan gerçek (is_sample=false) teklifler.
 * Sayfalı ve üst sınırsız: canlı küme kapatma için güvenilir.
 */
type Rel<T> = T | T[] | null;
type Row = {
  id: string;
  created_by: string | null;
  amount: number | string | null;
  currency: string | null;
  status: string;
  valid_until: string;
  property: Rel<{ property_code: string | null }>;
  customer: Rel<{ full_name: string | null }>;
};
const one = <T>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function loadOfferExpiryFacts(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<OfferExpiryFact[]> {
  const today = trDayKey(nowMs);
  const { data, error } = await fetchAllRowsKeepError<Row, { message: string; code?: string }>((from, to) =>
    admin
      .from("offers")
      .select(
        "id, created_by, amount, currency, status, valid_until, property:properties!offers_property_id_fkey(property_code), customer:customers!offers_customer_id_fkey(full_name)",
      )
      .eq("tenant_id", tenantId)
      .eq("is_sample", false)
      .in("status", [...OFFER_REMINDER_STATUSES])
      .gte("valid_until", today)
      .lte("valid_until", addDaysToKey(today, OFFER_EXPIRY_WINDOW_DAYS))
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string; code?: string } | null }>,
  );
  if (error) {
    if (error.code === "42703" || isMissingSchemaError(error)) throw new InsightFactsUnavailable("offers.valid_until");
    throw new Error(`offers(offer_expiry): ${error.code ?? "hata"}`);
  }
  const facts: OfferExpiryFact[] = [];
  for (const r of data) {
    const key = String(r.valid_until).slice(0, 10);
    const daysLeft = daysUntilOfferExpiry(key, today);
    if (daysLeft === null) continue;
    const amount = r.amount === null ? null : Number(r.amount);
    facts.push({
      offerId: r.id,
      propertyCode: one(r.property)?.property_code ?? null,
      customerName: one(r.customer)?.full_name ?? null,
      amount: amount !== null && Number.isFinite(amount) ? amount : null,
      currency: r.currency,
      status: r.status,
      validUntil: key,
      daysLeft,
      advisorId: r.created_by ?? null,
    });
  }
  return facts;
}
