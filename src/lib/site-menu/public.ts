import { announcementKey, endOfDayTrMs, startOfDayTrMs, type AnnouncementTarget } from "./announcements";
import {
  DEFAULT_CTAS,
  checkHref,
  checkPageHref,
  isExternalHref,
  type CtaKey,
  type CtaLink,
  type FeaturedPreviewKind,
  type FeaturedRatio,
  type MediaKind,
  type SiteCtas,
} from "./schema-core";
import type { IconRef, SiteMenuConfig } from "./schema";

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

/**
 * Yayındaki duyuru adayı. `id` kapatma anahtarıdır (kimlik + içerik özeti); seçim `pickAnnouncement` ile yol ve
 * Türkiye gününe göre yapılır (sunucu çizimi ve istemci aynı saf işlevi kullanır).
 */
export type PublicAnnouncement = AnnouncementTarget & {
  text: string;
  href: string;
  linkLabel: string;
  external: boolean;
  dismissible: boolean;
};

export type PublicSiteMenu = { groups: PublicGroup[]; footer: PublicFooterColumn[]; announcements: PublicAnnouncement[] };

export { endOfDayTrMs };

const ok = (href: string) => checkHref(href).ok;
const pageOk = (href: string) => checkPageHref(href).ok;

/** Duyuru adayları: metinsiz, süresi dolmuş ya da bağlantısı geçersiz olanlar ayıklanır; başlamamış olanlar kalır (istemci saatiyle açılır). */
export function toPublicAnnouncements(list: SiteMenuConfig["announcements"], nowMs: number): PublicAnnouncement[] {
  const out: PublicAnnouncement[] = [];
  for (const a of list) {
    if (!a.text) continue;
    const endsAtMs = endOfDayTrMs(a.endsOn);
    if (endsAtMs !== null && endsAtMs < nowMs) continue;
    const href = a.href && a.linkLabel && pageOk(a.href) ? a.href : "";
    out.push({
      id: announcementKey(a.id, [a.text, href, a.linkLabel, a.startsOn, a.endsOn]),
      text: a.text,
      href,
      linkLabel: href ? a.linkLabel : "",
      external: href ? isExternalHref(href) : false,
      dismissible: a.dismissible,
      startsAtMs: startOfDayTrMs(a.startsOn),
      endsAtMs,
      pathMode: a.pathMode,
      pathPrefix: a.pathPrefix,
      priority: a.priority,
    });
  }
  return out;
}

/** Dönüşüm düğmeleri: geçersiz/boş alan bugünkü varsayılana düşer (kırık düğme yayına çıkmaz). */
export function toPublicCtas(ctas: SiteMenuConfig["ctas"]): SiteCtas {
  const pick = (k: CtaKey): CtaLink => {
    const c = ctas[k];
    const d = DEFAULT_CTAS[k];
    return { label: c.label || d.label, href: pageOk(c.href) ? c.href : d.href };
  };
  return { login: pick("login"), trial: pick("trial"), mobileLogin: pick("mobileLogin"), mobileTrial: pick("mobileTrial") };
}

/** Varsayılandan farklıysa düğmeler, aynıysa null (istemci bileşenine gereksiz veri geçmez; çıktı bugünküyle aynı kalır). */
export function customCtas(ctas: SiteMenuConfig["ctas"]): SiteCtas | null {
  const pub = toPublicCtas(ctas);
  return JSON.stringify(pub) === JSON.stringify(DEFAULT_CTAS) ? null : pub;
}

/** `{yil}` değişkenli düz metni parçalara böler (çizimde yıl ayrı metin düğümü olur; bugünkü çıktıyla aynı). */
export function splitYear(template: string, year: number): Array<string | number> {
  const parts = template.split("{yil}");
  const out: Array<string | number> = [];
  parts.forEach((p, i) => {
    if (i > 0) out.push(year);
    if (p) out.push(p);
  });
  return out;
}

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

  return { groups, footer, announcements: toPublicAnnouncements(cfg.announcements, nowMs) };
}
