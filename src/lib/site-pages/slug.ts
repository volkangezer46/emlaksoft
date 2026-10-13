import { isProtectedFrom } from "@/lib/seo/redirects";

/**
 * Sayfa oluşturucu yol (slug) güvenliği (SAF; istemci editörü de içe aktarır).
 * Özel sayfa yalnız hiçbir gerçek rotayla çakışmayan, küçük harfli, en çok 3 segmentli yola yerleşir:
 *   desen ^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*){0,2}$, en çok 80 karakter.
 * İlk segment reddedilir: src/app altındaki her üst düzey rota dizini (sözleşme testi dizinleri tarar), sistem
 * önekleri ve yönlendirme korumasındaki (isProtectedFrom) yollar. Yeni üst düzey rota eklenince bu listeye de eklenir.
 */

export const SLUG_MAX = 80;
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*){0,2}$/;

/** src/app altındaki üst düzey rota dizinleri (site-pages.test.ts dizinleri tarar ve hepsinin burada olduğunu doğrular). */
export const RESERVED_ROUTE_DIRS = [
  "acik-ev-kayit",
  "actions",
  "admin",
  "anket",
  "api",
  "app",
  "araclar",
  "auth",
  "bakim",
  "brand-asset",
  "cerez-politikasi",
  "danisman",
  "davet-kosullari",
  "degerleme-raporu",
  "evrak",
  "fiyatlar",
  "fonts",
  "giris",
  "gizlilik",
  "imza",
  "iptal-iade",
  "kayit",
  "kullanim-sartlari",
  "kvkk-aydinlatma",
  "lead",
  "llms.txt",
  "malik-portali",
  "mesafeli-satis",
  "musteri-portali",
  "odeme-link",
  "on-bilgilendirme",
  "p",
  "paylas",
  "r",
  "randevu-al",
  "randevu-teyit",
  "sifre-sifirla",
  "sifre-yenile",
  "sitemap",
  "sitemap.xml",
  "site-menu-asset",
  "sunum",
  "tavsiye",
  "vitrin",
] as const;

/** Rota dizini olmasa da ayrılmış ilk segmentler (sistem, gelecekteki rotalar, statik dosyalar). */
export const RESERVED_SEGMENTS = [
  "admin",
  "api",
  "app",
  "giris",
  "kayit",
  "vitrin",
  "bakim",
  "onizleme",
  "_next",
  "static",
  "media",
  "robots",
  "favicon",
  "opengraph-image",
  "twitter-image",
  "manifest",
] as const;

/** Bu önekle başlayan ilk segmentler ayrılmıştır (sifre-sifirla, sifre-yenile ve gelecekteki şifre akışları). */
export const RESERVED_PREFIXES = ["sifre-"] as const;

export type SlugCheck = { ok: true; slug: string } | { ok: false; message: string };

/** Girişi yol biçimine yaklaştırır (baştaki/sondaki '/' ve boşluk atılır, küçük harf). Doğrulamanın yerini tutmaz. */
export function normalizeSlugInput(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLocaleLowerCase("tr")
    .replace(/^\/+|\/+$/g, "");
}

export function isReservedFirstSegment(seg: string): boolean {
  return (
    (RESERVED_ROUTE_DIRS as readonly string[]).includes(seg) ||
    (RESERVED_SEGMENTS as readonly string[]).includes(seg) ||
    RESERVED_PREFIXES.some((p) => seg.startsWith(p))
  );
}

/**
 * Yol doğrulaması. `taken`: diğer sayfaların yolları (benzersizlik). Büyük harf, '..', boşluk, Türkçe karakter,
 * 3'ten fazla segment ve ayrılmış ilk segment reddedilir.
 */
export function checkSlug(raw: string, taken: readonly string[] = []): SlugCheck {
  const slug = String(raw ?? "").trim().replace(/^\/+/, "");
  if (!slug) return { ok: false, message: "Sayfa yolu boş olamaz." };
  if (slug.length > SLUG_MAX) return { ok: false, message: `Sayfa yolu en çok ${SLUG_MAX} karakter olabilir.` };
  if (!SLUG_RE.test(slug)) {
    return { ok: false, message: "Sayfa yolu yalnız küçük harf (a-z), rakam ve tire içerebilir; en çok 3 bölüm (ör. kampanya/istanbul)." };
  }
  const first = slug.split("/")[0]!;
  if (isReservedFirstSegment(first)) return { ok: false, message: `"/${first}" sistemde ayrılmış bir yol; başka bir ad seçin.` };
  if (isProtectedFrom(`/${slug}`)) return { ok: false, message: "Bu yol korumalı alandadır (uygulama, yönetim, portal, vitrin); kullanılamaz." };
  if (taken.includes(slug)) return { ok: false, message: "Bu yolda zaten bir sayfa var." };
  return { ok: true, slug };
}

/** Başlıktan önerilen yol (Türkçe harfler sadeleşir). Saf. */
export function slugFromTitle(title: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };
  return String(title ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[çğıİöşüâîû]/g, (c) => map[c] ?? c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}
