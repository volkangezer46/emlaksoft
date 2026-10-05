/**
 * Portföy listesinin doğal dil arama + foto denetimi ile gelen ek filtreleri (saf, test edilebilir).
 *
 * URL kontratı: ?islem= ?oda= (virgüllü) ?fiyat_min= ?fiyat_max= ?m2_min= ?m2_max= ?kat_min= ?kat_max=
 * ?il= ?ilce= ?mahalle= ?foto=eksik. Hepsi sunucu sorgusuna iner (bellek filtresi yok).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_RE = /^\d{1,2}\+\d$/;

export type PropertyNlFilters = {
  islem: "Satılık" | "Kiralık" | null;
  oda: string[];
  fiyatMin: number | null;
  fiyatMax: number | null;
  m2Min: number | null;
  m2Max: number | null;
  katMin: number | null;
  katMax: number | null;
  il: string | null;
  ilce: string | null;
  mahalle: string | null;
  fotoEksik: boolean;
};

export type PropertyNlParams = {
  islem?: string;
  oda?: string;
  fiyat_min?: string;
  fiyat_max?: string;
  m2_min?: string;
  m2_max?: string;
  kat_min?: string;
  kat_max?: string;
  il?: string;
  ilce?: string;
  mahalle?: string;
  foto?: string;
};

function numParam(raw: string | undefined, max: number): number | null {
  if (!raw || !/^\d{1,12}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
}

function uuidParam(raw: string | undefined): string | null {
  return raw && UUID_RE.test(raw) ? raw : null;
}

export function normalizePropertyNlParams(sp: PropertyNlParams): PropertyNlFilters {
  const islem = sp.islem === "Satılık" || sp.islem === "Kiralık" ? sp.islem : null;
  const oda = (sp.oda ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ROOM_RE.test(s))
    .slice(0, 6);
  return {
    islem,
    oda,
    fiyatMin: numParam(sp.fiyat_min, 1e12),
    fiyatMax: numParam(sp.fiyat_max, 1e12),
    m2Min: numParam(sp.m2_min, 1e6),
    m2Max: numParam(sp.m2_max, 1e6),
    katMin: numParam(sp.kat_min, 200),
    katMax: numParam(sp.kat_max, 200),
    il: uuidParam(sp.il),
    ilce: uuidParam(sp.ilce),
    mahalle: uuidParam(sp.mahalle),
    fotoEksik: sp.foto === "eksik",
  };
}

/** Doğrulanmış filtrelerin URL karşılığı (sayfalama/çip bağlantıları bayat parametre taşımasın). */
export function propertyNlUrlParams(f: PropertyNlFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.islem) out.islem = f.islem;
  if (f.oda.length) out.oda = f.oda.join(",");
  if (f.fiyatMin != null) out.fiyat_min = String(f.fiyatMin);
  if (f.fiyatMax != null) out.fiyat_max = String(f.fiyatMax);
  if (f.m2Min != null) out.m2_min = String(f.m2Min);
  if (f.m2Max != null) out.m2_max = String(f.m2Max);
  if (f.katMin != null) out.kat_min = String(f.katMin);
  if (f.katMax != null) out.kat_max = String(f.katMax);
  if (f.il) out.il = f.il;
  if (f.ilce) out.ilce = f.ilce;
  if (f.mahalle) out.mahalle = f.mahalle;
  if (f.fotoEksik) out.foto = "eksik";
  return out;
}

export function hasPropertyNlFilters(f: PropertyNlFilters): boolean {
  return Object.keys(propertyNlUrlParams(f)).length > 0;
}

/** supabase-js filtre kurucusunun kullandığımız alt kümesi (tip karmaşasını sayfaya taşımamak için). */
type Chainable = {
  eq(column: string, value: string | number): Chainable;
  in(column: string, values: readonly string[]): Chainable;
  gte(column: string, value: number): Chainable;
  lte(column: string, value: number): Chainable;
};

/**
 * Filtreleri sorguya uygular. `features` jsonb içindeki oda (`rooms`, metin) ve alan/kat (`sqm`, `floor`,
 * sayı) için `->>` yalnız metin eşitliğinde, sayısal karşılaştırmada `->` (jsonb) kullanılır: jsonb sayılar
 * sayısal sıralanır, `->>` metin sıralaması "9" > "100" hatası verirdi.
 */
export function applyPropertyNlFilters<T>(query: T, f: PropertyNlFilters): T {
  let q = query as unknown as Chainable;
  if (f.islem) q = q.eq("transaction_type", f.islem);
  if (f.oda.length) q = q.in("features->>rooms", f.oda);
  if (f.fiyatMin != null) q = q.gte("list_price", f.fiyatMin);
  if (f.fiyatMax != null) q = q.lte("list_price", f.fiyatMax);
  if (f.m2Min != null) q = q.gte("features->sqm", f.m2Min);
  if (f.m2Max != null) q = q.lte("features->sqm", f.m2Max);
  if (f.katMin != null) q = q.gte("features->floor", f.katMin);
  if (f.katMax != null) q = q.lte("features->floor", f.katMax);
  if (f.il) q = q.eq("province_id", f.il);
  if (f.ilce) q = q.eq("district_id", f.ilce);
  if (f.mahalle) q = q.eq("neighborhood_id", f.mahalle);
  return q as unknown as T;
}
