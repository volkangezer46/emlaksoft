/**
 * Vitrin ilan listesi süzgeçleri — SAF (IO yok), testli (PUB-1 / PUB-2).
 *
 * URL ⇄ süzgeç TEK kaynak: `parseListingFilters` searchParams'ı doğrular (geçersiz değer sessizce boş sayılır), `listingHref`
 * bağlantıyı üretir (diğer süzgeçleri korur, süzgeç değişince sayfa 1'e döner), `toSearchRpcFilters` sunucu RPC'sinin
 * (`vitrin_listing_search`) jsonb girdisini verir. Ekrandaki çipler (`activeFilterChips`) tek dokunuşla süzgeci kaldırır.
 */

export const VITRIN_PAGE_SIZE = 24;
/** Sayfa üst sınırı: 24 × 400 ≈ 10 bin satır (RPC offset tavanıyla aynı). */
export const VITRIN_MAX_PAGE = 400;

export const VITRIN_SORT_OPTIONS = [
  { value: "", label: "En yeni (fotoğraflı önce)" },
  { value: "fiyat-artan", label: "Fiyat (artan)" },
  { value: "fiyat-azalan", label: "Fiyat (azalan)" },
  { value: "m2-fiyat", label: "m² fiyatı (artan)" },
] as const;
export type VitrinSort = (typeof VITRIN_SORT_OPTIONS)[number]["value"];

export const VITRIN_FLOOR_OPTIONS = [
  { value: "", label: "Kat (tümü)" },
  { value: "zemin-ustu", label: "1. kat ve üstü" },
  { value: "ara", label: "Ara kat" },
  { value: "en-ust", label: "En üst kat" },
  { value: "giris", label: "Giriş katı" },
] as const;
export type VitrinFloor = (typeof VITRIN_FLOOR_OPTIONS)[number]["value"];

export const VITRIN_AGE_OPTIONS = [
  { value: "", label: "Bina yaşı (tümü)" },
  { value: "0", label: "Sıfır bina" },
  { value: "5", label: "5 yaşa kadar" },
  { value: "10", label: "10 yaşa kadar" },
  { value: "20", label: "20 yaşa kadar" },
] as const;

export type VitrinTx = "" | "satilik" | "kiralik";

export type ListingFilters = {
  tx: VitrinTx;
  q: string;
  min: number | null;
  max: number | null;
  oda: string;
  tur: string;
  il: string;
  ilce: string;
  mahalle: string;
  m2min: number | null;
  m2max: number | null;
  yasmax: number | null;
  kat: VitrinFloor;
  esyali: boolean;
  site: boolean;
  kredi: boolean;
  sirala: VitrinSort;
  sayfa: number;
};

export type VitrinSearchParams = Record<string, string | string[] | undefined>;

