/**
 * Vitrin ("Evim ne kadar eder?") değerleme talebinin `valuations.sources`
 * içine gömülen YAPISAL dökümü.
 *
 * NEDEN (denetim P0): Public huniden gelen talep yalnızca serbest metin bir
 * lead mesajına dönüşüyordu; `valuations` tablosuna satır atılmadığı için
 * hesaplanan low/high ve m²/ilçe/oda gibi kriterler yapısal saklanmıyordu.
 * Danışman rapor üretmek için kriterleri elle yeniden giriyordu.
 *
 * NEDEN `sources` (yeni kolon yerine): `valuations` tablosunda "kaynak =
 * vitrin" için kolon yok; kolon eklemek migration ister ve rapor sayfaları
 * zaten `sources` dizisini okuyor. Aynı gerekçeyle daha önce emsal anlık
 * görüntüsü de buraya konmuştu (`COMPARABLES_SOURCE_NAME` / `__emsal_dokumu`).
 * `__` önekli ad DAHİLİ döküm demektir: `isInternalSource` (lib/comparables.ts)
 * sayesinde rapor sayfalarındaki "bilgi kaynakları" listesine SIZMAZ ve
 * `weight: 0` olduğu için fiyat hesabına da girmez.
 *
 * MEVCUT KOLONLARLA AYIRT EDİLEBİLİRLİK: vitrin kaydında `created_by` null
 * (panel kullanıcısı yok) ve `property_id` null (henüz portföy değil). Bu
 * ikisi tek başına da vitrin kaynağını ayırmaya yeter; `sources` girdisi
 * kriterleri (ilçe/m²/oda) ve müşteri bağını taşır.
 */

export const PUBLIC_VALUATION_SOURCE_NAME = "__vitrin_talebi";

export type PublicValuationRequest = {
  origin: "vitrin";
  slug: string;
  customer_id: string | null;
  province_id: string | null;
  district_id: string | null;
  district_name: string | null;
  province_name: string | null;
  property_type: string;
  sqm: number | null;
  rooms: string | null;
  building_age: string | null;
  /** Public huni yalnız satılık tahmini üretiyor (estimatePublicValuation ile aynı). */
  transaction_type: "Satılık";
};

export type PublicValuationSourceEntry = {
  name: typeof PUBLIC_VALUATION_SOURCE_NAME;
  weight: 0;
  value: number;
  note: string;
  request: PublicValuationRequest;
};

export function publicValuationSourceEntry(request: PublicValuationRequest): PublicValuationSourceEntry {
  return {
    name: PUBLIC_VALUATION_SOURCE_NAME,
    weight: 0,
    value: request.sqm ?? 0,
    note: "Vitrin değerleme formundan gelen talep kriterleri (rapor için yapısal döküm).",
    request,
  };
}

/** Kayıt vitrin değerleme hunisinden mi geldi? Geldiyse kriterlerini döner. */
export function extractPublicValuationRequest(sources: unknown): PublicValuationRequest | null {
  if (!Array.isArray(sources)) return null;
  const entry = sources.find(
    (s): s is PublicValuationSourceEntry =>
      typeof s === "object" &&
      s !== null &&
      (s as { name?: unknown }).name === PUBLIC_VALUATION_SOURCE_NAME &&
      typeof (s as { request?: unknown }).request === "object" &&
      (s as { request?: unknown }).request !== null,
  );
  return entry ? entry.request : null;
}
