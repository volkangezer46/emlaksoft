/**
 * İlan sahibi (malik) bilgisi: form alanları, doğrulama ve "bilgi tamamlama" puanı (SAF, istemci/sunucu güvenli).
 * Telefon biçimi burada doğrulanmaz: sunucu action `parsePhoneStrict` ile doğrular; burada yalnız "dolu mu" bakılır.
 */

import { parseEidsPropertyNo } from "@/lib/eids/property-no";

export const OWNER_RELATIONS = [
  { value: "malik", label: "Malik (tapu sahibi)" },
  { value: "vekil", label: "Vekil" },
  { value: "mirasci", label: "Mirasçı" },
  { value: "kurum", label: "Kurum / şirket" },
] as const;

export const DEED_STATUSES = [
  { value: "kat_mulkiyeti", label: "Kat mülkiyeti" },
  { value: "kat_irtifaki", label: "Kat irtifakı" },
  { value: "hisseli", label: "Hisseli tapu" },
  { value: "arsa_tapusu", label: "Arsa / müstakil tapu" },
  { value: "tapu_yok", label: "Tapu yok / tapusuz" },
  { value: "bilinmiyor", label: "Bilinmiyor" },
] as const;

/** properties.authorization_type ile AYNI değerler (mevcut yetki belgesi paneli). */
export const AUTHORIZATION_TYPES = [
  { value: "exclusive", label: "Tek yetkili" },
  { value: "open", label: "Serbest (açık yetki)" },
  { value: "limited", label: "Sınırlı yetki" },
] as const;

export const COMMISSION_KINDS = [
  { value: "yuzde", label: "Yüzde (%)" },
  { value: "sabit", label: "Sabit tutar" },
] as const;

export const LISTING_SOURCES = [
  "Portföy sahibi başvurdu",
  "Tavsiye / referans",
  "Saha / tabela",
  "Portal / ilan sitesi",
  "Sosyal medya",
  "Mevcut müşteri",
  "Ağ / MLS ortağı",
  "Diğer",
] as const;

const RELATION_SET: ReadonlySet<string> = new Set(OWNER_RELATIONS.map((r) => r.value));
const DEED_SET: ReadonlySet<string> = new Set(DEED_STATUSES.map((r) => r.value));
const AUTH_SET: ReadonlySet<string> = new Set(AUTHORIZATION_TYPES.map((r) => r.value));
const KIND_SET: ReadonlySet<string> = new Set(COMMISSION_KINDS.map((r) => r.value));

export type OwnerInfoInput = {
  ownerCustomerId: string;
  ownerName: string;
  ownerPhone: string;
  ownerEmail: string;
  relation: string;
  deedStatus: string;
  deedNote: string;
  authorizationType: string;
  authorizationStart: string;
  authorizationEnd: string;
  /** EİDS Taşınmaz Kimlik Numarası (normalize; boş = girilmedi). Resmî doğrulama değildir. */
  eidsNo: string;
  commissionKind: string;
  minPrice: number | null;
  negotiationMarginPct: number | null;
  listingSource: string;
  customerNotes: string;
  contactHistory: string;
  kvkkConsent: boolean;
  contactPermission: boolean;
  /** Seçilen mevcut müşterinin kayıtlı telefonu var mı (sunucu doldurur). */
  existingOwnerHasPhone?: boolean;
};

export type OwnerInfoItem = { key: string; label: string; weight: number; required: boolean; ok: boolean };
export type OwnerInfoEvaluation = {
  score: number;
  complete: boolean;
  items: OwnerInfoItem[];
  missing: { key: string; label: string }[];
};

export function emptyOwnerInfo(): OwnerInfoInput {
  return {
    ownerCustomerId: "",
    ownerName: "",
    ownerPhone: "",
    ownerEmail: "",
    relation: "",
    deedStatus: "",
    deedNote: "",
    authorizationType: "",
    authorizationStart: "",
    authorizationEnd: "",
    eidsNo: "",
    commissionKind: "yuzde",
    minPrice: null,
    negotiationMarginPct: null,
    listingSource: "",
    customerNotes: "",
    contactHistory: "",
    kvkkConsent: false,
    contactPermission: false,
  };
}

