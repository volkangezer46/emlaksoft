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
  /** Çoklu duyuru listesi (tarih, yol hedefi, öncelik). */
  maxAnnouncements: 5,
  announcementItemText: 160,
  pathPrefix: 120,
  /** Alt bilgi marka bloğu. */
  footerDescription: 240,
  maxFooterBadges: 4,
  footerBadge: 40,
  footerCta: 30,
  copyright: 120,
  disclaimer: 240,
  /** Dönüşüm düğmeleri (üst bar, mega panel, mobil alt çubuk). */
  ctaLabel: 30,
  /** Paylaşım kartı (1200x630). Rozet sınırı bugünkü en uzun rozeti ("İYS/EİDS hazırlık akışları", 26) taşır. */
  ogTitle: 70,
  ogSubtitle: 120,
  maxOgChips: 3,
  ogChip: 28,
  /** 404 sayfası. */
  notFoundTitle: 80,
  notFoundText: 240,
  maxNotFoundLinks: 6,
  notFoundLabel: 36,
  notFoundDesc: 80,
  href: 300,
  /** Serileştirilmiş yapılandırma üst sınırı (bayt). */
  jsonBytes: 120 * 1024,
} as const;

export const FEATURED_RATIOS = ["16:9", "4:3", "3:2", "1:1", "21:9"] as const;
export type FeaturedRatio = (typeof FEATURED_RATIOS)[number];
export const MEDIA_KINDS = ["image", "animated", "video"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];


export const ANNOUNCEMENT_PATH_MODES = ["all", "home", "prefix"] as const;
export type AnnouncementPathMode = (typeof ANNOUNCEMENT_PATH_MODES)[number];
/** Alt bilgi güven rozeti ikonları (sprite + imza ikonu; istemciye ikon paketi girmez). */
export const FOOTER_BADGE_ICONS = ["shield-check", "scale", "file-signature", "check", "clock", "none"] as const;
export type FooterBadgeIcon = (typeof FOOTER_BADGE_ICONS)[number];

/** Dönüşüm düğmeleri bugünkü sabit metinleri (yayın yokken çıktı aynı kalsın; istemci bileşeni de yedek olarak kullanır). */
export const DEFAULT_CTAS = {
  login: { label: "Giriş yap", href: "/giris" },
  trial: { label: "Ücretsiz dene", href: "/kayit" },
  mobileLogin: { label: "Giriş", href: "/giris" },
  /** Boş metin: deneme günüyle otomatik ("Ücretsiz dene — 14 gün", marketing-copy). */
  mobileTrial: { label: "", href: "/kayit" },
} as const;
export type CtaKey = keyof typeof DEFAULT_CTAS;
export type CtaLink = { label: string; href: string };
export type SiteCtas = Record<CtaKey, CtaLink>;

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

/**
 * Çerçeve alanları (alt bilgi düğmesi, dönüşüm düğmeleri, duyuru, 404) için daha sıkı kural: yalnız var olan site yolu
 * ya da https adresi. mailto/tel/http reddedilir (checkHref'in tüm reddleri de geçerli: javascript:, data: vb.).
 */
export function checkPageHref(raw: string): HrefCheck {
  const r = checkHref(raw);
  if (!r.ok) return r;
  if (r.kind === "internal") return r;
  if (r.kind === "external" && /^https:\/\//i.test(raw.trim())) return { ok: true, kind: "external" };
  return { ok: false, message: "Bu alanda yalnız / ile başlayan site yolu veya https adresi kullanılabilir." };
}

/** Dış web adresi mi (yeni sekme + rel=noopener gerektirir). */
export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}


export type MediaInfo = { id: string; type: string; kind: MediaKind; bytes: number };
export type ValidationContext = {
  media: ReadonlyArray<MediaInfo>;
  /** Riskli iddia algılayıcı (site-content `riskyWordsIn`); verilirse metinlere UYARI eklenir, kaydı engellemez. */
  risky?: (value: string) => string[];
};
export type Issue = { level: "error" | "warn"; path: string; message: string };


export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((i) => i.level === "error");
}
