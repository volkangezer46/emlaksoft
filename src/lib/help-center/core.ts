import { GLOSSARY, GUIDES, type GlossaryEntry, type Guide } from "@/lib/help-content";
import { FAQ, FAQ_CATEGORIES, type FaqCategory, type FaqItem } from "@/lib/help-faq";

/**
 * YARDIM MERKEZİ CMS — SAF çekirdek (G/Ç yok; testli).
 *
 * Kaynaklar: koddaki içerik (help-content.ts GUIDES/GLOSSARY, help-faq.ts FAQ) TABAN; `help_articles` (migration
 * 20261013005100) yayındaki satırları aynı tür + slug ile kodu GEÇERSİZ KILAR, `hidden` satırı kod maddesini gizler,
 * yeni slug eklenir (sort sırasıyla, kodun ardından). Taslak satırlar ve yayındaki satırın bekleyen `draft`'ı
 * okuyuculara ASLA gitmez. /app/yardim, AI SSS bağlamı (faq-context.ts) ve admin önizlemesi bu birleşimi kullanır.
 */
export type HelpKind = "guide" | "faq" | "glossary";
export const HELP_KINDS: readonly { id: HelpKind; label: string }[] = [
  { id: "guide", label: "Rehber" },
  { id: "faq", label: "SSS" },
  { id: "glossary", label: "Sözlük" },
];

export function isHelpKind(v: unknown): v is HelpKind {
  return v === "guide" || v === "faq" || v === "glossary";
}

export type HelpStatus = "draft" | "published" | "hidden";

export type HelpDraft = {
  title: string;
  summary: string;
  body: string;
  category: string | null;
  href: string | null;
  hrefLabel: string | null;
};

export type HelpArticleRow = HelpDraft & {
  id: string;
  kind: HelpKind;
  slug: string;
  status: HelpStatus;
  sort: number;
  draft: HelpDraft | null;
  publishedAt: string | null;
  updatedAt: string;
};

export type HelpContent = { guides: Guide[]; faq: FaqItem[]; glossary: GlossaryEntry[] };

export const HELP_LIMITS = { titleMax: 200, summaryMax: 1000, bodyMax: 20_000, hrefLabelMax: 80 } as const;
export const HELP_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,79}$/;
/** İç bağlantı: yalnız site içi yol (açık yönlendirme yok; "//" ve tarayıcının "/" saydığı ters eğik çizgi yasak). */
export const HELP_HREF_RE = /^\/(?![\/\\])[^\s\\]*$/;

const FAQ_CATS = new Set<string>(FAQ_CATEGORIES.map((c) => c.id));

export function isFaqCategory(v: unknown): v is FaqCategory {
  return typeof v === "string" && FAQ_CATS.has(v);
}

/** Rehber adımları: her dolu satır bir adım; baştaki "1." / "-" işaretleri atılır. */
export function stepsFromBody(body: string): string[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*])\s+/, "").trim())
    .filter(Boolean);
}

/** Yayındaki birleşik içerikte (kod + yayındaki DB, gizlenenler hariç) makale var mı? Oy yazımı öncesi denetim. */
export function helpArticleExists(content: HelpContent, kind: HelpKind, slug: string): boolean {
  if (kind === "guide") return content.guides.some((g) => g.slug === slug);
  if (kind === "faq") return content.faq.some((f) => f.id === slug);
  return content.glossary.some((g) => g.slug === slug);
}

export function rowToGuide(r: HelpDraft & { slug: string }): Guide {
  return { slug: r.slug, title: r.title, intro: r.summary, steps: stepsFromBody(r.body), href: r.href ?? "/app/yardim", cta: r.hrefLabel ?? "Sayfaya git" };
}

export function rowToFaq(r: HelpDraft & { slug: string }): FaqItem {
  return {
    id: r.slug,
    category: isFaqCategory(r.category) ? r.category : "baslangic",
    q: r.title,
    a: r.body || r.summary,
    ...(r.href ? { href: r.href, hrefLabel: r.hrefLabel ?? undefined } : {}),
  };
}

export function rowToGlossary(r: HelpDraft & { slug: string }): GlossaryEntry {
  return {
    slug: r.slug,
    term: r.title,
    short: r.summary || r.body,
    ...(r.body && r.summary ? { detail: r.body } : {}),
    ...(r.href ? { href: r.href, hrefLabel: r.hrefLabel ?? undefined } : {}),
  };
}

