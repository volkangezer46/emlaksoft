/**
 * PORTAL FORM KURALLARI (SAF, VERİ; testli). Eklentiyle yardımlı doldurma bu tabloya göre çalışır: hangi EmlakSoft alanı
 * portal formunda hangi etiketle aranır, hangi alan portal için zorunlu/önerilir, kaç fotoğraf yüklenir.
 *
 * DÜRÜSTLÜK: portalların "ilan ver" formlarının gerçek alan adları, zorunluluk durumu ve seçenek listeleri gerçek bir ofis
 * hesabında DOĞRULANMADI (`verified: false`; bkz. docs/design/PORTAL_ENTEGRASYON_ARASTIRMA_2026-10.md §4c). Bu yüzden alanlar
 * seçiciyle değil GÖRÜNEN ETİKETLE aranır (Türkçe katlanmış anahtar sözcükler); bulunamayan alan "elle doldurun" listesine
 * düşer, uydurulmaz. Kural dosyası yalnız VERİDİR (MV3: uzaktan çalıştırılabilir kod yok).
 */

import { CURRENT_PORTALS, PORTAL_CATALOG } from "@/lib/portals/catalog";

/** Aktarım yapılabilen portallar: katalogdaki güncel (eklentinin desteklediği) portallar (tek kaynak `portals/catalog.ts`). */
export const TRANSFER_PORTALS = CURRENT_PORTALS;
export type TransferPortal = (typeof TRANSFER_PORTALS)[number];

export function isTransferPortal(v: unknown): v is TransferPortal {
  return typeof v === "string" && (TRANSFER_PORTALS as readonly string[]).includes(v);
}

export type PortalFormRules = {
  id: TransferPortal;
  label: string;
  /** Kullanıcının "ilan ver" sayfasını açtığı adres (https). Kategori adımlarını kullanıcı geçer. */
  newListingUrl: string;
  /** Yüklenebilecek en çok fotoğraf (kapak önce, sıra korunur). Portalın gerçek sınırı DOĞRULANMADI. */
  maxPhotos: number;
  /** Başlık karakter sınırı (DOĞRULANMADI; fazlası kırpılmaz, kullanıcıya uyarılır). */
  titleMax: number;
  verified: boolean;
};

export const PORTAL_FORM_RULES: Record<TransferPortal, PortalFormRules> = {
  sahibinden: { id: "sahibinden", label: PORTAL_CATALOG.sahibinden.label, newListingUrl: "https://www.sahibinden.com/ilan-ver", maxPhotos: 30, titleMax: 100, verified: false },
  hepsiemlak: { id: "hepsiemlak", label: PORTAL_CATALOG.hepsiemlak.label, newListingUrl: "https://www.hepsiemlak.com/ilan-ver", maxPhotos: 30, titleMax: 100, verified: false },
  emlakjet: { id: "emlakjet", label: PORTAL_CATALOG.emlakjet.label, newListingUrl: "https://www.emlakjet.com/ilan-ver/", maxPhotos: 30, titleMax: 100, verified: false },
};

/** Doldurulabilen alan anahtarları (payload.fields). */
export const FILL_FIELD_KEYS = [
  "title",
  "description",
  "price",
  "currency",
  "gross_sqm",
  "net_sqm",
  "rooms",
  "building_age",
  "floor",
  "total_floors",
  "heating",
  "bathrooms",
  "balcony",
  "elevator",
  "parking",
  "furnished",
  "usage_status",
  "in_site",
  "site_name",
  "dues",
  "credit_eligible",
  "deed_status",
  "facade",
  "swap",
  "eids_property_no",
  "authority_doc_no",
  "parcel_block",
  "parcel_lot",
  "virtual_tour_url",
] as const;
export type FillFieldKey = (typeof FILL_FIELD_KEYS)[number];

export type FillControl = "text" | "number" | "textarea" | "choice" | "bool";

export type FieldRule = {
  key: FillFieldKey;
  /** Kullanıcıya gösterilen ad. */
  label: string;
  control: FillControl;
  /** Türkçe KATLANMIŞ (küçük harf, aksansız) etiket ifadeleri; ilk eşleşen alan kullanılır. Uzun ifade önce. */
  labels: readonly string[];
  /** Etiketin TAM eşleşmesi gerektiren kısa ifadeler (ör. "net": "internet" içinde geçmesin). */
  exact?: readonly string[];
};

