import { introDescription, resolveSeoPattern, type SeoPatternVars } from "@/lib/seo/patterns";
import type { SeoPatterns } from "@/lib/seo/schema";
import { VITRIN_SEO_DESCRIPTION_MAX, VITRIN_SEO_TITLE_MAX, normalizeSeoText } from "@/lib/vitrin-settings-logic";

/**
 * Ofis vitrini `<title>`/description kararı (SAF; vitrin sayfası generateMetadata ve test ortak).
 * Öncelik: ofisin elle yazdığı SEO metni (tenants.vitrin_seo_title / vitrin_seo_description) → (açıklama için) tanıtım
 * metni → yönetici SEO kalıbı (patterns.ts DEFAULT_SEO_PATTERNS). Elle metin boş/boşluksa yok sayılır; DB sınırını aşan
 * eski/bozuk değer sınırda kesilir (sayfa hiçbir zaman sınırsız metin basmaz).
 */
export function vitrinOfficeMeta(input: {
  seoTitle: string | null | undefined;
  seoDescription: string | null | undefined;
  intro: string | null | undefined;
  patterns: SeoPatterns | null | undefined;
  vars: SeoPatternVars;
}): { title: string; description: string } {
  const ownTitle = normalizeSeoText(input.seoTitle)?.slice(0, VITRIN_SEO_TITLE_MAX) ?? null;
  const ownDescription = normalizeSeoText(input.seoDescription)?.slice(0, VITRIN_SEO_DESCRIPTION_MAX) ?? null;
  return {
    title: ownTitle ?? resolveSeoPattern(input.patterns, "office", "title", input.vars),
    description: ownDescription ?? introDescription(input.intro) ?? resolveSeoPattern(input.patterns, "office", "description", input.vars),
  };
}
