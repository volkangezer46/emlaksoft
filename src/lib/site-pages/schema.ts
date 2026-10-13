import { z } from "zod";
import { checkHref, type Issue } from "@/lib/site-menu/schema";
import { isMenuIconName } from "@/lib/site-menu/icon-registry";
import { riskyWordsIn } from "@/lib/site-content/schema";
import { PAGE_KINDS, PAGE_LIMITS, PAGE_STATUSES, type SitePageContent, type SitePageIndexEntry } from "./schema-core";

export * from "./schema-core";

/**
 * Sayfa oluşturucu şeması (SAF; sunucu ve istemci ortak). Bloklar ayrık birleşim (discriminated union), hepsi düz metin.
 * Bağlantılar site menüsünün `checkHref` doğrulayıcısından geçer (javascript:/data: vb. reddedilir); yayınlı diğer özel
 * sayfaların yolları da iç bağlantı sayılır. Riskli vaat kelimeleri (`riskyWordsIn`) UYARIDIR, kaydı engellemez.
 */

const text = (max: number, label: string) => z.string().trim().max(max, `${label} en fazla ${max} karakter olabilir.`);
const href = z.string().trim().max(PAGE_LIMITS.href, "Bağlantı çok uzun.");
const link = z.strictObject({ label: text(PAGE_LIMITS.ctaLabel, "Düğme metni").min(1, "Düğme metni boş olamaz."), href });

/** Aynı site yolu ("/x") ya da mutlak https adresi (seo şemasındaki `pathOrUrl` ile aynı kural). */
const pathOrUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => (v.startsWith("/") && !v.startsWith("//") && !/\s/.test(v)) || /^https:\/\/[^\s]+$/.test(v), "Yol '/' ile başlamalı ya da https adresi olmalı");

const heroBlock = z.strictObject({
  type: z.literal("hero"),
  eyebrow: text(PAGE_LIMITS.eyebrow, "Üst başlık"),
  title: text(PAGE_LIMITS.heading, "Başlık").min(1, "Başlık boş olamaz."),
  lead: text(PAGE_LIMITS.lead, "Açıklama"),
  primary: link,
  secondary: link.optional(),
});

const textBlock = z.strictObject({
  type: z.literal("text"),
  heading: text(PAGE_LIMITS.heading, "Ara başlık").optional(),
  paragraphs: z.array(text(PAGE_LIMITS.paragraph, "Paragraf")).max(PAGE_LIMITS.maxParagraphs, `En fazla ${PAGE_LIMITS.maxParagraphs} paragraf olabilir.`),
  bullets: z.array(text(PAGE_LIMITS.bullet, "Madde")).max(PAGE_LIMITS.maxBullets, `En fazla ${PAGE_LIMITS.maxBullets} madde olabilir.`),
});

const featuresBlock = z.strictObject({
  type: z.literal("features"),
  heading: text(PAGE_LIMITS.heading, "Başlık"),
  items: z
    .array(
      z.strictObject({
        icon: z.string().refine((v) => isMenuIconName(v), "Bilinmeyen simge; listeden seçin."),
        title: text(PAGE_LIMITS.featureTitle, "Kart başlığı").min(1, "Kart başlığı boş olamaz."),
        text: text(PAGE_LIMITS.featureText, "Kart metni"),
      }),
    )
    .max(PAGE_LIMITS.maxFeatures, `En fazla ${PAGE_LIMITS.maxFeatures} kart olabilir.`),
});

const faqBlock = z.strictObject({
  type: z.literal("faq"),
  items: z
    .array(
      z.strictObject({
        q: text(PAGE_LIMITS.question, "Soru").min(1, "Soru boş olamaz."),
        a: text(PAGE_LIMITS.answer, "Cevap").min(1, "Cevap boş olamaz."),
      }),
    )
    .max(PAGE_LIMITS.maxFaq, `En fazla ${PAGE_LIMITS.maxFaq} soru olabilir.`),
});

const ctaBlock = z.strictObject({
  type: z.literal("cta"),
  title: text(PAGE_LIMITS.heading, "Başlık").min(1, "Başlık boş olamaz."),
  text: text(PAGE_LIMITS.lead, "Metin"),
  primary: link,
  secondary: link.optional(),
});

const contactBlock = z.strictObject({
  type: z.literal("contact"),
  heading: text(PAGE_LIMITS.heading, "Başlık"),
  showEmail: z.boolean(),
  showPhone: z.boolean(),
  showAddress: z.boolean(),
});

export const pageBlockSchema = z.discriminatedUnion("type", [heroBlock, textBlock, featuresBlock, faqBlock, ctaBlock, contactBlock]);

export const sitePageContentSchema = z.strictObject({
  title: text(PAGE_LIMITS.pageTitle, "Sayfa adı").min(1, "Sayfa adı boş olamaz."),
  blocks: z.array(pageBlockSchema).max(PAGE_LIMITS.maxBlocks, `En fazla ${PAGE_LIMITS.maxBlocks} blok olabilir.`),
  seo: z.strictObject({
    title: text(PAGE_LIMITS.seoTitle, "SEO başlığı"),
    description: text(PAGE_LIMITS.seoDescription, "SEO açıklaması"),
    ogTitle: text(PAGE_LIMITS.ogTitle, "Paylaşım başlığı").optional(),
    ogDescription: text(PAGE_LIMITS.ogDescription, "Paylaşım açıklaması").optional(),
    ogImage: pathOrUrl.optional(),
    index: z.boolean(),
    inSitemap: z.boolean(),
  }),
});