export const FIELD_RULES: readonly FieldRule[] = [
  { key: "title", label: "İlan başlığı", control: "text", labels: ["ilan basligi", "baslik"] },
  { key: "description", label: "Açıklama", control: "textarea", labels: ["ilan aciklamasi", "aciklama"] },
  { key: "price", label: "Fiyat", control: "number", labels: ["fiyat"] },
  { key: "currency", label: "Para birimi", control: "choice", labels: ["para birimi"] },
  { key: "gross_sqm", label: "Brüt m²", control: "number", labels: ["m2 brut", "brut m2", "brut metrekare", "brut alan"], exact: ["brut"] },
  { key: "net_sqm", label: "Net m²", control: "number", labels: ["m2 net", "net m2", "net metrekare", "net alan"], exact: ["net"] },
  { key: "rooms", label: "Oda sayısı", control: "choice", labels: ["oda sayisi", "oda salon", "oda"] },
  { key: "building_age", label: "Bina yaşı", control: "choice", labels: ["bina yasi"] },
  { key: "floor", label: "Bulunduğu kat", control: "choice", labels: ["bulundugu kat", "bulundugu"] },
  { key: "total_floors", label: "Kat sayısı", control: "choice", labels: ["binadaki kat sayisi", "kat sayisi", "toplam kat"] },
  { key: "heating", label: "Isıtma", control: "choice", labels: ["isitma", "isinma"] },
  { key: "bathrooms", label: "Banyo sayısı", control: "choice", labels: ["banyo sayisi", "banyo"] },
  { key: "balcony", label: "Balkon", control: "bool", labels: ["balkon"] },
  { key: "elevator", label: "Asansör", control: "bool", labels: ["asansor"] },
  { key: "parking", label: "Otopark", control: "choice", labels: ["otopark"] },
  { key: "furnished", label: "Eşya durumu", control: "choice", labels: ["esya durumu", "esyali"] },
  { key: "usage_status", label: "Kullanım durumu", control: "choice", labels: ["kullanim durumu"] },
  { key: "in_site", label: "Site içinde", control: "bool", labels: ["site icerisinde", "site icinde"] },
  { key: "site_name", label: "Site adı", control: "text", labels: ["site adi"] },
  { key: "dues", label: "Aidat", control: "number", labels: ["aidat"] },
  { key: "credit_eligible", label: "Krediye uygun", control: "bool", labels: ["krediye uygun"] },
  { key: "deed_status", label: "Tapu durumu", control: "choice", labels: ["tapu durumu"] },
  { key: "facade", label: "Cephe", control: "choice", labels: ["cephe"] },
  { key: "swap", label: "Takas", control: "bool", labels: ["takas"] },
  { key: "eids_property_no", label: "EİDS taşınmaz numarası", control: "text", labels: ["tasinmaz numarasi", "tasinmaz no", "tasinmaz kimlik", "eids"] },
  { key: "authority_doc_no", label: "Yetki belgesi no", control: "text", labels: ["yetki belge"] },
  { key: "parcel_block", label: "Ada", control: "text", labels: [], exact: ["ada"] },
  { key: "parcel_lot", label: "Parsel", control: "text", labels: [], exact: ["parsel"] },
  { key: "virtual_tour_url", label: "Sanal tur / video", control: "text", labels: ["sanal tur", "video"] },
];

/** Her zaman kullanıcıyla yapılan adımlar: kategori sihirbazı, konum seçicileri, harita iğnesi. */
export const MANUAL_ALWAYS = ["Kategori (işlem ve portföy türü)", "Konum (il / ilçe / mahalle)", "Harita iğnesi"] as const;

/** Portal için ZORUNLU varsayılan alanlar (yayın öncesi hazırlık kontrolü; zorunluluk portalda DOĞRULANMADI, uyarır, engellemez). */
export const REQUIRED_FIELDS: readonly FillFieldKey[] = ["title", "description", "price", "gross_sqm", "eids_property_no"];

/** Konut türlerinde ek olarak önerilen alanlar. */
export const RESIDENTIAL_RECOMMENDED: readonly FillFieldKey[] = ["rooms", "net_sqm", "building_age", "floor", "total_floors", "heating", "bathrooms", "deed_status"];

/** Arsa için önerilen alanlar. */
export const LAND_RECOMMENDED: readonly FillFieldKey[] = ["parcel_block", "parcel_lot", "deed_status"];

/** Konut sayılan portföy türleri (Türkçe katlanmış). */
const RESIDENTIAL_TYPES = ["daire", "villa", "mustakil", "rezidans", "yali", "ev", "bina"];
const LAND_TYPES = ["arsa", "tarla", "bahce", "arazi"];

export function propertyKind(propertyType: string): "residential" | "land" | "commercial" {
  const f = fold(propertyType);
  if (LAND_TYPES.some((t) => f.includes(t))) return "land";
  if (RESIDENTIAL_TYPES.some((t) => f.includes(t))) return "residential";
  return "commercial";
}

/** Türkçe katlama: küçük harf, aksansız, noktalama boşluk, tek boşluk. Etiket/seçenek karşılaştırmasının TEK kuralı. */
export function fold(input: string | null | undefined): string {
  return String(input ?? "")
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u")
    .replace(/²/g, "2")
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
