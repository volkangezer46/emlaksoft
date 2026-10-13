/**
 * İlan görseli alt metni (SAF). Kullanıcının yazdığı alt metin varsa o kullanılır; yoksa
 * `{tip} {oda} – {ilce}, fotoğraf n` biçiminde üretilir (boş alanlar ve artık ayraçlar düşer).
 * Ham adres alanı KULLANILMAZ.
 */

export type ListingAltInput = {
  type?: string | null;
  rooms?: string | null;
  district?: string | null;
  /** İlçe yoksa il. */
  province?: string | null;
  /** Hiç özellik yoksa son çare (ilan başlığı). */
  title?: string | null;
};

const txt = (v: unknown): string => (v == null ? "" : String(v).replace(/[<>]/g, "").replace(/\s+/g, " ").trim());

export function listingImageAlt(input: ListingAltInput, n: number, userAlt?: string | null): string {
  const own = txt(userAlt);
  if (own) return own.slice(0, 160);
  const what = [input.type, input.rooms].map(txt).filter(Boolean).join(" ");
  const where = txt(input.district) || txt(input.province);
  const label = [what, where].filter(Boolean).join(" – ") || txt(input.title) || "Portföy";
  return `${label}, fotoğraf ${Math.max(1, Math.floor(n))}`;
}