export const EMPTY_FILTERS: ListingFilters = {
  tx: "",
  q: "",
  min: null,
  max: null,
  oda: "",
  tur: "",
  il: "",
  ilce: "",
  mahalle: "",
  m2min: null,
  m2max: null,
  yasmax: null,
  kat: "",
  esyali: false,
  site: false,
  kredi: false,
  sirala: "",
  sayfa: 1,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** "1.500.000" / "1500000 ₺" → sayı; geçersiz ya da ≤0 → null. */
export function parsePositiveInt(v: string, max = 1e12): number | null {
  const digits = v.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
}

function uuidOrEmpty(v: string): string {
  const s = v.trim();
  return UUID_RE.test(s) ? s.toLowerCase() : "";
}

const isOn = (v: string) => v === "1" || v === "on" || v === "true" || v === "evet";

export function parseListingFilters(sp: VitrinSearchParams): ListingFilters {
  const tx = one(sp.tx);
  const sirala = one(sp.sirala);
  const kat = one(sp.kat);
  const yas = one(sp.yas).trim();
  const rawPage = one(sp.sayfa).trim();
  const sayfa = /^\d{1,4}$/.test(rawPage) && Number(rawPage) >= 1 && Number(rawPage) <= VITRIN_MAX_PAGE ? Number(rawPage) : 1;
  let min = parsePositiveInt(one(sp.min));
  let max = parsePositiveInt(one(sp.max));
  if (min != null && max != null && min > max) [min, max] = [max, min];
  let m2min = parsePositiveInt(one(sp.m2min), 1_000_000);
  let m2max = parsePositiveInt(one(sp.m2max), 1_000_000);
  if (m2min != null && m2max != null && m2min > m2max) [m2min, m2max] = [m2max, m2min];
  return {
    tx: tx === "satilik" || tx === "kiralik" ? tx : "",
    q: one(sp.q).trim().replace(/\s+/g, " ").slice(0, 80),
    min,
    max,
    oda: one(sp.oda).trim().slice(0, 20),
    tur: one(sp.tur).trim().slice(0, 40),
    il: uuidOrEmpty(one(sp.il)),
    ilce: uuidOrEmpty(one(sp.ilce)),
    mahalle: uuidOrEmpty(one(sp.mahalle)),
    m2min,
    m2max,
    // "0" (sıfır bina) geçerli bir üst sınırdır.
    yasmax: /^\d{1,3}$/.test(yas) ? Number(yas) : null,
    kat: VITRIN_FLOOR_OPTIONS.some((o) => o.value === kat) ? (kat as VitrinFloor) : "",
    esyali: isOn(one(sp.esyali)),
    site: isOn(one(sp.site)),
    kredi: isOn(one(sp.kredi)),
    sirala: VITRIN_SORT_OPTIONS.some((o) => o.value === sirala) ? (sirala as VitrinSort) : "",
    sayfa,
  };
}

/** Sunucuda tek-istek önbellek anahtarı (React cache / unstable_cache): sıralı ve kararlı. */
export function filterKey(f: ListingFilters): string {
  return JSON.stringify(f, Object.keys(EMPTY_FILTERS).sort());
}

/** URL sorgu dizgisi (boş değerler yazılmaz; sabit sıra → önbellek dostu bağlantılar). */
export function filtersToQuery(f: ListingFilters): string {
  const p = new URLSearchParams();
  if (f.tx) p.set("tx", f.tx);
  if (f.tur) p.set("tur", f.tur);
  if (f.q) p.set("q", f.q);
  if (f.il) p.set("il", f.il);
  if (f.ilce) p.set("ilce", f.ilce);
  if (f.mahalle) p.set("mahalle", f.mahalle);
  if (f.min != null) p.set("min", String(f.min));
  if (f.max != null) p.set("max", String(f.max));
  if (f.oda) p.set("oda", f.oda);
  if (f.m2min != null) p.set("m2min", String(f.m2min));
  if (f.m2max != null) p.set("m2max", String(f.m2max));
  if (f.yasmax != null) p.set("yas", String(f.yasmax));
  if (f.kat) p.set("kat", f.kat);
  if (f.esyali) p.set("esyali", "1");
  if (f.site) p.set("site", "1");
  if (f.kredi) p.set("kredi", "1");
  if (f.sirala) p.set("sirala", f.sirala);
  if (f.sayfa > 1) p.set("sayfa", String(f.sayfa));
  return p.toString();
}

/**
 * Bağlantı: verilen alanları değiştirip diğer süzgeçleri korur. Sayfa dışında bir alan değişirse sayfa 1'e döner
 * (süzgeç değişince 5. sayfada boş liste görülmesin). İlçe değişirse mahalle, il değişirse ilçe+mahalle temizlenir.
 */
export function listingHref(slug: string, f: ListingFilters, patch: Partial<ListingFilters> = {}): string {
  const next: ListingFilters = { ...f, ...patch };
  if (!("sayfa" in patch)) next.sayfa = 1;
  if ("il" in patch && patch.il !== f.il) {
    if (!("ilce" in patch)) next.ilce = "";
    if (!("mahalle" in patch)) next.mahalle = "";
  }
  if ("ilce" in patch && patch.ilce !== f.ilce && !("mahalle" in patch)) next.mahalle = "";
  const s = filtersToQuery(next);
  return `/vitrin/${slug}${s ? `?${s}` : ""}`;
}

/** `vitrin_listing_search` RPC girdisi (jsonb). Anahtar adları migration 20261019010000 ile BİREBİR. */
export function toSearchRpcFilters(f: ListingFilters): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (f.tx) out.tx = f.tx;
  if (f.q) out.q = f.q;
  if (f.min != null) out.min = f.min;
  if (f.max != null) out.max = f.max;
  if (f.oda) out.rooms = f.oda;
  if (f.tur) out.type = f.tur;
  if (f.il) out.province = f.il;
  if (f.ilce) out.district = f.ilce;
  if (f.mahalle) out.neighborhood = f.mahalle;
  if (f.m2min != null) out.sqm_min = f.m2min;
  if (f.m2max != null) out.sqm_max = f.m2max;
  if (f.yasmax != null) out.age_max = f.yasmax;
  if (f.kat) out.floor = f.kat;
  if (f.esyali) out.furnished = true;
  if (f.site) out.in_site = true;
  if (f.kredi) out.credit = true;
  if (f.sirala) out.sort = f.sirala;
  return out;
}

