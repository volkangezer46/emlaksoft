import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { OPEN_LISTING_OR_FILTER } from "@/lib/closed-listing";
import { formatPublicPrice, listingCurrency } from "@/lib/public-price";

/**
 * Talep formunun ilan bağlamı (COM-13). Ofis sitesine/tabelaya gömülen form `?ilan=<portföy kimliği | kodu>` taşır;
 * sunucu bunu YALNIZ o ofise ait, yayındaki (live, silinmemiş, örnek olmayan, kapanmamış) portföye çözer. Başka ofisin
 * ya da yayında olmayan portföy kimliği sessizce yok sayılır (IDOR yok, var/yok bilgisi sızmaz).
 */

export type LeadListing = {
  id: string;
  code: string | null;
  title: string | null;
  priceText: string | null;
  place: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

/** URL/gövdeden gelen ilan referansını sınırlar; geçersiz biçim = null (sorguya gitmez). */
export function normalizeListingRef(raw: unknown): { kind: "id" | "code"; value: string } | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (UUID_RE.test(v)) return { kind: "id", value: v.toLowerCase() };
  if (CODE_RE.test(v)) return { kind: "code", value: v };
  return null;
}

/** Talep notunun ilk satırı: "İlgilendiği ilan: K-123 · 3+1 Daire · 4.500.000 ₺". */
export function listingContextLine(l: Pick<LeadListing, "code" | "title" | "priceText">): string {
  return `İlgilendiği ilan: ${[l.code, l.title, l.priceText].filter(Boolean).join(" · ") || "portföy"}`;
}

function rel<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

export async function loadLeadListing(
  admin: SupabaseClient,
  tenantId: string,
  rawRef: unknown,
): Promise<LeadListing | null> {
  const ref = normalizeListingRef(rawRef);
  if (!ref) return null;
  try {
    let q = admin
      .from("properties")
      .select("id, property_code, title, transaction_type, list_price, features, province:geo_provinces(name), district:geo_districts(name)")
      .eq("tenant_id", tenantId)
      .eq("status", "live")
      .is("deleted_at", null)
      .eq("is_sample", false)
      .or(OPEN_LISTING_OR_FILTER);
    q = ref.kind === "id" ? q.eq("id", ref.value) : q.eq("property_code", ref.value);
    const { data, error } = await q.limit(2);
    if (error || !data || data.length !== 1) return null;
    const p = data[0] as Record<string, unknown>;
    const price = p.list_price != null ? Number(p.list_price) : null;
    const district = rel(p.district as { name?: string } | { name?: string }[] | null)?.name ?? null;
    const province = rel(p.province as { name?: string } | { name?: string }[] | null)?.name ?? null;
    return {
      id: String(p.id),
      code: (p.property_code as string | null) ?? null,
      title: (p.title as string | null) ?? null,
      priceText: price != null && Number.isFinite(price)
        ? formatPublicPrice(price, p.transaction_type as string | null, listingCurrency(p.features))
        : null,
      place: [district, province].filter(Boolean).join(", ") || null,
    };
  } catch {
    return null;
  }
}
