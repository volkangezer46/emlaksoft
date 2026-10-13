/**
 * Sayfa oluşturucu sabitleri ve türleri: zod'suz çekirdek (istemci editörü içe aktarır; şema/doğrulayıcı schema.ts'te).
 * Bütün alanlar DÜZ METİN: HTML/markdown işlenmez (React metni kaçışlı basar); biçim = satır sonu → paragraf.
 */

export const PAGE_LIMITS = {
  maxPages: 50,
  /** Serileştirilmiş sayfa içeriği üst sınırı (bayt). */
  pageBytes: 120 * 1024,
  maxBlocks: 20,
  pageTitle: 120,
  eyebrow: 40,
  heading: 120,
  lead: 400,
  ctaLabel: 40,
  href: 300,
  paragraph: 1200,
  maxParagraphs: 12,
  bullet: 200,
  maxBullets: 12,
  featureTitle: 80,
  featureText: 300,
  maxFeatures: 12,
  question: 160,
  answer: 900,
  maxFaq: 20,
  seoTitle: 70,
  seoDescription: 160,
  ogTitle: 90,
  ogDescription: 200,
} as const;

export const PAGE_KINDS = ["kurumsal", "kampanya", "bolge", "bos"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];
export const PAGE_KIND_LABEL: Record<PageKind, string> = { kurumsal: "Kurumsal", kampanya: "Kampanya", bolge: "Bölge", bos: "Boş" };

export const PAGE_STATUSES = ["taslak", "yayinda", "arsiv"] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];
export const PAGE_STATUS_LABEL: Record<PageStatus, string> = { taslak: "Taslak", yayinda: "Yayında", arsiv: "Arşiv" };

export const BLOCK_TYPES = ["hero", "text", "features", "faq", "cta", "contact"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
export const BLOCK_LABEL: Record<BlockType, string> = {
  hero: "Giriş (başlık ve düğme)",
  text: "Metin",
  features: "Özellik kartları",
  faq: "Sık sorulan sorular",
  cta: "Çağrı (düğmeli kutu)",
  contact: "İletişim bilgileri",
};

export type PageLink = { label: string; href: string };
export type HeroBlock = { type: "hero"; eyebrow: string; title: string; lead: string; primary: PageLink; secondary?: PageLink };
export type TextBlock = { type: "text"; heading?: string; paragraphs: string[]; bullets: string[] };
export type FeatureItem = { icon: string; title: string; text: string };
export type FeaturesBlock = { type: "features"; heading: string; items: FeatureItem[] };
export type FaqBlock = { type: "faq"; items: Array<{ q: string; a: string }> };
export type CtaBlock = { type: "cta"; title: string; text: string; primary: PageLink; secondary?: PageLink };
export type ContactBlock = { type: "contact"; heading: string; showEmail: boolean; showPhone: boolean; showAddress: boolean };
export type PageBlock = HeroBlock | TextBlock | FeaturesBlock | FaqBlock | CtaBlock | ContactBlock;

export type PageSeo = {
  title: string;
  description: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  index: boolean;
  inSitemap: boolean;
};

export type SitePageContent = { title: string; blocks: PageBlock[]; seo: PageSeo };

export type SitePageIndexEntry = {
  id: string;
  slug: string;
  title: string;
  kind: PageKind;
  status: PageStatus;
  updatedAt: string;
  updatedBy: string;
};

/** Boş blok (editör "Blok ekle"). Saf. */
export function emptyBlock(type: BlockType): PageBlock {
  switch (type) {
    case "hero":
      return { type, eyebrow: "", title: "Yeni başlık", lead: "", primary: { label: "Denemeyi başlatın", href: "/kayit" } };
    case "text":
      return { type, heading: "", paragraphs: [""], bullets: [] };
    case "features":
      return { type, heading: "Öne çıkanlar", items: [{ icon: "Sparkles", title: "Başlık", text: "" }] };
    case "faq":
      return { type, items: [{ q: "Soru", a: "Cevap" }] };
    case "cta":
      return { type, title: "Ofisinizle denemeye başlayın", text: "", primary: { label: "Denemeyi başlatın", href: "/kayit" } };
    case "contact":
      return { type, heading: "Bize ulaşın", showEmail: true, showPhone: true, showAddress: false };
  }
}

/** SEO başlık/açıklaması boşsa ilk giriş bloğundan öneri (başlık ≤70, açıklama ≤160; kelime ortasında kesmez). Saf. */
export function suggestSeo(content: Pick<SitePageContent, "title" | "blocks">): { title: string; description: string } {
  const hero = content.blocks.find((b): b is HeroBlock => b.type === "hero");
  const firstText = content.blocks.find((b): b is TextBlock => b.type === "text");
  const cut = (v: string, max: number) => {
    const t = v.replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    const s = t.slice(0, max - 1);
    const sp = s.lastIndexOf(" ");
    return `${(sp > max * 0.6 ? s.slice(0, sp) : s).replace(/[\s,;:.-]+$/, "")}…`;
  };
  const title = cut(hero?.title || content.title, PAGE_LIMITS.seoTitle);
  const description = cut(hero?.lead || firstText?.paragraphs[0] || "", PAGE_LIMITS.seoDescription);
  return { title, description };
}

/** Taslak/canlı karşılaştırması. */
export function samePage(a: SitePageContent | null, b: SitePageContent | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Paragraf metni: satır sonları ayrı paragraf olur; boş satırlar atılır. Saf. */
export function paragraphLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
