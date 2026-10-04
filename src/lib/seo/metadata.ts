import type { Metadata } from "next";
import { getSeoPage, type SeoPageDef } from "./registry";
import { effectiveOgImage } from "./rules";
import type { SeoGlobal, SeoPageOverride, SeoPages } from "./schema";

/**
 * Metadata çözümleyici (SAF — veritabanı yok). `buildMetadata` (store.ts'e bağlı) bunu sarar.
 *
 * Öncelik: admin override (seo.pages) > sayfa kaydı varsayılanı (registry.ts) > çağıranın `extra` değeri.
 * Admin ayarı yokken çıktı, sayfaların eski `metadata` sabitleriyle uyumludur (seo-metadata.test.ts).
 */

export type ExtraMetadata = {
  title?: string;
  /** true: şablon uygulanmaz (title.absolute). */
  titleAbsolute?: boolean;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  canonical?: string;
  /** Dinamik sayfalar için: noindex zorlaması. */
  noindex?: boolean;
};

/** Layout (kök) metadata'sı — ayarlardan; ayar yokken eski sabitlerle aynı. */
export function resolveRootMetadata(global: SeoGlobal): Metadata {
  const verification: NonNullable<Metadata["verification"]> = {};
  if (global.verification.google) verification.google = global.verification.google;
  if (global.verification.yandex) verification.yandex = global.verification.yandex;
  if (global.verification.bing) verification.other = { "msvalidate.01": global.verification.bing };

  return {
    title: { default: global.defaultTitle, template: global.titleTemplate },
    description: global.defaultDescription,
    applicationName: global.siteName,
    openGraph: {
      type: "website",
      locale: global.locale,
      siteName: global.siteName,
      title: global.defaultTitle,
      description: global.defaultDescription,
      url: "/",
      ...(global.ogImage ? { images: [{ url: global.ogImage }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: global.defaultTitle,
      description: global.defaultDescription,
      ...(global.twitterHandle ? { site: `@${global.twitterHandle}`, creator: `@${global.twitterHandle}` } : {}),
      ...(global.ogImage ? { images: [global.ogImage] } : {}),
    },
    ...(Object.keys(verification).length > 0 ? { verification } : {}),
  };
}

/** Bir sayfanın etkin robots kararı (kayıt varsayılanı + admin override; canIndex=false kilidi). */
export function effectiveIndexable(def: SeoPageDef | undefined, ov: SeoPageOverride | undefined, extra?: ExtraMetadata): boolean {
  if (extra?.noindex) return false;
  if (!def) return ov?.robotsIndex ?? true;
  if (!def.canIndex) return false;
  return ov?.robotsIndex ?? def.index;
}

/** Yönetim ekranı için bir sayfanın etkin (override uygulanmış) görünümü. */
export function effectivePageView(def: SeoPageDef, ov: SeoPageOverride | undefined, global: SeoGlobal) {
  const isHome = def.path === "/";
  const rawTitle = ov?.title ?? def.title;
  const renderedTitle = rawTitle ? (isHome && ov?.title ? rawTitle : global.titleTemplate.replace("%s", rawTitle)) : global.defaultTitle;
  return {
    renderedTitle,
    description: ov?.description ?? def.description ?? global.defaultDescription,
    canonical: ov?.canonical ?? def.path,
    ogImage: effectiveOgImage(global, ov?.ogImage),
    indexable: effectiveIndexable(def, ov),
    inSitemap: effectiveIndexable(def, ov) && (ov?.sitemapInclude ?? def.sitemap.include),
    customized: Boolean(ov),
  };
}

export function resolvePageMetadata(
  path: string,
  global: SeoGlobal,
  pages: SeoPages,
  extra: ExtraMetadata = {},
): Metadata {
  const def = getSeoPage(path);
  const ov = pages[path];

  const title = ov?.title ?? def?.title ?? extra.title ?? null;
  const description = ov?.description ?? def?.description ?? extra.description ?? null;
  const canonical = ov?.canonical ?? extra.canonical ?? path;
  const index = effectiveIndexable(def, ov, extra);
  const follow = ov?.robotsFollow ?? true;
  const isHome = path === "/";

  const absoluteTitle = Boolean(extra.titleAbsolute || (isHome && ov?.title));
  const renderedForSocial = title ? (absoluteTitle ? title : global.titleTemplate.replace("%s", title)) : global.defaultTitle;
  const ogTitle = ov?.ogTitle ?? def?.ogTitle ?? extra.ogTitle ?? renderedForSocial;
  const ogDescription = ov?.ogDescription ?? def?.ogDescription ?? extra.ogDescription ?? description ?? global.defaultDescription;
  const ogImage = effectiveOgImage(global, ov?.ogImage ?? extra.ogImage);

  const md: Metadata = {
    alternates: { canonical },
  };
  if (title) md.title = absoluteTitle ? { absolute: title } : title;
  if (description) md.description = description;

  if (!index || !follow) md.robots = { index, follow };

  // Ana sayfa: admin override yoksa kök (layout) OG/Twitter kullanılır.
  const homeUntouched = isHome && !ov?.ogTitle && !ov?.ogDescription && !ov?.ogImage && !ov?.title && !ov?.description;
  if (!homeUntouched) {
    md.openGraph = {
      type: "website",
      locale: global.locale,
      siteName: global.siteName,
      title: ogTitle,
      description: ogDescription,
      url: canonical,
      images: [{ url: ogImage }],
    };
    md.twitter = {
      card: "summary_large_image",
      title: ogTitle,
      description: ogDescription,
      ...(global.twitterHandle ? { site: `@${global.twitterHandle}` } : {}),
      images: [ogImage],
    };
  }
  return md;
}
