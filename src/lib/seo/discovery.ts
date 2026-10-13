import type { Finding, PageFacts } from "./audit-rules";
import { isOutOfScope, normalizePath } from "./scope";

/**
 * KEŞİF TARAMASI kuralları (SAF). Robot artık yalnız sitemap'i değil, ana sayfa ve sitemap sayfalarındaki iç
 * bağlantılarla en çok 2 seviye ilerler; sitemap'te olmayan ama indekslenebilir sayfaları bu yolla bulur.
 *
 * GÜVENLİK (G3): yalnız `new URL(href, sayfa).origin === SITE_ORIGIN` olan bağlantılar izlenir. Başka alan adı, başka
 * şema/port, özel ağ adresi (127.0.0.1, 10.x, 169.254.x...) ya da kimlik bilgisi taşıyan adres ASLA izlenmez. Sorgu
 * ve parça atılır. Kapsam dışı yollar (portallar, /app, /admin, /giris, /kayit/tamamla, /auth...) izlenmez.
 */

const FILE_RE = /\.(png|jpe?g|webp|avif|gif|svg|ico|css|js|mjs|map|woff2?|ttf|pdf|zip|xml|txt|json|webmanifest|mp4|webm|mp3)$/i;

/** İzlenebilir iç bağlantı: aynı köken, kapsam içi, dosya değil. Döner: sorgusuz/parçasız mutlak adres ya da null. */
export function followableUrl(href: string, pageUrl: string, siteOrigin: string): string | null {
  const raw = href.trim();
  if (!raw || /^(mailto:|tel:|javascript:|data:|sms:|whatsapp:|#)/i.test(raw)) return null;
  let u: URL;
  let site: URL;
  try {
    u = new URL(raw, pageUrl);
    site = new URL(siteOrigin);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.origin !== site.origin) return null;
  if (u.username || u.password) return null;
  const path = u.pathname || "/";
  if (path.startsWith("/_next") || FILE_RE.test(path)) return null;
  if (isOutOfScope(path)) return null;
  u.hash = "";
  u.search = "";
  return u.toString();
}

/** Karşılaştırma anahtarı: sondaki "/" farkı aynı sayfa sayılır. */
export const urlKey = (url: string): string => {
  try {
    const u = new URL(url);
    return `${u.origin}${normalizePath(u.pathname)}`;
  } catch {
    return url;
  }
};

/**
 * Bir sonraki keşif katmanı: taranmış sayfaların bağlantılarından henüz bilinmeyen adresler. Sayfa başına en çok
 * `perPage` yeni aday, toplam en çok `budget` (maxPages kalan payı). Sıra deterministiktir (sayfa sırası, bağlantı sırası).
 */
export function nextFrontier(
  pages: readonly Pick<PageFacts, "url" | "status" | "links">[],
  known: ReadonlySet<string>,
  siteOrigin: string,
  limits: { perPage: number; budget: number },
): string[] {
  const out: string[] = [];
  const seen = new Set<string>(known);
  for (const p of pages) {
    if (p.status < 200 || p.status >= 300) continue;
    let taken = 0;
    for (const href of p.links) {
      if (out.length >= limits.budget) return out;
      if (taken >= limits.perPage) break;
      const target = followableUrl(href, p.url, siteOrigin);
      if (!target) continue;
      const key = urlKey(target);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(target);
      taken += 1;
    }
  }
  return out;
}

/** Hedef → bağlantı veren sayfalar (yalnız izlenebilir iç bağlantılar; anahtar `urlKey`). */
export function inboundLinks(pages: readonly Pick<PageFacts, "url" | "status" | "links">[], siteOrigin: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const p of pages) {
    if (p.status < 200 || p.status >= 300) continue;
    for (const href of p.links) {
      const target = followableUrl(href, p.url, siteOrigin);
      if (!target) continue;
      const key = urlKey(target);
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(p.url);
    }
  }
  return map;
}

function canonicalPointsElsewhere(f: PageFacts): boolean {
  if (!f.canonical) return false;
  try {
    return urlKey(new URL(f.canonical, f.url).toString()) !== urlKey(f.url);
  } catch {
    return false;
  }
}

/**
 * Keşif bulguları:
 *  - `indexable-not-in-sitemap` (kritik): keşifle bulunan, 200 dönen, noindex olmayan, canonical'ı kendisi olan sayfa
 *    sitemap'te yok (arama motoru bu sayfayı sitemap'ten öğrenemez; sayfa ya sitemap'e girmeli ya noindex olmalı).
 *  - `noindex-linked-from-index` (bilgi): noindex sayfaya indekslenebilir bir sayfadan bağlantı veriliyor.
 */
export function discoveryFindings(input: {
  pages: readonly PageFacts[];
  sitemapKeys: ReadonlySet<string>;
  inbound: ReadonlyMap<string, ReadonlySet<string>>;
}): Finding[] {
  const out: Finding[] = [];
  const byKey = new Map(input.pages.map((p) => [urlKey(p.url), p] as const));
  for (const p of input.pages) {
    if (p.status < 200 || p.status >= 300) continue;
    const key = urlKey(p.url);
    if (!p.noindex && !input.sitemapKeys.has(key) && !canonicalPointsElsewhere(p)) {
      out.push({
        code: "indexable-not-in-sitemap",
        severity: "critical",
        url: p.url,
        message: "İndekslenebilir sayfa sitemap'te yok (robot iç bağlantıdan buldu).",
        fix: "Sayfayı sitemap kapsamına alın ya da arama motorlarından gizleyin (noindex).",
      });
    }
    if (p.noindex) {
      const from = [...(input.inbound.get(key) ?? [])].filter((src) => {
        const s = byKey.get(urlKey(src));
        return s && !s.noindex && s.status >= 200 && s.status < 300;
      });
      if (from.length > 0) {
        out.push({
          code: "noindex-linked-from-index",
          severity: "info",
          url: p.url,
          message: `noindex sayfaya ${from.length} indekslenebilir sayfadan bağlantı var.`,
          fix: "Bağlantı bilerek veriliyorsa sorun yok; sayfa aranmalıysa noindex'i kaldırın.",
        });
      }
    }
  }
  return out;
}
