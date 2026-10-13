import type { RichBlock, ToolEmbedSlug } from "@/lib/rich-text/core";

/**
 * Rehber (blog) sabitleri ve türleri: zod'suz çekirdek (istemci editörü içe aktarır; şema schema.ts'te).
 * Kategoriler bu turda SABİT enum'dur (yönetim ekranı yok). Depolama: platform_settings `guides.index` (liste) +
 * sürümlü `guide.<id>.live|draft|history` (store.ts).
 *
 * HACİM NOTU: liste en çok 300 yazı taşır (`maxGuides`). 300'e yaklaşınca (liste anahtarı tek JSON değeri, yayın başına
 * tamamı yeniden yazılır) ayrı tablo kararı SAHİBE sorulur; o zamana dek migration yok.
 */

export const GUIDE_LIMITS = {
  maxGuides: 300,
  title: 120,
  /** SEO kartı: başlık ≤60, açıklama ≤155 (arama sonucunda kesilmeden görünür). */
  seoTitle: 60,
  seoDescription: 155,
  slug: 80,
  maxRelatedTools: 4,
  /** Serileştirilmiş yazı üst sınırı (bayt). */
  guideBytes: 256 * 1024,
} as const;

/** Bu kelime sayısının altındaki yazı "ince içerik"tir: noindex, sitemap'e girmez. */
export const THIN_CONTENT_WORDS = 300;

export const GUIDE_CATEGORIES = ["ofis-yonetimi", "satis-ve-pazarlama", "mevzuat-ve-kvkk", "finans-ve-vergi", "emlak-teknolojisi"] as const;
export type GuideCategory = (typeof GUIDE_CATEGORIES)[number];

export const GUIDE_CATEGORY_LABEL: Record<GuideCategory, string> = {
  "ofis-yonetimi": "Ofis yönetimi",
  "satis-ve-pazarlama": "Satış ve pazarlama",
  "mevzuat-ve-kvkk": "Mevzuat ve KVKK",
  "finans-ve-vergi": "Finans ve vergi",
  "emlak-teknolojisi": "Emlak teknolojisi",
};

export const GUIDE_CATEGORY_DESCRIPTION: Record<GuideCategory, string> = {
  "ofis-yonetimi": "Emlak ofisinde ekip, portföy ve günlük iş akışını düzenlemek için uygulamalı rehberler.",
  "satis-ve-pazarlama": "Portföy edinme, ilan, müşteri takibi ve satış sürecine dair rehberler.",
  "mevzuat-ve-kvkk": "Yetki belgesi, sözleşmeler ve kişisel verilerin korunması üzerine rehberler.",
  "finans-ve-vergi": "Komisyon, tapu masrafı, kira getirisi ve vergi hesaplarına dair rehberler.",
  "emlak-teknolojisi": "CRM, otomasyon ve dijital araçlarla emlak ofisini büyütmeye dair rehberler.",
};

export function isGuideCategory(v: unknown): v is GuideCategory {
  return typeof v === "string" && (GUIDE_CATEGORIES as readonly string[]).includes(v);
}

export const GUIDE_STATUSES = ["taslak", "yayinda", "arsiv"] as const;
export type GuideStatus = (typeof GUIDE_STATUSES)[number];
export const GUIDE_STATUS_LABEL: Record<GuideStatus, string> = { taslak: "Taslak", yayinda: "Yayında", arsiv: "Yayından kaldırıldı" };

export type GuideSeo = { title: string; description: string };

export type GuideContent = {
  /** Sayfa başlığı (h1). */
  title: string;
  category: GuideCategory;
  seo: GuideSeo;
  body: RichBlock[];
  /** Elle seçilen ilgili araçlar (gövdedeki araç kartlarına ek). */
  relatedTools: ToolEmbedSlug[];
};

export type GuideIndexEntry = {
  id: string;
  slug: string;
  title: string;
  category: GuideCategory;
  status: GuideStatus;
  /** Yayındaki sürümün yayın zamanı (geçmişteki `at`); hiç yayınlanmadıysa null. */
  publishedAt: string | null;
  /** İlk yayın (Article datePublished). */
  firstPublishedAt: string | null;
  updatedAt: string;
  updatedBy: string;
};

/** Yeni yazı iskeleti (taslak). Saf. */
export function emptyGuide(title: string, category: GuideCategory): GuideContent {
  return {
    title,
    category,
    seo: { title: "", description: "" },
    body: [
      { type: "p", text: "" },
      { type: "h2", text: "Başlık" },
      { type: "p", text: "" },
    ],
    relatedTools: [],
  };
}

export function sameGuide(a: GuideContent | null, b: GuideContent | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const guidePath = (slug: string) => `/rehber/${slug}`;
export const guideCategoryPath = (k: GuideCategory) => `/rehber/kategori/${k}`;
