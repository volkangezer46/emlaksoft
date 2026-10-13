/** Site medyası ortak türleri ve saf yardımcılar (sunucu + istemci; sharp/DB içe aktarmaz). */

export type VariantFormat = "avif" | "webp";
export type MediaVariant = { file: string; w: number; h: number; format: VariantFormat; bytes: number };

/** Ana sayfada çizim için gereken alanlar (istemciye/HTML'e giden tek görünüm). */
export type SiteMediaView = { id: string; alt: string; w: number; h: number; variants: MediaVariant[]; lqip: string };

/** Yönetim ekranı satırı. */
export type SiteMediaRow = SiteMediaView & { title: string | null; bytes: number; mime: string; usedBy: string[]; createdAt: string };

export const SITE_MEDIA_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Kayıtlı varyant adı: yalnız bu desene uyan ad sunulur (yol geçişi yok). */
export const VARIANT_FILE_RE = /^(\d{2,4})w-([a-f0-9]{8})\.(avif|webp)$/;

export const mediaUrl = (id: string, file: string) => `/medya/${id}/${file}`;

/** jsonb varyant listesini doğrular (bozuk satır çizilmez). */
export function parseVariants(value: unknown): MediaVariant[] {
  if (!Array.isArray(value)) return [];
  const out: MediaVariant[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if (typeof r.file !== "string" || !VARIANT_FILE_RE.test(r.file)) continue;
    if (r.format !== "avif" && r.format !== "webp") continue;
    const w = Number(r.w);
    const h = Number(r.h);
    const bytes = Number(r.bytes);
    if (!(w > 0 && h > 0 && bytes >= 0)) continue;
    out.push({ file: r.file, w, h, format: r.format, bytes });
  }
  return out;
}
