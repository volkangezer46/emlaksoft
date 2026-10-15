/**
 * PORTAL İÇİN GEREKEN EK PORTFÖY ALANLARI (SAF, testli). Migration YOK: değerler `properties.features` jsonb'ye yazılır
 * (mevcut anahtarlar: rooms, sqm, floor, heating, building_age, facade, description, virtual_tour_url). Portal "ilan ver"
 * formları brüt/net m², kat sayısı, banyo, aidat, site içi, krediye uygunluk gibi alanları ister; boş kalırsa form yarım
 * dolar ve kullanıcı yine elle tamamlar. Tapu durumu AYRI alandır: ilan sahibi bilgisindeki `deed_status` (tek kaynak).
 *
 * Yazma kuralı: bir anahtar YALNIZ formda alanı varsa yazılır (portföy düzenleme formu bu alanları göstermiyorsa mevcut
 * değer silinmez). Boş gönderilen alan anahtarı temizler (null).
 */

import { parseTrDecimal } from "@/lib/money-input";

export type PortalFeatureKind = "int" | "decimal" | "bool" | "enum" | "text";

export type PortalFeatureDef = {
  key: string;
  label: string;
  kind: PortalFeatureKind;
  options?: readonly string[];
  max?: number;
  hint?: string;
};

export const FURNISHED_OPTIONS = ["Eşyalı", "Eşyasız"] as const;
export const USAGE_STATUS_OPTIONS = ["Boş", "Kiracılı", "Mülk sahibi"] as const;
export const PARKING_OPTIONS = ["Yok", "Açık otopark", "Kapalı otopark", "Açık ve kapalı otopark"] as const;
export const CURRENCY_OPTIONS = ["TL", "USD", "EUR"] as const;

export const PORTAL_FEATURES: readonly PortalFeatureDef[] = [
  { key: "gross_sqm", label: "Brüt m²", kind: "decimal", max: 1_000_000, hint: "Boşsa 'm²' (brüt) kabul edilir." },
  { key: "net_sqm", label: "Net m²", kind: "decimal", max: 1_000_000 },
  { key: "total_floors", label: "Binadaki kat sayısı", kind: "int", max: 200 },
  { key: "bathrooms", label: "Banyo sayısı", kind: "int", max: 30 },
  { key: "balcony", label: "Balkon", kind: "bool" },
  { key: "elevator", label: "Asansör", kind: "bool" },
  { key: "parking", label: "Otopark", kind: "enum", options: PARKING_OPTIONS },
  { key: "furnished", label: "Eşya durumu", kind: "enum", options: FURNISHED_OPTIONS },
  { key: "usage_status", label: "Kullanım durumu", kind: "enum", options: USAGE_STATUS_OPTIONS },
  { key: "in_site", label: "Site içinde", kind: "bool" },
  { key: "site_name", label: "Site adı", kind: "text", max: 80 },
  { key: "dues", label: "Aidat (TL)", kind: "decimal", max: 10_000_000 },
  { key: "credit_eligible", label: "Krediye uygun", kind: "bool" },
  { key: "swap_ok", label: "Takasa uygun", kind: "bool" },
  { key: "currency", label: "Para birimi", kind: "enum", options: CURRENCY_OPTIONS },
];

export const PORTAL_FEATURE_KEYS: readonly string[] = PORTAL_FEATURES.map((f) => f.key);

const NONE = Symbol("none");

function parseOne(def: PortalFeatureDef, raw: string): unknown {
  const s = raw.trim();
  if (!s) return null;
  switch (def.kind) {
    case "int": {
      const n = Number(s.replace(",", "."));
      if (!Number.isFinite(n) || n < 0 || n > (def.max ?? 1_000_000)) return NONE;
      return Math.trunc(n);
    }
    case "decimal": {
      // Tek Türkçe ayrıştırıcı (money-input): "1.250" → 1250 (binlik), "1.250,50" ve "1250.5" → 1250.5,
      // "120 m²" / "1.500 TL" → birim atılır. Eski dal noktayı ondalık sayıp aidat "1.500" → 1.5 yazıyordu (B093).
      const r = parseTrDecimal(s, { max: def.max ?? 1e9, allowZero: true });
      return r.ok && r.value != null ? r.value : NONE;
    }
    case "bool":
      if (s === "yes" || s === "Evet") return true;
      if (s === "no" || s === "Hayır") return false;
      return NONE;
    case "enum":
      return def.options?.includes(s) ? s : NONE;
    case "text":
      return s.replace(/\s+/g, " ").slice(0, def.max ?? 80);
  }
}

/**
 * Form değerlerinden yalnız formda BULUNAN portal alanlarını üretir. Geçersiz değer boş (null) sayılır:
 * ek alanlar isteğe bağlıdır, kayıt asla bunun yüzünden reddedilmez — ama sessiz de kalınmaz: `ignored`
 * listesi çağırana 'yok sayıldı: Aidat "abc"' uyarısı için döner (B093).
 */
export function parsePortalFeatureFieldsDetailed(form: { has(name: string): boolean; get(name: string): unknown }): {
  values: Record<string, unknown>;
  ignored: { key: string; label: string; raw: string }[];
} {
  const values: Record<string, unknown> = {};
  const ignored: { key: string; label: string; raw: string }[] = [];
  for (const def of PORTAL_FEATURES) {
    if (!form.has(def.key)) continue;
    const raw = String(form.get(def.key) ?? "");
    const v = parseOne(def, raw);
    if (v === NONE) ignored.push({ key: def.key, label: def.label, raw: raw.trim().slice(0, 40) });
    values[def.key] = v === NONE ? null : v;
  }
  return { values, ignored };
}

/** `parsePortalFeatureFieldsDetailed` değerleri (uyarısız çağıranlar için). */
export function parsePortalFeatureFields(form: { has(name: string): boolean; get(name: string): unknown }): Record<string, unknown> {
  return parsePortalFeatureFieldsDetailed(form).values;
}

/** Yok sayılan ek alanların kullanıcı metni: `yok sayıldı: Aidat "abc", Kat "Bahçe katı"`. Boşsa null. */
export function ignoredFieldsWarning(ignored: readonly { label: string; raw: string }[]): string | null {
  if (!ignored.length) return null;
  return `Geçersiz değer kaydedilmedi, yok sayıldı: ${ignored.map((i) => `${i.label} "${i.raw}"`).join(", ")}.`;
}

/** Form varsayılanı için: kayıtlı değer → alan metni ("yes"/"no" ya da ham metin). */
export function featureFormValue(def: PortalFeatureDef, features: Record<string, unknown> | null | undefined): string {
  const v = features?.[def.key];
  if (v === null || v === undefined || v === "") return "";
  if (def.kind === "bool") return v === true ? "yes" : v === false ? "no" : "";
  return String(v);
}

/** Portal başına zorunlu/önerilen alanların insan okur adı (hazırlık kontrolü ve eklenti "elle doldurun" listesi). */
export function featureLabel(key: string): string {
  return PORTAL_FEATURES.find((f) => f.key === key)?.label ?? key;
}
