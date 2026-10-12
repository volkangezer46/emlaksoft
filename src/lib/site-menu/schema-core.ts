/** Site menüsü sabitleri ve saf yardımcılar: zod'suz çekirdek (istemci editörü içe aktarır; şema/doğrulayıcı schema.ts'te). */
import { isKnownAnchor, isKnownPublicPath } from "./known-routes";

export const LIMITS = {
  maxGroups: 8,
  maxItemsPerGroup: 12,
  maxTotalItems: 60,
  maxFooterColumns: 8,
  maxFooterLinksPerColumn: 12,
  maxFooterLinks: 60,
  groupLabel: 24,
  itemLabel: 36,
  itemText: 80,
  featuredTitle: 50,
  featuredText: 140,
  featuredCta: 24,
  featuredAlt: 100,
  featuredEyebrow: 24,
  sectionTitle: 28,
  maxSectionsPerGroup: 3,
  footerTitle: 24,
  footerLabel: 48,
  announcementText: 140,
  announcementLinkLabel: 24,
  href: 300,
  /** Serileştirilmiş yapılandırma üst sınırı (bayt). */
  jsonBytes: 120 * 1024,
} as const;

export const FEATURED_RATIOS = ["16:9", "4:3", "3:2", "1:1", "21:9"] as const;
export type FeaturedRatio = (typeof FEATURED_RATIOS)[number];
export const MEDIA_KINDS = ["image", "animated", "video"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];


export const FEATURED_PREVIEWS = ["leak", "valuation", "signature", "plans", "assistant", "listing", "security", "automation", "dashboard"] as const;
export type FeaturedPreviewKind = (typeof FEATURED_PREVIEWS)[number];


export type HrefCheck =
  | { ok: true; kind: "internal" | "external" | "mailto" | "tel"; warn?: string }
  | { ok: false; message: string };

/** Yalnız `/` ile başlayan var olan sayfa yolu, http(s), mailto ve tel kabul edilir; javascript:/data: vb. reddedilir. */
export function checkHref(raw: string): HrefCheck {
  const href = raw.trim();
  if (!href) return { ok: false, message: "Bağlantı boş olamaz." };
  if (href.length > LIMITS.href) return { ok: false, message: "Bağlantı çok uzun." };
  if (/[\s\u0000-\u001f\u007f-\u009f\\<>"'`]/.test(href)) return { ok: false, message: "Bağlantıda boşluk veya geçersiz karakter var." };

  if (href.startsWith("/")) {
    if (href.startsWith("//")) return { ok: false, message: "Çift eğik çizgiyle başlayan adres kabul edilmez." };
    const hashAt = href.indexOf("#");
    const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt);
    const hash = hashAt === -1 ? "" : href.slice(hashAt + 1);
    const qAt = beforeHash.indexOf("?");
    const pathRaw = qAt === -1 ? beforeHash : beforeHash.slice(0, qAt);
    const query = qAt === -1 ? "" : beforeHash.slice(qAt + 1);
    const path = pathRaw.length > 1 ? pathRaw.replace(/\/+$/, "") : pathRaw;
    if (!isKnownPublicPath(path)) return { ok: false, message: `"${path}" sitede bulunan bir sayfa değil.` };
    if (query && !/^[A-Za-z0-9_=&.%-]+$/.test(query)) return { ok: false, message: "Sorgu parametresi geçersiz." };
    if (hashAt !== -1) {
      if (!isKnownAnchor(path, hash)) return { ok: false, message: `"${path}" sayfasında "#${hash}" bölümü yok.` };
    }
    return { ok: true, kind: "internal" };
  }

  if (/^https?:\/\//i.test(href)) {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return { ok: false, message: "Web adresi geçersiz." };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, message: "Yalnız http ve https adresleri kabul edilir." };
    if (url.username || url.password) return { ok: false, message: "Adreste kullanıcı bilgisi olamaz." };
    if (!url.hostname.includes(".")) return { ok: false, message: "Web adresinde geçerli bir alan adı olmalı." };
    return { ok: true, kind: "external", warn: url.protocol === "http:" ? "Güvensiz http adresi; mümkünse https kullanın." : undefined };
  }

  if (/^mailto:/i.test(href)) {
    return /^mailto:[^\s@?]+@[^\s@?]+\.[^\s@?]+(\?[A-Za-z0-9_=&.%+-]+)?$/i.test(href)
      ? { ok: true, kind: "mailto" }
      : { ok: false, message: "E-posta bağlantısı mailto:ad@alanadi.com biçiminde olmalı." };
  }
  if (/^tel:/i.test(href)) {
    return /^tel:\+?[0-9()-]{5,20}$/i.test(href)
      ? { ok: true, kind: "tel" }
      : { ok: false, message: "Telefon bağlantısı tel:+90... biçiminde olmalı." };
  }
  return { ok: false, message: "Yalnız / ile başlayan site yolu, http(s), mailto ve tel kabul edilir." };
}

/** Dış web adresi mi (yeni sekme + rel=noopener gerektirir). */
export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}


export type MediaInfo = { id: string; type: string; kind: MediaKind; bytes: number };
export type ValidationContext = { media: ReadonlyArray<MediaInfo> };
export type Issue = { level: "error" | "warn"; path: string; message: string };


export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((i) => i.level === "error");
}
