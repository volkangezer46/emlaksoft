/**
 * Müşteri listesi filtresi: ekran (searchParams) ve CSV dışa aktarma AYNI kurucuyu kullanır.
 * Filtre eklerken yalnız burası değişir; liste ile dışa aktarma ayrışamaz (P1-C4).
 * Saf modül: "use server" değil, istemciden de içe aktarılabilir (searchParams → filtre).
 */

export type CustomerListFilters = {
  q: string;
  type: string;
  source: string;
  etiket: string;
  assigned: string;
  from: string;
  to: string;
  /** Sıcaklık segmenti (skor bellekte hesaplanır; sorguya uygulanmaz): sicak | ilgili | soguk | uykuda */
  segment: string;
};

export const HEAT_SEGMENT_KEYS = ["sicak", "ilgili", "soguk", "uykuda"] as const;

export const EMPTY_CUSTOMER_FILTERS: CustomerListFilters = {
  q: "",
  type: "",
  source: "",
  etiket: "",
  assigned: "",
  from: "",
  to: "",
  segment: "",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Raw = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** URL searchParams (ya da istemciden gelen serbest nesne) → doğrulanmış filtre. */
export function normalizeCustomerFilters(sp: Raw | Partial<CustomerListFilters>): CustomerListFilters {
  const r = sp as Raw;
  const from = one(r.from);
  const to = one(r.to);
  return {
    q: one(r.q).slice(0, 200),
    type: one(r.type).slice(0, 80),
    source: one(r.source).slice(0, 80),
    etiket: one(r.etiket).trim().slice(0, 80),
    assigned: one(r.assigned).slice(0, 80),
    // Yalnız YYYY-MM-DD: bozuk tarih sorguyu sessizce boşaltmasın
    from: ISO_DATE.test(from) ? from : "",
    to: ISO_DATE.test(to) ? to : "",
    segment: (HEAT_SEGMENT_KEYS as readonly string[]).includes(one(r.segment)) ? one(r.segment) : "",
  };
}

/** Arama terimi: `.or()` sözdizimini bozan karakterler ayıklanır. */
export function customerSearchTerm(q: string): string {
  return q.trim().replace(/[%_,()]/g, " ").trim();
}

export function hasCustomerFilters(f: CustomerListFilters): boolean {
  return Boolean(f.segment || f.type || f.etiket || f.source || f.assigned || f.from || f.to || customerSearchTerm(f.q));
}

type Chainable = {
  contains: (column: string, value: unknown) => Chainable;
  eq: (column: string, value: unknown) => Chainable;
  gte: (column: string, value: unknown) => Chainable;
  lte: (column: string, value: unknown) => Chainable;
  or: (filters: string) => Chainable;
};

/** Filtreyi `customers` sorgusuna uygular (ana liste, sıcaklık havuzu ve CSV aynı yolu kullanır). */
export function applyCustomerFilters<Q>(query: Q, f: CustomerListFilters): Q {
  let b = query as unknown as Chainable;
  if (f.type) b = b.contains("customer_types", [f.type]);
  if (f.etiket) b = b.contains("tags", [f.etiket]);
  if (f.source) b = b.eq("source", f.source);
  if (f.assigned) b = b.eq("assigned_to", f.assigned);
  if (f.from) b = b.gte("created_at", f.from);
  if (f.to) b = b.lte("created_at", `${f.to}T23:59:59.999`);
  const term = customerSearchTerm(f.q);
  if (term) {
    const pattern = `%${term}%`;
    const orParts = [`full_name.ilike.${pattern}`, `phone.ilike.${pattern}`, `email.ilike.${pattern}`];
    // "0532 111 22 33" gibi biçimli girdiler normalize kayıtla eşleşsin
    const digits = term.replace(/\D/g, "");
    if (digits.length >= 3 && digits !== term) orParts.push(`phone.ilike.%${digits}%`);
    b = b.or(orParts.join(","));
  }
  return b as unknown as Q;
}

/**
 * Sıcaklık segmenti havuz sınırı — TEK KAYNAK. Ekrandaki segment sayıları/filtre ile CSV dışa aktarma
 * (customer-heat-export) aynı filtrelenmiş listenin aynı ilk N kaydını skorlar; böylece ekran ve dosya tutarlı kalır.
 */
export const HEAT_POOL_LIMIT = 2000;
/** Isı sinyali RPC'sine tek çağrıda gönderilen azami müşteri kimliği. */
export const HEAT_RPC_CHUNK = 500;