/** Kod maddesini yazara düzenlenebilir taslak alanlarına çevirir ("koddan düzenle"). */
export function codeDraft(kind: HelpKind, slug: string): HelpDraft | null {
  if (kind === "guide") {
    const g = GUIDES.find((x) => x.slug === slug);
    return g ? { title: g.title, summary: g.intro, body: g.steps.join("\n"), category: null, href: g.href, hrefLabel: g.cta } : null;
  }
  if (kind === "faq") {
    const f = FAQ.find((x) => x.id === slug);
    return f ? { title: f.q, summary: "", body: f.a, category: f.category, href: f.href ?? null, hrefLabel: f.hrefLabel ?? null } : null;
  }
  const g = GLOSSARY.find((x) => x.slug === slug);
  return g ? { title: g.term, summary: g.short, body: g.detail ?? "", category: null, href: g.href ?? null, hrefLabel: g.hrefLabel ?? null } : null;
}

export function codeSlugs(kind: HelpKind): string[] {
  if (kind === "guide") return GUIDES.map((g) => g.slug);
  if (kind === "faq") return FAQ.map((f) => f.id);
  return GLOSSARY.map((g) => g.slug);
}

function mergeKind<T>(
  code: readonly T[],
  codeSlug: (t: T) => string,
  rows: readonly HelpArticleRow[],
  kind: HelpKind,
  toItem: (r: HelpArticleRow) => T,
): T[] {
  const mine = rows.filter((r) => r.kind === kind && (r.status === "published" || r.status === "hidden"));
  const bySlug = new Map(mine.map((r) => [r.slug, r]));
  const out: T[] = [];
  for (const c of code) {
    const r = bySlug.get(codeSlug(c));
    if (!r) out.push(c);
    else if (r.status === "published") out.push(toItem(r));
    // hidden: kod maddesi gizlenir
  }
  const codeSet = new Set(code.map(codeSlug));
  const extra = mine.filter((r) => r.status === "published" && !codeSet.has(r.slug)).sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title, "tr"));
  for (const r of extra) out.push(toItem(r));
  return out;
}

/** Okuyuculara giden birleşik içerik (yalnız yayındaki DB satırları; taslaklar yok). */
export function mergeHelpContent(rows: readonly HelpArticleRow[]): HelpContent {
  return {
    guides: mergeKind(GUIDES, (g) => g.slug, rows, "guide", rowToGuide),
    faq: mergeKind(FAQ, (f) => f.id, rows, "faq", rowToFaq),
    glossary: mergeKind(GLOSSARY, (g) => g.slug, rows, "glossary", rowToGlossary),
  };
}

/** Yazar girdisi doğrulama (eylem + test). Hata metni Türkçe. */
export function validateHelpDraft(kind: HelpKind, d: HelpDraft): string | null {
  if (!d.title.trim()) return "Başlık zorunlu.";
  if (d.title.length > HELP_LIMITS.titleMax) return `Başlık en çok ${HELP_LIMITS.titleMax} karakter.`;
  if (d.summary.length > HELP_LIMITS.summaryMax) return `Özet en çok ${HELP_LIMITS.summaryMax} karakter.`;
  if (d.body.length > HELP_LIMITS.bodyMax) return `Metin en çok ${HELP_LIMITS.bodyMax} karakter.`;
  if (d.href && !HELP_HREF_RE.test(d.href)) return "Bağlantı site içi bir yol olmalı (ör. /app/musteriler).";
  if (d.hrefLabel && d.hrefLabel.length > HELP_LIMITS.hrefLabelMax) return `Bağlantı adı en çok ${HELP_LIMITS.hrefLabelMax} karakter.`;
  if (kind === "guide" && stepsFromBody(d.body).length === 0) return "Rehberde en az bir adım olmalı (her satır bir adım).";
  if (kind === "faq" && !d.body.trim()) return "SSS yanıtı zorunlu.";
  if (kind === "faq" && d.category && !isFaqCategory(d.category)) return "Geçersiz SSS kategorisi.";
  if (kind === "glossary" && !d.summary.trim() && !d.body.trim()) return "Sözlük maddesinde kısa açıklama zorunlu.";
  return null;
}

/** Türkçe başlıktan slug önerisi. */
export function slugify(title: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
  return title
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşü]/g, (c) => map[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

/** Rehbere derin bağlantı (Rehberler sekmesi + çapa). Uygulama içi "kılavuzu aç" bağlantıları bunu kullanır. */
export function helpGuideHref(slug: string): string {
  return `/app/yardim?sekme=rehberler#${slug}`;
}

/** SSS maddesine derin bağlantı (SSS sekmesi + çapa). */
export function helpFaqHref(id: string): string {
  return `/app/yardim?sekme=sss#${id}`;
}

/** Kod içi EİDS içeriği (rehber + SSS); slug'lar CMS'te aynı anahtarla düzenlenir. */
export { EIDS_FAQ, EIDS_GUIDE, EIDS_HELP_SLUG } from "./eids";

export type VoteTally = { helpful: number; notHelpful: number };
export const voteKey = (kind: HelpKind, slug: string) => `${kind}:${slug}`;
