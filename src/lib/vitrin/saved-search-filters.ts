/**
 * Vitrin kayıtlı arama GELİŞMİŞ süzgeçleri (PUB-2 → "Aramamı kaydet") — SAF (IO yok), testli.
 *
 * Ziyaretçi listede tür / mahalle / m² / bina yaşı / kat / eşyalı / site içi / krediye uygun süzgeci uygulayıp "Aramamı
 * kaydet" dediğinde bu süzgeçler `vitrin_saved_searches.filters` (jsonb) sütununa yazılır; günlük vitrin-eslesme cron'u
 * yeni yayına giren ilanı aynı kurallarla eşleştirir. Anahtar adları ve eşleşme kuralları `vitrin_listing_search`
 * RPC'siyle (migration 20261019010000) BİREBİR: liste neyi gösteriyorsa bildirim de onu sayar.
 *
 * Temel kriterler (işlem türü, il/ilçe, fiyat, oda) kutunun kendi alanlarında kalır; burada YALNIZ ek süzgeçler var.
 */
import { VITRIN_FLOOR_OPTIONS, type ListingFilters, type VitrinFloor } from "@/lib/vitrin/listing-filters";

export type SavedSearchFilters = {
  type?: string;
  neighborhood?: string;
  sqm_min?: number;
  sqm_max?: number;
  age_max?: number;
  floor?: Exclude<VitrinFloor, "">;
  furnished?: true;
  in_site?: true;
  credit?: true;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function posInt(v: unknown, max: number): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,9}$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= max ? n : undefined;
}

/** Listeden (URL süzgeçleri) kayda: yalnız dolu ek süzgeçler. */
export function savedSearchFiltersFromListing(f: ListingFilters): SavedSearchFilters {
  const out: SavedSearchFilters = {};
  if (f.tur) out.type = f.tur;
  if (f.mahalle && f.ilce) out.neighborhood = f.mahalle;
  if (f.m2min != null) out.sqm_min = f.m2min;
  if (f.m2max != null) out.sqm_max = f.m2max;
  if (f.yasmax != null) out.age_max = f.yasmax;
  if (f.kat) out.floor = f.kat;
  if (f.esyali) out.furnished = true;
  if (f.site) out.in_site = true;
  if (f.kredi) out.credit = true;
  return out;
}

/**
 * Güvenilmeyen girdi (istemci / DB satırı) → doğrulanmış süzgeç. Bilinmeyen anahtar ve geçersiz değer sessizce düşer;
 * m² aralığı ters girildiyse düzeltilir.
 */
export function sanitizeSavedSearchFilters(raw: unknown): SavedSearchFilters {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: SavedSearchFilters = {};
  const type = typeof r.type === "string" ? r.type.trim().slice(0, 40) : "";
  if (type) out.type = type;
  if (typeof r.neighborhood === "string" && UUID_RE.test(r.neighborhood.trim())) out.neighborhood = r.neighborhood.trim().toLowerCase();
  let sqmMin = posInt(r.sqm_min, 1_000_000);
  let sqmMax = posInt(r.sqm_max, 1_000_000);
  if (sqmMin === 0) sqmMin = undefined;
  if (sqmMax === 0) sqmMax = undefined;
  if (sqmMin != null && sqmMax != null && sqmMin > sqmMax) [sqmMin, sqmMax] = [sqmMax, sqmMin];
  if (sqmMin != null) out.sqm_min = sqmMin;
  if (sqmMax != null) out.sqm_max = sqmMax;
  const age = posInt(r.age_max, 200);
  if (age != null) out.age_max = age;
  if (typeof r.floor === "string" && r.floor && VITRIN_FLOOR_OPTIONS.some((o) => o.value === r.floor)) {
    out.floor = r.floor as Exclude<VitrinFloor, "">;
  }
  if (r.furnished === true || r.furnished === "true") out.furnished = true;
  if (r.in_site === true || r.in_site === "true") out.in_site = true;
  if (r.credit === true || r.credit === "true") out.credit = true;
  return out;
}

