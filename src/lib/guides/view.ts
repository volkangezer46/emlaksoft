import type { ExtraMetadata } from "@/lib/seo/metadata";
import { canonicalUrl } from "@/lib/seo/rules";
import { embeddedTools, excerptOf, type ToolEmbedSlug } from "@/lib/rich-text/core";
import { GUIDE_CATEGORY_DESCRIPTION, GUIDE_CATEGORY_LABEL, guideCategoryPath, guidePath, type GuideCategory, type GuideContent, type GuideIndexEntry } from "./defaults";
import { isThinGuide } from "./schema";

/**
 * Rehber sayfa çevirileri (SAF). Metadata `buildMetadata(path, extra)` ile üretilir (registry girişi S5 dikişinde
 * gelene dek parametreler buradan doğrudan verilir); /admin/seo'da aynı yol için override varsa o kazanır.
 */

export const GUIDE_HUB_TITLE = "Emlak ofisi rehberi";
export const GUIDE_HUB_DESCRIPTION =
  "Emlak ofisleri için uygulamalı rehberler: ofis yönetimi, satış ve pazarlama, mevzuat ve KVKK, komisyon ve vergi hesapları.";

/** SEO başlığı (boşsa yazı başlığı) ve açıklaması (boşsa ilk paragraftan özet). */
export function guideSeoText(content: GuideContent): { title: string; description: string } {
  return {
    title: content.seo.title || content.title,
    description: content.seo.description || excerptOf(content.body, 155),
  };
}

/** Yazı metadata girdisi: canonical = taban + /rehber/<slug>; ince içerik noindex. */
export function guideExtraMetadata(base: string, slug: string, content: GuideContent): ExtraMetadata {
  const { title, description } = guideSeoText(content);
  return {
    title,
    description: description || undefined,
    canonical: canonicalUrl(base, guidePath(slug)),
    ogTitle: title,
    ...(isThinGuide(content) ? { noindex: true } : {}),
  };
}

/** /rehber: yayında indekslenebilir yazı yoksa noindex ("Yakında"). */
export function guideHubMetadata(base: string, indexableCount: number): ExtraMetadata {
  return {
    title: GUIDE_HUB_TITLE,
    description: GUIDE_HUB_DESCRIPTION,
    canonical: canonicalUrl(base, "/rehber"),
    ...(indexableCount === 0 ? { noindex: true } : {}),
  };
}

/** Kategori sayfası: indekslenebilir yazı yoksa noindex. */
export function guideCategoryMetadata(base: string, k: GuideCategory, indexableCount: number): ExtraMetadata {
  return {
    title: `${GUIDE_CATEGORY_LABEL[k]} rehberleri`,
    description: GUIDE_CATEGORY_DESCRIPTION[k],
    canonical: canonicalUrl(base, guideCategoryPath(k)),
    ...(indexableCount === 0 ? { noindex: true } : {}),
  };
}

/** İlgili yazılar: önce aynı kategori, sonra en yeniler (kendisi hariç). Saf. */
export function relatedGuides<T extends { entry: Pick<GuideIndexEntry, "id" | "category"> }>(all: readonly T[], current: Pick<GuideIndexEntry, "id" | "category">, max = 3): T[] {
  const others = all.filter((g) => g.entry.id !== current.id);
  const same = others.filter((g) => g.entry.category === current.category);
  const rest = others.filter((g) => g.entry.category !== current.category);
  return [...same, ...rest].slice(0, max);
}

/** İlgili araçlar: elle seçilenler + gövdedeki araç kartları (tekrarsız). */
export function relatedToolSlugs(content: GuideContent): ToolEmbedSlug[] {
  const out: ToolEmbedSlug[] = [...content.relatedTools];
  for (const s of embeddedTools(content.body)) if (!out.includes(s)) out.push(s);
  return out;
}

/** "13 Ekim 2026" (Türkiye saati). */
export function formatGuideDate(isoValue: string | null): string {
  if (!isoValue) return "";
  const t = Date.parse(isoValue);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(t);
}
