/**
 * Özel alanlar (SAF; istemci ve sunucu güvenle import eder). Şema: 20261007000310_custom_fields.sql.
 * Ofis kendi alanlarını tanımlar (metin / sayı / tarih / seçim / evet-hayır); müşteri, portföy, talep, anlaşma.
 * Değer tek sütunda saklanır (value_text | value_num | value_date | value_bool). Kimlik no gibi hassas veri için
 * özel alan önerilmez (formda uyarı); ürün bunu engelleyemez.
 */

export const CUSTOM_FIELD_ENTITIES = ["customer", "property", "demand", "deal"] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

export const CUSTOM_FIELD_ENTITY_LABELS: Record<CustomFieldEntity, string> = {
  customer: "Müşteri",
  property: "Portföy",
  demand: "Talep",
  deal: "Anlaşma",
};

/** Değer yazma izni (DB politikası `custom_field_can_write` ile aynı eşleme). */
export const CUSTOM_FIELD_MODULE: Record<CustomFieldEntity, "customers" | "properties" | "demands" | "commissions"> = {
  customer: "customers",
  property: "properties",
  demand: "demands",
  deal: "commissions",
};

export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "select", "boolean"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Metin",
  number: "Sayı",
  date: "Tarih",
  select: "Seçim listesi",
  boolean: "Evet / Hayır",
};

/** Varlık başına en çok tanım (uygulama katmanı sınırı). */
export const MAX_DEFS_PER_ENTITY = 30;
export const MAX_TEXT_LENGTH = 2000;
export const MAX_OPTIONS = 50;

export type CustomFieldDef = {
  id: string;
  entity: CustomFieldEntity;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  options: string[];
  required: boolean;
  position: number;
  active: boolean;
};

export type CustomFieldValueRow = {
  def_id: string;
  record_id: string;
  value_text: string | null;
  value_num: number | string | null;
  value_date: string | null;
  value_bool: boolean | null;
};

export function isCustomFieldEntity(v: unknown): v is CustomFieldEntity {
  return typeof v === "string" && (CUSTOM_FIELD_ENTITIES as readonly string[]).includes(v);
}
export function isCustomFieldType(v: unknown): v is CustomFieldType {
  return typeof v === "string" && (CUSTOM_FIELD_TYPES as readonly string[]).includes(v);
}

const TR_MAP: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", Ö: "o", Ş: "s", Ü: "u" };

/** Etiketten kalıcı anahtar ("Isıtma tipi" → "isitma_tipi"); DB deseni `^[a-z][a-z0-9_]{1,39}$`. */
export function keyFromLabel(label: string): string {
  const base = label
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => TR_MAP[c] ?? c)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  const withLetter = /^[a-z]/.test(base) ? base : `alan_${base}`;
  const out = withLetter.slice(0, 40).replace(/_+$/, "");
  return out.length >= 2 ? out : `${out}x`.padEnd(2, "x");
}

export type DefInput = { label: string; fieldType: CustomFieldType; options: string[]; required: boolean };
export type DefParse = { ok: true; value: DefInput } | { ok: false; error: string };