export function hasSavedSearchFilters(f: SavedSearchFilters): boolean {
  return Object.keys(f).length > 0;
}

/** features içindeki sayı ya da sayısal metin → sayı (vitrin_json_number ile aynı; "120 m²" gibi metin sayılmaz). */
function featureNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim().replace(",", ".");
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  }
  return null;
}

const YES = new Set(["true", "yes", "Evet"]);
const yes = (v: unknown) => v === true || (typeof v === "string" && YES.has(v));

export type SavedSearchProperty = {
  property_type?: string | null;
  neighborhood_id?: string | null;
  features?: unknown;
};

/** İlan ek süzgeçlere uyuyor mu (vitrin_listing_search kurallarıyla aynı). Süzgeç yoksa her ilan uyar. */
export function matchesSavedSearchFilters(f: SavedSearchFilters, p: SavedSearchProperty): boolean {
  const feat = (p.features && typeof p.features === "object" ? p.features : {}) as Record<string, unknown>;
  if (f.type && p.property_type !== f.type) return false;
  if (f.neighborhood && p.neighborhood_id !== f.neighborhood) return false;
  if (f.furnished && feat.furnished !== "Eşyalı") return false;
  if (f.in_site && !yes(feat.in_site)) return false;
  if (f.credit && !yes(feat.credit_eligible)) return false;
  if (f.sqm_min != null || f.sqm_max != null) {
    const sqm = featureNumber(feat.gross_sqm) ?? featureNumber(feat.sqm);
    if (sqm == null) return false;
    if (f.sqm_min != null && sqm < f.sqm_min) return false;
    if (f.sqm_max != null && sqm > f.sqm_max) return false;
  }
  if (f.age_max != null) {
    const age = featureNumber(feat.building_age);
    if (age == null || age > f.age_max) return false;
  }
  if (f.floor) {
    const floor = featureNumber(feat.floor);
    const total = featureNumber(feat.total_floors);
    if (floor == null) return false;
    if (f.floor === "giris" && floor !== 0) return false;
    if (f.floor === "zemin-ustu" && floor < 1) return false;
    if (f.floor === "ara" && !(floor >= 1 && (total == null || floor < total))) return false;
    if (f.floor === "en-ust" && !(floor >= 1 && total != null && floor >= total)) return false;
  }
  return true;
}

const fmtInt = (n: number) => n.toLocaleString("tr-TR");

/**
 * İnsan okur kısa etiketler ("Daire", "80–120 m²", "Eşyalı"…). Kutu "Ayrıca bu süzgeçler de kaydedilecek" satırında,
 * ofis bildirimi kriter özetinde kullanır. Mahalle adı çağırandan gelir (yoksa "Seçili mahalle").
 */
export function savedSearchFilterLabels(f: SavedSearchFilters, neighborhoodName?: string | null): string[] {
  const out: string[] = [];
  if (f.type) out.push(f.type);
  if (f.neighborhood) out.push(neighborhoodName?.trim() || "Seçili mahalle");
  if (f.sqm_min != null || f.sqm_max != null) {
    out.push(
      f.sqm_min != null && f.sqm_max != null
        ? `${fmtInt(f.sqm_min)}–${fmtInt(f.sqm_max)} m²`
        : f.sqm_min != null
          ? `En az ${fmtInt(f.sqm_min)} m²`
          : `En çok ${fmtInt(f.sqm_max as number)} m²`,
    );
  }
  if (f.age_max != null) out.push(f.age_max === 0 ? "Sıfır bina" : `${f.age_max} yaşa kadar`);
  if (f.floor) out.push(VITRIN_FLOOR_OPTIONS.find((o) => o.value === f.floor)?.label ?? "Kat");
  if (f.furnished) out.push("Eşyalı");
  if (f.in_site) out.push("Site içinde");
  if (f.credit) out.push("Krediye uygun");
  return out;
}
