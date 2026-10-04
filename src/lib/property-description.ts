/**
 * Portföy ilan açıklaması — TEK yazma yeri kuralları.
 *
 * Depo: `properties.features.description` (jsonb; şema değişikliği gerekmez). Public vitrin ilan sayfası
 * (`fetchDescription`) aynı anahtarı okur. İki giriş noktası vardır ve ikisi de bu modülü kullanır:
 *  1) Portföy düzenleme paneli "Açıklama" sekmesi (`updateProperty`, form alanı `description`)
 *  2) AI içerik paneli "Portföy açıklamasına kaydet" (`savePropertyDescription`)
 * Başka hiçbir yer description yazmaz (sözleşme testi: property-description.test.ts).
 */

/** Hepsiemlak sınırı (listing-text.ts PORTAL_LIMITS) ile uyumlu en kısa üst sınır. */
export const PROPERTY_DESCRIPTION_MAX = 5000;

export type DescriptionParse = { ok: true; value: string | null } | { ok: false; error: string };

/** Ham girdiyi normalleştirir: satır sonları LF, kenar boşlukları kırpılır, boş = null (silme). */
export function parsePropertyDescription(raw: unknown): DescriptionParse {
  const text = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return { ok: true, value: null };
  if (text.length > PROPERTY_DESCRIPTION_MAX) {
    return { ok: false, error: `Açıklama en fazla ${PROPERTY_DESCRIPTION_MAX} karakter olabilir.` };
  }
  return { ok: true, value: text };
}

/** Mevcut features'a açıklamayı birleştirir (diğer anahtarlar korunur; null = anahtar silinir). */
export function withDescription(features: Record<string, unknown> | null | undefined, value: string | null): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(features ?? {}) };
  if (value === null) delete next.description;
  else next.description = value;
  return next;
}
