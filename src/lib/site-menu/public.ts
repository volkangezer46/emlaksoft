import { checkHref, isExternalHref, type FeaturedPreviewKind, type FeaturedRatio, type IconRef, type MediaKind, type SiteMenuConfig } from "./schema";

/**
 * Yapılandırmadan herkese açık görünüme: gizlenenler, geçersiz bağlantılar ve süresi dolan duyuru ayıklanır;
 * istemciye yalnız gereken küçük JSON gider (ikonlar sunucuda çizilir, medya adresleri sabit boyutlu).
 */

export const MENU_ASSET_BASE = "/site-menu-asset";
export const menuAssetUrl = (id: string) => `${MENU_ASSET_BASE}/${id}`;

export type PublicItem = {
  id: string;
  label: string;
  text: string;
  href: string;
  external: boolean;
  badge: "yeni" | "populer" | null;
  icon: IconRef;
};

export type PublicFeatured = {
  eyebrow: string;
  icon: IconRef;
  title: string;
  text: string;
  ctaLabel: string;
  href: string;
  external: boolean;
  /** Medya yoksa gösterilen mini ürün önizlemesi (medya varsa o öncelikli). */
  preview: FeaturedPreviewKind | null;
  media: { kind: MediaKind; src: string; posterSrc: string | null; ratio: FeaturedRatio; alt: string } | null;
};

export type PublicGroup = {
  id: string;
  kind: "menu" | "link";
  label: string;
  href: string;
  external: boolean;
  /** Sütunlar: `section` başlığına göre gruplanmış bağlantılar (başlıksız bağlantılar tek sütunda). */
  columns: Array<{ title: string; items: PublicItem[] }>;
  featured: PublicFeatured | null;
};

export type PublicFooterColumn = { id: string; title: string; autoPlans: boolean; links: Array<{ id: string; label: string; href: string; external: boolean }> };

export type PublicAnnouncement = {
  key: string;
  text: string;
  href: string;
  linkLabel: string;
  external: boolean;
  dismissible: boolean;
  /** Bitiş anı (epoch ms) veya null; istemci de kontrol eder. */
  endsAtMs: number | null;
};

export type PublicSiteMenu = { groups: PublicGroup[]; footer: PublicFooterColumn[]; announcement: PublicAnnouncement | null };

/** `YYYY-MM-DD` gününün Türkiye saatiyle sonu (23:59:59). Geçersizse null. */
export function endOfDayTrMs(endsOn: string): number | null {
  if (!endsOn) return null;
  const t = Date.parse(`${endsOn}T23:59:59+03:00`);
  return Number.isNaN(t) ? null : t;
}

const ok = (href: string) => checkHref(href).ok;

export function toPublicMenu(cfg: SiteMenuConfig, nowMs: number): PublicSiteMenu {
  const groups: PublicGroup[] = [];
  for (const g of cfg.groups) {
    if (g.hidden) continue;
    if (g.kind === "link") {
      if (!ok(g.href)) continue;
      groups.push({ id: g.id, kind: "link", label: g.label, href: g.href, external: isExternalHref(g.href), columns: [], featured: null });
      continue;
    }
    const items: PublicItem[] = g.items
      .filter((it) => !it.hidden && it.label && ok(it.href))
      .map((it) => ({
        id: it.id,
        label: it.label,
        text: it.text,
        href: it.href,
        external: isExternalHref(it.href),
        badge: it.badge,
        icon: it.icon,
      }));
    const f = g.featured && !g.featured.hidden && g.featured.title && g.featured.ctaLabel && ok(g.featured.href) ? g.featured : null;
    if (items.length === 0 && !f) continue;
    const bySection = new Map<string, PublicItem[]>();
    g.items.forEach((it) => {
      const pub = items.find((x) => x.id === it.id);
      if (!pub) return;
      const key = (it.section ?? "").trim();
      bySection.set(key, [...(bySection.get(key) ?? []), pub]);
    });
    groups.push({
      id: g.id,
      kind: "menu",
      label: g.label,
      href: "",
      external: false,
      columns: [...bySection.entries()].map(([title, list]) => ({ title, items: list })),
      featured: f
        ? {
            eyebrow: f.eyebrow,
            icon: f.icon,
            title: f.title,
            text: f.text,
            ctaLabel: f.ctaLabel,
            href: f.href,
            external: isExternalHref(f.href),
            preview: f.preview ?? null,
            media: f.media
              ? {
                  kind: f.media.kind,
                  src: menuAssetUrl(f.media.mediaId),
                  posterSrc: f.media.posterId ? menuAssetUrl(f.media.posterId) : f.media.kind === "image" ? menuAssetUrl(f.media.mediaId) : null,
                  ratio: f.media.ratio,
                  alt: f.media.alt,
                }
              : null,
          }
        : null,
    });
  }

  const footer: PublicFooterColumn[] = [];
  for (const c of cfg.footer) {
    if (c.hidden) continue;
    const links = c.links.filter((l) => !l.hidden && l.label && ok(l.href)).map((l) => ({ id: l.id, label: l.label, href: l.href, external: isExternalHref(l.href) }));
    if (links.length || c.autoPlans) footer.push({ id: c.id, title: c.title, autoPlans: c.autoPlans, links });
  }

  const a = cfg.announcement;
  const endsAtMs = endOfDayTrMs(a.endsOn);
  const announcement: PublicAnnouncement | null =
    a.enabled && a.text && (endsAtMs === null || endsAtMs > nowMs)
      ? {
          key: a.key,
          text: a.text,
          href: a.href && ok(a.href) && a.linkLabel ? a.href : "",
          linkLabel: a.linkLabel,
          external: isExternalHref(a.href),
          dismissible: a.dismissible,
          endsAtMs,
        }
      : null;

  return { groups, footer, announcement };
}
