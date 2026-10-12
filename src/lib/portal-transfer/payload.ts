import { authorityPublishWarning } from "@/lib/eids/authority-status";
import { DEED_STATUSES } from "@/lib/property-owner/info";
import {
  FIELD_RULES,
  LAND_RECOMMENDED,
  PORTAL_FORM_RULES,
  REQUIRED_FIELDS,
  RESIDENTIAL_RECOMMENDED,
  propertyKind,
  type FillFieldKey,
  type TransferPortal,
} from "./rules";

/**
 * AKTARIM PAKETİ (SAF, testli): portföy kaydından portal formuna yazılacak değerleri, fotoğraf listesini, EİDS bilgisini ve
 * hazırlık kontrolünü üretir. Değerler HAM ve tiplidir (sayı/metin/evet-hayır); portalın seçenek metnine eşleme eklentide,
 * canlı formdaki seçeneklere bakılarak yapılır (`fill-plan.ts`). Paket kişisel veri taşımaz: ofisin iletişim bilgisi portal
 * hesabından gelir, EmlakSoft yazmaz. Sunucu paketi YALNIZ kodu tüketen oturum sahibine verir; DB'ye yük yazılmaz (yalnız özet).
 */

export type PortalPropertyInput = {
  id: string;
  propertyCode: string;
  title: string | null;
  transactionType: string;
  propertyType: string;
  listPrice: number | null;
  provinceName: string | null;
  districtName: string | null;
  neighborhoodName: string | null;
  addressLine: string | null;
  features: Record<string, unknown>;
  parcelBlock: string | null;
  parcelLot: string | null;
  swapOk: boolean | null;
  eidsPropertyNo: string | null;
  authorityDocNo: string | null;
  authorityEidsStatus: string | null;
  authorizationStart: string | null;
  authorizationEnd: string | null;
  /** İlan sahibi bilgisindeki tapu durumu değeri (kat_mulkiyeti vb.). */
  deedStatus: string | null;
  photos: readonly { id: string; fileName: string | null; fileType: string | null; isCover: boolean; sortOrder: number }[];
};

export type TransferPhoto = { id: string; fileName: string; type: string };
export type FieldValue = string | number | boolean;

export type PortalPayload = {
  portal: TransferPortal;
  property: { id: string; code: string; title: string };
  fields: Partial<Record<FillFieldKey, FieldValue>>;
  /** Kullanıcının elle seçeceği adımlar ve onlara yardımcı değerler (kategori, konum). */
  manual: { label: string; value: string | null }[];
  photos: TransferPhoto[];
  maxPhotos: number;
  /** Atlanan (sınırı aşan) fotoğraf sayısı. */
  photosTrimmed: number;
  eids: { propertyNo: string | null; authorityDocNo: string | null; warning: string | null };
  kind: "residential" | "land" | "commercial";
};

export type ReadinessItem = { key: FillFieldKey | "photos"; label: string; level: "required" | "recommended" };
export type Readiness = { missing: ReadinessItem[]; warnings: string[]; ready: boolean };

const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
};
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/** "3+1", "3 + 1", "3,1" → "3+1"; tanınmazsa olduğu gibi (ör. "Stüdyo"). */
export function normalizeRooms(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  const m = /^(\d{1,2})\s*[+,.]\s*(\d{1,2})$/.exec(s);
  return m ? `${m[1]}+${m[2]}` : s;
}

/** Açıklama: düz metin + satır sonları (HTML desteği portala göre değişir; etiketler temizlenir). */
export function plainDescription(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  return s.replace(/<[^>]*>/g, "").replace(/\r\n/g, "\n").trim() || null;
}

