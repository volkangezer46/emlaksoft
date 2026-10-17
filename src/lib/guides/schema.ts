import { z } from "zod";
import { TOOL_EMBED_SLUGS, plainTextOf, wordCount } from "@/lib/rich-text/core";
import { richBodySchema, validateRichBody, type RichIssue } from "@/lib/rich-text/schema";
import { GUIDE_CATEGORIES, GUIDE_LIMITS as L, GUIDE_STATUSES, THIN_CONTENT_WORDS, type GuideContent, type GuideIndexEntry } from "./defaults";

export * from "./defaults";

/**
 * Rehber şeması (SAF; sunucu ve editörün tembel doğrulayıcısı ortak). Gövde `richBodySchema` (ham HTML yok).
 * Hatalar kaydı engeller; uyarılar (kırık iç bağlantı, boş SEO, ince içerik, H2 yok) engellemez.
 */

export type GuideIssue = RichIssue;

const text = (max: number, label: string) => z.string().trim().max(max, `${label} en fazla ${max} karakter olabilir.`);

export const guideContentSchema = z.strictObject({
  title: text(L.title, "Başlık").min(1, "Başlık boş olamaz."),
  category: z.enum(GUIDE_CATEGORIES, { error: "Kategori listeden seçilmeli." }),
  seo: z.strictObject({
    title: text(L.seoTitle, "SEO başlığı"),
    description: text(L.seoDescription, "SEO açıklaması"),
    focusKeyword: text(L.focusKeyword, "Odak anahtar kelime").optional(),
  }),
  body: richBodySchema,
  relatedTools: z.array(z.enum(TOOL_EMBED_SLUGS)).max(L.maxRelatedTools, `En fazla ${L.maxRelatedTools} ilgili araç seçilebilir.`),
});

const iso = z.string().max(40);

export const guideIndexSchema = z
  .array(
    z.strictObject({
      id: z.string().regex(/^[a-f0-9]{12}$/),
      slug: z.string().max(L.slug),
      title: z.string().max(L.title),
      category: z.enum(GUIDE_CATEGORIES),
      status: z.enum(GUIDE_STATUSES),
      publishedAt: iso.nullable(),
      firstPublishedAt: iso.nullable(),
      updatedAt: iso,
      updatedBy: z.string().max(120),
    }),
  )
  .max(L.maxGuides);

/** Depodan okunan içerik (geçersizse null; site bozuk kayıtla çizilmez). */
export function parseGuideContent(value: unknown): GuideContent | null {
  const r = guideContentSchema.safeParse(value);
  return r.success ? (r.data as GuideContent) : null;
}

/** Sıkı liste: geçersizse null (yazmalar bozuk listeyi "boş" sanıp ezmesin). */
export function parseGuideIndexStrict(value: unknown): GuideIndexEntry[] | null {
  const r = guideIndexSchema.safeParse(value);
  return r.success ? (r.data as GuideIndexEntry[]) : null;
}

/** Görünen kelime sayısı. */
export function guideWordCount(content: Pick<GuideContent, "body">): number {
  return wordCount(plainTextOf(content.body));
}

/** İnce içerik: indekslenmez ve sitemap'e girmez. */
export function isThinGuide(content: Pick<GuideContent, "body">): boolean {
  return guideWordCount(content) < THIN_CONTENT_WORDS;
}

/**
 * Tam doğrulama. `extraPaths`: iç bağlantı sayılan rehber yolları (yayındaki diğer yazılar, kategori sayfaları, /rehber).
 */
export function validateGuide(input: unknown, opts: { extraPaths?: readonly string[] } = {}): { guide: GuideContent | null; issues: GuideIssue[] } {
  const issues: GuideIssue[] = [];
  const parsed = guideContentSchema.safeParse(input);
  if (!parsed.success) {
    for (const i of parsed.error.issues) issues.push({ level: "error", path: i.path.join("."), message: i.message });
    return { guide: null, issues };
  }
  const guide = parsed.data as GuideContent;
  issues.push(...validateRichBody(guide.body, { pathPrefix: "body", extraPaths: opts.extraPaths }).issues);
  if (/[\u0000-\u001f\u007f]/.test(guide.title + guide.seo.title + guide.seo.description)) {
    issues.push({ level: "error", path: "title", message: "Görünmez denetim karakteri var; metni yeniden yazın." });
  }
  if (!guide.seo.title) issues.push({ level: "warn", path: "seo.title", message: "SEO başlığı boş; yazı başlığı kullanılır." });
  if (!guide.seo.description) issues.push({ level: "warn", path: "seo.description", message: "SEO açıklaması boş; ilk paragraftan özet kullanılır." });
  if (!guide.body.some((b) => b.type === "h2")) issues.push({ level: "warn", path: "body", message: "Ara başlık (H2) yok; içindekiler listesi oluşmaz." });
  const words = guideWordCount(guide);
  if (words < THIN_CONTENT_WORDS) {
    issues.push({ level: "warn", path: "body", message: `İnce içerik (${words} kelime): ${THIN_CONTENT_WORDS} kelimenin altındaki yazı arama motorlarına kapalıdır ve sitemap'e girmez.` });
  }
  const bytes = new TextEncoder().encode(JSON.stringify(guide)).length;
  if (bytes > L.guideBytes) issues.push({ level: "error", path: "", message: `Yazı çok büyük (${Math.round(bytes / 1024)} KB); en çok ${L.guideBytes / 1024} KB.` });
  return { guide, issues };
}

export function guideHasErrors(issues: readonly GuideIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}