/** Ofis ilan sahibini değerlendirir: zorunlular eksikse `complete=false` (ilan yayına alınamaz). Toplam ağırlık 100. */
export function evaluateOwnerInfo(i: OwnerInfoInput): OwnerInfoEvaluation {
  const hasOwner = Boolean(i.ownerCustomerId.trim() || i.ownerName.trim());
  const hasPhone = Boolean(i.ownerPhone.trim() || (i.ownerCustomerId.trim() && i.existingOwnerHasPhone));
  const needsDates = i.authorizationType === "exclusive" || i.authorizationType === "limited";
  const datesOk = !needsDates || Boolean(i.authorizationStart && i.authorizationEnd && i.authorizationEnd >= i.authorizationStart);
  const items: OwnerInfoItem[] = [
    { key: "owner", label: "İlan sahibi (müşteri seçimi veya yeni müşteri adı)", weight: 15, required: true, ok: hasOwner },
    { key: "phone", label: "Sahibin telefonu", weight: 10, required: true, ok: hasOwner && hasPhone },
    { key: "relation", label: "İlişki türü (malik/vekil/mirasçı/kurum)", weight: 10, required: true, ok: RELATION_SET.has(i.relation) },
    { key: "deed", label: "Tapu durumu", weight: 10, required: true, ok: DEED_SET.has(i.deedStatus) },
    { key: "authType", label: "Yetki sözleşmesi türü", weight: 10, required: true, ok: AUTH_SET.has(i.authorizationType) },
    { key: "authDates", label: "Yetki başlangıç ve bitiş tarihi", weight: 10, required: needsDates, ok: datesOk },
    { key: "source", label: "İlan kaynağı", weight: 10, required: true, ok: Boolean(i.listingSource.trim()) },
    { key: "kvkk", label: "KVKK / iletişim onayı", weight: 15, required: true, ok: i.kvkkConsent },
    { key: "minPrice", label: "Minimum satış fiyatı", weight: 5, required: false, ok: i.minPrice != null && i.minPrice > 0 },
    { key: "notes", label: "Müşteri notu veya görüşme geçmişi", weight: 5, required: false, ok: Boolean(i.customerNotes.trim() || i.contactHistory.trim()) },
  ];
  const score = items.reduce((n, it) => n + (it.ok ? it.weight : 0), 0);
  const missing = items.filter((it) => it.required && !it.ok).map((it) => ({ key: it.key, label: it.label }));
  return { score, complete: missing.length === 0, items, missing };
}