/** Eski PostgREST yolunun (RPC yokken) desteklemediği süzgeçler — ekranda "şu an kullanılamıyor" denir, sessiz yok sayılmaz. */
export function hasAdvancedOnlyFilters(f: ListingFilters): boolean {
  return f.m2min != null || f.m2max != null || f.yasmax != null || Boolean(f.kat) || f.esyali || f.site || f.kredi || f.sirala === "m2-fiyat";
}

export function hasAnyFilter(f: ListingFilters): boolean {
  return filtersToQuery({ ...f, sayfa: 1 }) !== "";
}

/** Filtre panelindeki (sekme/tür çipleri dışı) etkin süzgeç sayısı — mobil "Filtrele (n)" rozeti. */
export function panelFilterCount(f: ListingFilters): number {
  return [
    f.q,
    f.il || f.ilce || f.mahalle,
    f.min != null || f.max != null,
    f.oda,
    f.m2min != null || f.m2max != null,
    f.yasmax != null,
    f.kat,
    f.esyali,
    f.site,
    f.kredi,
    f.sirala,
  ].filter(Boolean).length;
}

export type GeoLabel = { id: string; name: string };
export type FilterChip = { key: string; label: string; href: string };

const fmtInt = (n: number) => n.toLocaleString("tr-TR");

/** Uygulanan süzgeç çipleri: her çip kendi süzgecini kaldıran bağlantıdır (JS'siz). */
export function activeFilterChips(
  slug: string,
  f: ListingFilters,
  geo: { provinces: readonly GeoLabel[]; districts: readonly GeoLabel[]; neighborhoods: readonly GeoLabel[] },
): FilterChip[] {
  const nameOf = (list: readonly GeoLabel[], id: string) => list.find((g) => g.id === id)?.name ?? null;
  const chips: FilterChip[] = [];
  const add = (key: string, label: string, patch: Partial<ListingFilters>) => chips.push({ key, label, href: listingHref(slug, f, patch) });
  if (f.q) add("q", `“${f.q}”`, { q: "" });
  if (f.il) add("il", nameOf(geo.provinces, f.il) ?? "İl", { il: "" });
  if (f.ilce) add("ilce", nameOf(geo.districts, f.ilce) ?? "İlçe", { ilce: "" });
  if (f.mahalle) add("mahalle", nameOf(geo.neighborhoods, f.mahalle) ?? "Mahalle", { mahalle: "" });
  if (f.min != null || f.max != null) {
    const label =
      f.min != null && f.max != null
        ? `${fmtInt(f.min)} – ${fmtInt(f.max)}`
        : f.min != null
          ? `En az ${fmtInt(f.min)}`
          : `En çok ${fmtInt(f.max as number)}`;
    add("fiyat", label, { min: null, max: null });
  }
  if (f.oda) add("oda", f.oda, { oda: "" });
  if (f.m2min != null || f.m2max != null) {
    const label =
      f.m2min != null && f.m2max != null
        ? `${fmtInt(f.m2min)}–${fmtInt(f.m2max)} m²`
        : f.m2min != null
          ? `En az ${fmtInt(f.m2min)} m²`
          : `En çok ${fmtInt(f.m2max as number)} m²`;
    add("m2", label, { m2min: null, m2max: null });
  }
  if (f.yasmax != null) add("yas", f.yasmax === 0 ? "Sıfır bina" : `${f.yasmax} yaşa kadar`, { yasmax: null });
  if (f.kat) add("kat", VITRIN_FLOOR_OPTIONS.find((o) => o.value === f.kat)?.label ?? "Kat", { kat: "" });
  if (f.esyali) add("esyali", "Eşyalı", { esyali: false });
  if (f.site) add("site", "Site içinde", { site: false });
  if (f.kredi) add("kredi", "Krediye uygun", { kredi: false });
  if (f.sirala) add("sirala", VITRIN_SORT_OPTIONS.find((o) => o.value === f.sirala)?.label ?? "Sıralama", { sirala: "" });
  return chips;
}

/** Sayfa bilgisi: "25–48 / 137" ve toplam sayfa. */
export function pageInfo(total: number, page: number, size = VITRIN_PAGE_SIZE): { from: number; to: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= 0) return { from: 0, to: 0, pages };
  const from = Math.min((page - 1) * size + 1, total);
  const to = Math.min(page * size, total);
  return { from, to, pages };
}
