import { isReservedFirstSegment, slugFromTitle } from "@/lib/site-pages/slug";
import { GUIDE_LIMITS } from "./defaults";

/**
 * Rehber yazısı yolu (SAF; istemci editörü de içe aktarır). Kurallar sayfa oluşturucunun (AP6) slug.ts'iyle AYNIDIR:
 * küçük harf, Türkçe harf dönüşümü (ç→c, ğ→g, ı/İ→i, ö→o, ş→s, ü→u), yalnız a-z/0-9/tire ve ayrılmış yollar
 * (admin, api, kayit, giris, src/app rotaları, sistem önekleri) reddedilir. Rehber yazısı tek bölümlüdür (/rehber/<slug>)
 * ve rehberin kendi alt yolları (kategori, rss) da ayrılmıştır.
 */

export const GUIDE_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** /rehber altındaki sabit yollar ve gelecekte açılabilecekler. */
export const GUIDE_RESERVED = ["kategori", "rss", "rss-xml", "sayfa", "ara", "etiket", "yazar", "onizleme", "rehber"] as const;

export type GuideSlugCheck = { ok: true; slug: string } | { ok: false; message: string };

/** Girişi yola çevirir (Türkçe harf dönüşümü, boşluk/işaret → tire). Doğrulamanın yerini tutmaz. */
export function toGuideSlug(raw: string): string {
  return slugFromTitle(String(raw ?? "").replace(/^\/+|\/+$/g, "")).slice(0, GUIDE_LIMITS.slug).replace(/-+$/g, "");
}

/** Yol doğrulaması: giriş önce `toGuideSlug` ile dönüştürülür. `taken`: diğer yazıların yolları. */
export function checkGuideSlug(raw: string, taken: readonly string[] = []): GuideSlugCheck {
  const input = String(raw ?? "").trim();
  if (!input) return { ok: false, message: "Yazı yolu boş olamaz." };
  if (input.includes("/")) return { ok: false, message: "Yazı yolu tek bölümlü olmalı (eğik çizgi kullanılamaz)." };
  const slug = toGuideSlug(input);
  if (!slug || !GUIDE_SLUG_RE.test(slug)) return { ok: false, message: "Yazı yolu yalnız harf, rakam ve tire içerebilir." };
  if (slug.length > GUIDE_LIMITS.slug) return { ok: false, message: `Yazı yolu en çok ${GUIDE_LIMITS.slug} karakter olabilir.` };
  if (isReservedFirstSegment(slug) || (GUIDE_RESERVED as readonly string[]).includes(slug)) {
    return { ok: false, message: `"${slug}" sistemde ayrılmış bir yol; başka bir ad seçin.` };
  }
  if (taken.includes(slug)) return { ok: false, message: "Bu yolda zaten bir yazı var." };
  return { ok: true, slug };
}