/** Form alanlarını okur (get: FormData.get benzeri). Sayı alanlarında geçersiz değer `numberError` ile bildirilir. */
export function parseOwnerInfoForm(get: (name: string) => string | null | undefined): { value: OwnerInfoInput; error?: string } {
  const s = (n: string) => String(get(n) ?? "").trim();
  const num = (n: string, max: number): { v: number | null; bad: boolean } => {
    const raw = s(n).replace(/\./g, "").replace(",", ".");
    if (!raw) return { v: null, bad: false };
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 && v <= max ? { v, bad: false } : { v: null, bad: true };
  };
  const min = num("min_price", 1_000_000_000_000);
  const margin = num("negotiation_margin_pct", 100);
  const ck = s("commission_kind");
  const eids = parseEidsPropertyNo(s("eids_property_no"));
  const value: OwnerInfoInput = {
    ownerCustomerId: s("owner_customer_id"),
    ownerName: s("owner_name"),
    ownerPhone: s("owner_phone"),
    ownerEmail: s("owner_email"),
    relation: RELATION_SET.has(s("owner_relation")) ? s("owner_relation") : "",
    deedStatus: DEED_SET.has(s("deed_status")) ? s("deed_status") : "",
    deedNote: s("deed_note").slice(0, 1000),
    authorizationType: AUTH_SET.has(s("authorization_type")) ? s("authorization_type") : "",
    authorizationStart: /^\d{4}-\d{2}-\d{2}$/.test(s("authorization_start")) ? s("authorization_start") : "",
    authorizationEnd: /^\d{4}-\d{2}-\d{2}$/.test(s("authorization_end")) ? s("authorization_end") : "",
    eidsNo: eids.ok ? (eids.value ?? "") : s("eids_property_no"),
    commissionKind: KIND_SET.has(ck) ? ck : "yuzde",
    minPrice: min.v,
    negotiationMarginPct: margin.v,
    listingSource: s("listing_source").slice(0, 64),
    customerNotes: s("owner_customer_notes").slice(0, 4000),
    contactHistory: s("owner_contact_history").slice(0, 4000),
    kvkkConsent: s("kvkk_consent") === "1",
    contactPermission: s("contact_permission") === "1",
  };
  if (!eids.ok) return { value, error: eids.error };
  if (min.bad) return { value, error: "Geçerli bir minimum fiyat girin." };
  if (margin.bad) return { value, error: "Pazarlık payı 0 ile 100 arasında olmalıdır." };
  if (value.authorizationStart && value.authorizationEnd && value.authorizationEnd < value.authorizationStart) {
    return { value, error: "Yetki bitiş tarihi başlangıçtan önce olamaz." };
  }
  return { value };
}

/** Formda hiçbir ilan sahibi alanı dolmamış mı (eski form / API çağrıları: davranış değişmez). */
export function isOwnerInfoBlank(i: OwnerInfoInput): boolean {
  return !(
    i.ownerCustomerId || i.ownerName || i.ownerPhone || i.ownerEmail || i.relation || i.deedStatus || i.authorizationType ||
    i.eidsNo || i.listingSource || i.customerNotes || i.contactHistory || i.kvkkConsent || i.contactPermission || i.minPrice != null ||
    i.negotiationMarginPct != null
  );
}

/** Şema yok (tablo/sütun) hatası mı: PostgREST/Postgres kodları. */
export function isMissingSchemaError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  if (code === "42P01" || code === "42703" || code === "PGRST205" || code === "PGRST204") return true;
  return /does not exist|schema cache/i.test(String(error.message ?? ""));
}

/** Şema yokken özetin düşeceği müşteri notu metni (kişisel veri yalnız zaten girilenler). */
export function ownerInfoToNote(i: OwnerInfoInput, evalResult: OwnerInfoEvaluation, propertyCode: string): string {
  const rel = OWNER_RELATIONS.find((r) => r.value === i.relation)?.label;
  const deed = DEED_STATUSES.find((r) => r.value === i.deedStatus)?.label;
  const auth = AUTHORIZATION_TYPES.find((r) => r.value === i.authorizationType)?.label;
  const lines = [
    `[İlan ${propertyCode} sahibi bilgileri]`,
    rel ? `İlişki: ${rel}` : null,
    deed ? `Tapu: ${deed}${i.deedNote ? ` (${i.deedNote})` : ""}` : null,
    auth ? `Yetki: ${auth}${i.authorizationStart ? ` ${i.authorizationStart}` : ""}${i.authorizationEnd ? ` - ${i.authorizationEnd}` : ""}` : null,
    i.negotiationMarginPct != null ? `Pazarlık payı: %${i.negotiationMarginPct}` : null,
    i.listingSource ? `Kaynak: ${i.listingSource}` : null,
    i.customerNotes ? `Not: ${i.customerNotes}` : null,
    i.contactHistory ? `Görüşme geçmişi: ${i.contactHistory}` : null,
    `KVKK onayı: ${i.kvkkConsent ? "var" : "yok"} · İletişim izni: ${i.contactPermission ? "var" : "yok"}`,
    `Bilgi tamamlama: %${evalResult.score}`,
  ];
  return lines.filter(Boolean).join("\n");
}