export const sitePageIndexSchema = z
  .array(
    z.strictObject({
      id: z.string().regex(/^[a-f0-9]{12}$/),
      slug: z.string().max(80),
      title: z.string().max(PAGE_LIMITS.pageTitle),
      kind: z.enum(PAGE_KINDS),
      status: z.enum(PAGE_STATUSES),
      updatedAt: z.string().max(40),
      updatedBy: z.string().max(120),
    }),
  )
  .max(PAGE_LIMITS.maxPages);

/** Depodan okunan içerik (geçersizse null; site bozuk kayıtla çizilmez). */
export function parseSitePageContent(value: unknown): SitePageContent | null {
  const r = sitePageContentSchema.safeParse(value);
  return r.success ? (r.data as SitePageContent) : null;
}

export function parseSitePageIndex(value: unknown): SitePageIndexEntry[] {
  return parseSitePageIndexStrict(value) ?? [];
}

/** Sıkı sürüm: geçersiz liste null (yazmalar bozuk listeyi "boş" sanıp ezmesin). */
export function parseSitePageIndexStrict(value: unknown): SitePageIndexEntry[] | null {
  const r = sitePageIndexSchema.safeParse(value);
  return r.success ? (r.data as SitePageIndexEntry[]) : null;
}

/** İç bağlantı denetimi: menü doğrulayıcısı + diğer özel sayfaların yolları ("/hakkimizda"). */
export function checkPageHref(raw: string, extraPaths: readonly string[] = []): { ok: true; warn?: string } | { ok: false; message: string } {
  const r = checkHref(raw);
  if (r.ok) return { ok: true, warn: r.warn };
  const v = raw.trim();
  if (v.startsWith("/") && !v.startsWith("//")) {
    const path = v.replace(/[?#].*$/, "").replace(/\/+$/, "");
    if (extraPaths.includes(path) && !/[\s\\<>"'`]/.test(v) && !v.includes("#")) return { ok: true };
  }
  return r;
}

const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Tüm metin alanları (yol, değer, bağlantı mı). Saf. */
function collect(node: unknown, path: string, out: Array<{ path: string; value: string; link: boolean }>) {
  if (typeof node === "string") {
    const key = path.split(".").pop() ?? "";
    if (key === "type" || key === "icon") return;
    out.push({ path, value: node, link: key === "href" });
  } else if (Array.isArray(node)) node.forEach((v, i) => collect(v, `${path}.${i}`, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) collect(v, path ? `${path}.${k}` : k, out);
}

/**
 * Tam doğrulama: şema hataları, bağlantılar, denetim karakteri, boyut sınırı (hata); riskli kelime ve SEO uzunluk
 * önerileri (uyarı). `extraPaths`: iç bağlantı sayılan diğer özel sayfa yolları.
 */
export function validateSitePage(input: unknown, opts: { extraPaths?: readonly string[] } = {}): { page: SitePageContent | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const parsed = sitePageContentSchema.safeParse(input);
  if (!parsed.success) {
    for (const i of parsed.error.issues) issues.push({ level: "error", path: i.path.join("."), message: i.message });
    return { page: null, issues };
  }
  const page = parsed.data as SitePageContent;
  const strings: Array<{ path: string; value: string; link: boolean }> = [];
  collect(page, "", strings);
  for (const s of strings) {
    if (CONTROL_RE.test(s.value)) issues.push({ level: "error", path: s.path, message: "Görünmez denetim karakteri var; metni yeniden yazın." });
    if (s.link) {
      const r = checkPageHref(s.value, opts.extraPaths);
      if (!r.ok) issues.push({ level: "error", path: s.path, message: r.message });
      else if (r.warn) issues.push({ level: "warn", path: s.path, message: r.warn });
      continue;
    }
    if (/<\s*\/?\s*[a-z!]/i.test(s.value)) issues.push({ level: "warn", path: s.path, message: "HTML etiketi işlenmez; metin olduğu gibi (düz yazı) görünür." });
    const risky = riskyWordsIn(s.value);
    if (risky.length) issues.push({ level: "warn", path: s.path, message: `Riskli ifade: ${risky.join(", ")}. Kanıtlanabilir değilse yumuşatın.` });
  }
  if (page.blocks.filter((b) => b.type === "hero").length > 1) issues.push({ level: "warn", path: "blocks", message: "Birden fazla giriş bloğu var; sayfada tek ana başlık (h1) önerilir." });
  if (!page.seo.title) issues.push({ level: "warn", path: "seo.title", message: "SEO başlığı boş; sayfa adı kullanılır." });
  if (!page.seo.description) issues.push({ level: "warn", path: "seo.description", message: "SEO açıklaması boş; arama sonuçlarında rastgele metin görünebilir." });
  if (!page.seo.index && page.seo.inSitemap) issues.push({ level: "warn", path: "seo.inSitemap", message: "İndekslenmeyen sayfa sitemap'e girmez." });
  const bytes = new TextEncoder().encode(JSON.stringify(page)).length;
  if (bytes > PAGE_LIMITS.pageBytes) issues.push({ level: "error", path: "", message: `Sayfa çok büyük (${Math.round(bytes / 1024)} KB); en çok ${PAGE_LIMITS.pageBytes / 1024} KB.` });
  return { page, issues };
}