/** Tanım formu: etiket 1-80, seçim için 1-50 benzersiz seçenek (satır/virgül ayrımlı). */
export function parseDefInput(raw: { label: unknown; fieldType: unknown; options?: unknown; required?: unknown }): DefParse {
  const label = String(raw.label ?? "").replace(/\s+/g, " ").trim();
  if (label.length < 1 || label.length > 80) return { ok: false, error: "Alan adı 1-80 karakter olmalı." };
  if (!isCustomFieldType(raw.fieldType)) return { ok: false, error: "Geçersiz alan türü." };
  let options: string[] = [];
  if (raw.fieldType === "select") {
    options = [
      ...new Set(
        String(raw.options ?? "")
          .split(/[\n,]/)
          .map((o) => o.replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .map((o) => o.slice(0, 80)),
      ),
    ];
    if (options.length < 1) return { ok: false, error: "Seçim listesi için en az bir seçenek girin." };
    if (options.length > MAX_OPTIONS) return { ok: false, error: `En çok ${MAX_OPTIONS} seçenek girilebilir.` };
  }
  const required = raw.required === true || raw.required === "on" || raw.required === "true" || raw.required === "1";
  return { ok: true, value: { label, fieldType: raw.fieldType, options, required } };
}

export type ValueColumns = { value_text: string | null; value_num: number | null; value_date: string | null; value_bool: boolean | null };
export type ValueParse = { ok: true; value: ValueColumns; empty: boolean } | { ok: false; error: string };

const EMPTY: ValueColumns = { value_text: null, value_num: null, value_date: null, value_bool: null };

/** Form değerini tanıma göre doğrular ve tek sütuna yerleştirir. Boş = tüm sütunlar null (değer silinir). */
export function parseValue(def: Pick<CustomFieldDef, "label" | "fieldType" | "options" | "required">, raw: unknown): ValueParse {
  const s = String(raw ?? "").trim();
  if (def.fieldType === "boolean") {
    if (s === "") return def.required ? { ok: false, error: `"${def.label}" zorunlu.` } : { ok: true, value: EMPTY, empty: true };
    if (s === "evet" || s === "true" || s === "1") return { ok: true, value: { ...EMPTY, value_bool: true }, empty: false };
    if (s === "hayir" || s === "false" || s === "0") return { ok: true, value: { ...EMPTY, value_bool: false }, empty: false };
    return { ok: false, error: `"${def.label}" için Evet ya da Hayır seçin.` };
  }
  if (s === "") return def.required ? { ok: false, error: `"${def.label}" zorunlu.` } : { ok: true, value: EMPTY, empty: true };
  switch (def.fieldType) {
    case "text":
      if (s.length > MAX_TEXT_LENGTH) return { ok: false, error: `"${def.label}" en çok ${MAX_TEXT_LENGTH} karakter olabilir.` };
      return { ok: true, value: { ...EMPTY, value_text: s }, empty: false };
    case "number": {
      const n = Number(s.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
      if (!Number.isFinite(n) || Math.abs(n) > 1e15) return { ok: false, error: `"${def.label}" geçerli bir sayı olmalı.` };
      return { ok: true, value: { ...EMPTY, value_num: n }, empty: false };
    }
    case "date": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (!m) return { ok: false, error: `"${def.label}" tarih seçiciyle girilmeli.` };
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      if (d.getUTCMonth() !== Number(m[2]) - 1 || Number(m[1]) < 1900 || Number(m[1]) > 2200) return { ok: false, error: `"${def.label}" geçerli bir tarih değil.` };
      return { ok: true, value: { ...EMPTY, value_date: s }, empty: false };
    }
    case "select":
      if (!def.options.includes(s)) return { ok: false, error: `"${def.label}" için listeden bir seçenek seçin.` };
      return { ok: true, value: { ...EMPTY, value_text: s }, empty: false };
  }
  return { ok: false, error: "Geçersiz alan türü." };
}

/** Görüntüleme metni (detay ve CSV için tek kaynak). Değer yoksa "". */
export function formatValue(def: Pick<CustomFieldDef, "fieldType">, row: Pick<CustomFieldValueRow, "value_text" | "value_num" | "value_date" | "value_bool"> | null | undefined): string {
  if (!row) return "";
  switch (def.fieldType) {
    case "boolean":
      return row.value_bool === true ? "Evet" : row.value_bool === false ? "Hayır" : "";
    case "number":
      return row.value_num != null && Number.isFinite(Number(row.value_num)) ? new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 4 }).format(Number(row.value_num)) : "";
    case "date":
      return row.value_date ? row.value_date.slice(0, 10).split("-").reverse().join(".") : "";
    default:
      return row.value_text ?? "";
  }
}

/** Form alanının ilk değeri (input value). */
export function inputValue(def: Pick<CustomFieldDef, "fieldType">, row: Pick<CustomFieldValueRow, "value_text" | "value_num" | "value_date" | "value_bool"> | null | undefined): string {
  if (!row) return "";
  switch (def.fieldType) {
    case "boolean":
      return row.value_bool === true ? "evet" : row.value_bool === false ? "hayir" : "";
    case "number":
      return row.value_num != null ? String(row.value_num) : "";
    case "date":
      return row.value_date ? row.value_date.slice(0, 10) : "";
    default:
      return row.value_text ?? "";
  }
}

/** DB satırı → tanım (bozuk satırlar atılır). */
export function toDef(row: Record<string, unknown>): CustomFieldDef | null {
  if (!isCustomFieldEntity(row.entity) || !isCustomFieldType(row.field_type)) return null;
  const options = Array.isArray(row.options) ? (row.options as unknown[]).map((o) => String(o)) : [];
  return {
    id: String(row.id),
    entity: row.entity,
    key: String(row.key ?? ""),
    label: String(row.label ?? ""),
    fieldType: row.field_type,
    options,
    required: row.required === true,
    position: Number(row.position ?? 0),
    active: row.active !== false,
  };
}

/** Tablo yok / şema önbelleği hatası mı (migration uygulanmadı)? */
export function isMissingCustomFieldSchema(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "PGRST202" ||
    /custom_field\w* (does not exist|.*schema cache)/i.test(String(error.message ?? ""))
  );
}

/** CSV sütun adı (çakışmayı önlemek için önek). */
export function csvColumnName(def: Pick<CustomFieldDef, "label">): string {
  return `ozel: ${def.label}`;
}