export function buildPortalPayload(input: PortalPropertyInput, portal: TransferPortal, nowMs: number): PortalPayload {
  const f = input.features ?? {};
  const rules = PORTAL_FORM_RULES[portal];
  const kind = propertyKind(input.propertyType);
  const fields: Partial<Record<FillFieldKey, FieldValue>> = {};
  const set = (k: FillFieldKey, v: FieldValue | null | undefined) => {
    if (v !== null && v !== undefined && v !== "") fields[k] = v;
  };

  const title = str(input.title) ?? `${input.districtName ?? ""} ${input.propertyType}`.trim();
  set("title", title);
  set("description", plainDescription(f.description));
  set("price", input.listPrice !== null && input.listPrice > 0 ? input.listPrice : null);
  set("currency", str(f.currency) ?? "TL");
  set("gross_sqm", num(f.gross_sqm) ?? num(f.sqm));
  set("net_sqm", num(f.net_sqm));
  set("rooms", normalizeRooms(f.rooms));
  set("building_age", num(f.building_age));
  set("floor", num(f.floor));
  set("total_floors", num(f.total_floors));
  set("heating", str(f.heating));
  set("bathrooms", num(f.bathrooms));
  set("balcony", bool(f.balcony));
  set("elevator", bool(f.elevator));
  set("parking", str(f.parking));
  set("furnished", str(f.furnished));
  set("usage_status", str(f.usage_status));
  set("in_site", bool(f.in_site));
  set("site_name", str(f.site_name));
  set("dues", num(f.dues));
  set("credit_eligible", bool(f.credit_eligible));
  set("deed_status", DEED_STATUSES.find((d) => d.value === input.deedStatus && d.value !== "bilinmiyor")?.label ?? null);
  set("facade", str(f.facade));
  set("swap", input.swapOk);
  set("eids_property_no", str(input.eidsPropertyNo));
  set("authority_doc_no", str(input.authorityDocNo));
  if (kind === "land") {
    set("parcel_block", str(input.parcelBlock));
    set("parcel_lot", str(input.parcelLot));
  }
  set("virtual_tour_url", str(f.virtual_tour_url));

  const ordered = [...input.photos].sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.sortOrder - b.sortOrder);
  const images = ordered.filter((p) => !p.fileType || p.fileType.startsWith("image/"));
  const photos = images.slice(0, rules.maxPhotos).map((p) => ({ id: p.id, fileName: p.fileName ?? `foto-${p.id.slice(0, 8)}.jpg`, type: p.fileType ?? "image/jpeg" }));

  const where = [input.provinceName, input.districtName, input.neighborhoodName].filter(Boolean).join(" / ");
  const manual = [
    { label: "Kategori (işlem ve portföy türü)", value: `${input.transactionType} · ${input.propertyType}` },
    { label: "Konum (il / ilçe / mahalle)", value: where || null },
    { label: "Harita iğnesi", value: null },
  ];

  const warning = authorityPublishWarning(
    { authority_eids_status: input.authorityEidsStatus, authorization_start: input.authorizationStart, authorization_end: input.authorizationEnd },
    nowMs,
  );

  return {
    portal,
    property: { id: input.id, code: input.propertyCode, title },
    fields,
    manual,
    photos,
    maxPhotos: rules.maxPhotos,
    photosTrimmed: Math.max(0, images.length - photos.length),
    eids: { propertyNo: str(input.eidsPropertyNo), authorityDocNo: str(input.authorityDocNo), warning },
    kind,
  };
}

/** Yayın öncesi hazırlık kontrolü: eksik alanlar (zorunlu / önerilen) ve uyarılar. ENGELLEMEZ. */
export function readinessCheck(payload: PortalPayload): Readiness {
  const label = (k: FillFieldKey) => FIELD_RULES.find((r) => r.key === k)?.label ?? k;
  const missing: ReadinessItem[] = [];
  for (const k of REQUIRED_FIELDS) if (payload.fields[k] === undefined) missing.push({ key: k, label: label(k), level: "required" });
  const recommended = payload.kind === "land" ? LAND_RECOMMENDED : payload.kind === "residential" ? RESIDENTIAL_RECOMMENDED : [];
  for (const k of recommended) if (payload.fields[k] === undefined) missing.push({ key: k, label: label(k), level: "recommended" });
  if (payload.photos.length === 0) missing.push({ key: "photos", label: "Fotoğraf", level: "required" });

  const warnings: string[] = [];
  if (payload.eids.propertyNo === null) warnings.push("EİDS taşınmaz numarası girilmemiş; portal numarasız ilanı reddedebilir.");
  if (payload.eids.warning) warnings.push(payload.eids.warning);
  const titleMax = PORTAL_FORM_RULES[payload.portal].titleMax;
  const title = payload.fields.title;
  if (typeof title === "string" && title.length > titleMax) warnings.push(`Başlık ${title.length} karakter; ${PORTAL_FORM_RULES[payload.portal].label} sınırı yaklaşık ${titleMax} olabilir, kısaltmanız gerekebilir.`);
  if (payload.photosTrimmed > 0) warnings.push(`${payload.photosTrimmed} fotoğraf portal sınırı nedeniyle aktarılmayacak (ilk ${payload.maxPhotos} alınır).`);
  return { missing, warnings, ready: !missing.some((m) => m.level === "required") };
}

/** Aktarım özeti karması (DB'ye yük yazılmaz): kararlı anahtar sırası ile. */
export function payloadFingerprintSource(payload: PortalPayload): string {
  const keys = Object.keys(payload.fields).sort();
  return JSON.stringify({ p: payload.portal, id: payload.property.id, f: keys.map((k) => [k, payload.fields[k as FillFieldKey]]), n: payload.photos.map((x) => x.id) });
}
