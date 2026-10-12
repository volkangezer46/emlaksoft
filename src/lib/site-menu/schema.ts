import { z } from "zod";
import { FEATURED_PREVIEWS, FEATURED_RATIOS, LIMITS, MEDIA_KINDS, checkHref, type Issue, type MediaInfo, type MediaKind, type ValidationContext } from "./schema-core";
export * from "./schema-core";
import { isMenuIconName } from "./icon-registry";

/**
 * Site menüsü yapılandırması (üst menü + alt bilgi + duyuru şeridi): tür, sınırlar ve doğrulama.
 * Saf modül (sunucu ve istemci ortak): admin editörü canlı hata gösterir, sunucu aynı kuralla yeniden doğrular.
 */

const idRe = /^[a-z0-9][a-z0-9-]{0,39}$/;
const mediaIdRe = /^[a-f0-9]{12}$/;

const id = z.string().regex(idRe, "Geçersiz kimlik.");
const mediaId = z.string().regex(mediaIdRe, "Geçersiz medya kimliği.");

const iconRef = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({ kind: z.literal("lucide"), name: z.string().max(40) }),
  z.strictObject({ kind: z.literal("media"), mediaId }),
]);

const text = (max: number, msg: string) => z.string().trim().max(max, `${msg} en fazla ${max} karakter olabilir.`);

const itemSchema = z.strictObject({
  id,
  /** Panelde sütun başlığı; aynı başlıklı bağlantılar bir sütunda toplanır (boş: başlıksız sütun). */
  section: text(LIMITS.sectionTitle, "Sütun başlığı"),
  label: text(LIMITS.itemLabel, "Başlık"),
  text: text(LIMITS.itemText, "Açıklama"),
  href: z.string().trim().max(LIMITS.href, "Bağlantı çok uzun."),
  icon: iconRef,
  badge: z.enum(["yeni", "populer"]).nullable(),
  hidden: z.boolean(),
});

/** Öne çıkan kartta medya yokken gösterilen animasyonlu mini ürün önizlemesi (isteğe bağlı; eski yapılandırmalarda yok). */
const featuredSchema = z.strictObject({
  eyebrow: text(LIMITS.featuredEyebrow, "Üst başlık"),
  icon: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("none") }), z.strictObject({ kind: z.literal("lucide"), name: z.string().max(40) })]),
  title: text(LIMITS.featuredTitle, "Kart başlığı"),
  text: text(LIMITS.featuredText, "Kart açıklaması"),
  ctaLabel: text(LIMITS.featuredCta, "Düğme metni"),
  href: z.string().trim().max(LIMITS.href, "Bağlantı çok uzun."),
  hidden: z.boolean(),
  preview: z.enum(FEATURED_PREVIEWS).nullable().optional(),
  media: z
    .strictObject({
      mediaId,
      kind: z.enum(MEDIA_KINDS),
      posterId: mediaId.nullable(),
      ratio: z.enum(FEATURED_RATIOS),
      alt: text(LIMITS.featuredAlt, "Görsel açıklaması"),
    })
    .nullable(),
});

const groupSchema = z.strictObject({
  id,
  kind: z.enum(["menu", "link"]),
  label: text(LIMITS.groupLabel, "Grup adı"),
  href: z.string().trim().max(LIMITS.href, "Bağlantı çok uzun."),
  hidden: z.boolean(),
  items: z.array(itemSchema).max(LIMITS.maxItemsPerGroup, `Bir grupta en fazla ${LIMITS.maxItemsPerGroup} bağlantı olabilir.`),
  featured: featuredSchema.nullable(),
});

const footerLinkSchema = z.strictObject({
  id,
  label: text(LIMITS.footerLabel, "Bağlantı adı"),
  href: z.string().trim().max(LIMITS.href, "Bağlantı çok uzun."),
  hidden: z.boolean(),
});

const footerColumnSchema = z.strictObject({
  id,
  title: text(LIMITS.footerTitle, "Sütun başlığı"),
  hidden: z.boolean(),
  /** Açıksa etkin paket tanımlarından üretilen paket bağlantıları sütunun başına otomatik eklenir. */
  autoPlans: z.boolean(),
  links: z.array(footerLinkSchema).max(LIMITS.maxFooterLinksPerColumn, `Bir sütunda en fazla ${LIMITS.maxFooterLinksPerColumn} bağlantı olabilir.`),
});

const announcementSchema = z.strictObject({
  enabled: z.boolean(),
  /** Metin değişince kapatma hatırası sıfırlansın diye her kayıtta yenilenen anahtar. */
  key: z.string().regex(/^[a-z0-9]{1,16}$/),
  text: text(LIMITS.announcementText, "Duyuru metni"),
  href: z.string().trim().max(LIMITS.href, "Bağlantı çok uzun."),
  linkLabel: text(LIMITS.announcementLinkLabel, "Bağlantı metni"),
  /** `YYYY-MM-DD` (Türkiye saatiyle o günün sonuna kadar gösterilir) veya boş. */
  endsOn: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Bitiş tarihi YYYY-AA-GG olmalı."),
  dismissible: z.boolean(),
});

export const siteMenuSchema = z.strictObject({
  v: z.literal(1),
  groups: z.array(groupSchema).max(LIMITS.maxGroups, `En fazla ${LIMITS.maxGroups} üst grup olabilir.`),
  footer: z.array(footerColumnSchema).max(LIMITS.maxFooterColumns, `En fazla ${LIMITS.maxFooterColumns} alt bilgi sütunu olabilir.`),
  announcement: announcementSchema,
});

export type SiteMenuConfig = z.infer<typeof siteMenuSchema>;
export type MenuGroup = z.infer<typeof groupSchema>;
export type MenuItem = z.infer<typeof itemSchema>;
export type MenuFeatured = z.infer<typeof featuredSchema>;
export type IconRef = z.infer<typeof iconRef>;
export type FooterColumn = z.infer<typeof footerColumnSchema>;
export type FooterLink = z.infer<typeof footerLinkSchema>;
export type Announcement = z.infer<typeof announcementSchema>;

// ---------------------------------------------------------------------------
// Bağlantı doğrulaması
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Anlamsal doğrulama
// ---------------------------------------------------------------------------

const STATIC_KINDS: MediaKind[] = ["image"];

function hrefIssues(raw: string, path: string, out: Issue[]) {
  const r = checkHref(raw);
  if (!r.ok) out.push({ level: "error", path, message: r.message });
  else if (r.warn) out.push({ level: "warn", path, message: r.warn });
}

function normalizedTarget(href: string): string {
  return href.trim().toLowerCase().replace(/\/+$/, "") || "/";
}

export function validateSiteMenu(input: unknown, ctx: ValidationContext = { media: [] }): { config: SiteMenuConfig | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const parsed = siteMenuSchema.safeParse(input);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      issues.push({ level: "error", path: i.path.join("."), message: i.message });
    }
    return { config: null, issues };
  }
  const cfg = parsed.data;
  const media = new Map(ctx.media.map((m) => [m.id, m]));

  if (new TextEncoder().encode(JSON.stringify(cfg)).length > LIMITS.jsonBytes) {
    issues.push({ level: "error", path: "", message: "Menü yapılandırması çok büyük; bazı öğeleri azaltın." });
  }

  // Kimlikler kendi alanında benzersizdir: menü (grup + bağlantı) ve alt bilgi (sütun + bağlantı) ayrı.
  const seen = new Set<string>();
  const dupId = (value: string, path: string) => {
    const scoped = `${path.startsWith("footer") ? "f" : "m"}:${value}`;
    if (seen.has(scoped)) issues.push({ level: "error", path, message: "Kimlik yinelendi; sayfayı yenileyip tekrar deneyin." });
    seen.add(scoped);
  };

  let totalItems = 0;
  const mediaRef = (mid: string, path: string, allow: (m: MediaInfo) => boolean, hint: string) => {
    const m = media.get(mid);
    if (!m) issues.push({ level: "error", path, message: "Medya dosyası bulunamadı; yeniden yükleyin." });
    else if (!allow(m)) issues.push({ level: "error", path, message: hint });
  };

  cfg.groups.forEach((g, gi) => {
    const gp = `groups.${gi}`;
    dupId(g.id, `${gp}.id`);
    if (!g.label) issues.push({ level: "error", path: `${gp}.label`, message: "Grup adı boş olamaz." });
    if (g.kind === "link") {
      hrefIssues(g.href, `${gp}.href`, issues);
      if (g.items.length || g.featured) issues.push({ level: "warn", path: gp, message: `"${g.label}" doğrudan bağlantı; alt öğeleri gösterilmez.` });
      return;
    }
    const visibleItems = g.items.filter((it) => !it.hidden);
    if (!g.hidden && visibleItems.length === 0 && !(g.featured && !g.featured.hidden)) {
      issues.push({ level: "warn", path: gp, message: `"${g.label || "Grup"}" menüsünde görünen öğe yok; grup boş açılır.` });
    }
    totalItems += g.items.length;
    const sections = new Set(g.items.map((it) => it.section.trim()));
    if (sections.size > LIMITS.maxSectionsPerGroup) {
      issues.push({ level: "error", path: gp, message: `Bir grupta en fazla ${LIMITS.maxSectionsPerGroup} farklı sütun başlığı olabilir.` });
    }
    const groupTargets = new Set<string>();
    g.items.forEach((it, ii) => {
      const ip = `${gp}.items.${ii}`;
      dupId(it.id, `${ip}.id`);
      if (!it.label) issues.push({ level: "error", path: `${ip}.label`, message: "Başlık boş olamaz." });
      hrefIssues(it.href, `${ip}.href`, issues);
      if (it.icon.kind === "lucide" && !isMenuIconName(it.icon.name)) {
        issues.push({ level: "error", path: `${ip}.icon`, message: "Seçilen ikon listede yok." });
      }
      if (it.icon.kind === "media") {
        mediaRef(it.icon.mediaId, `${ip}.icon`, (m) => m.kind === "image", "Logo yalnız SVG, PNG veya WebP (durağan) olabilir.");
      }
      if (!it.hidden) {
        const t = normalizedTarget(it.href);
        if (groupTargets.has(t)) issues.push({ level: "warn", path: `${ip}.href`, message: "Bu grupta aynı hedefe giden başka bir bağlantı var." });
        groupTargets.add(t);
      }
    });
    if (g.featured) {
      const f = g.featured;
      const fp = `${gp}.featured`;
      if (f.icon.kind === "lucide" && !isMenuIconName(f.icon.name)) issues.push({ level: "error", path: `${fp}.icon`, message: "Seçilen ikon listede yok." });
      if (!f.title) issues.push({ level: "error", path: `${fp}.title`, message: "Öne çıkan kart başlığı boş olamaz." });
      if (!f.ctaLabel) issues.push({ level: "error", path: `${fp}.ctaLabel`, message: "Düğme metni boş olamaz." });
      hrefIssues(f.href, `${fp}.href`, issues);
      if (f.media) {
        const m = f.media;
        mediaRef(m.mediaId, `${fp}.media`, (x) => x.kind === m.kind, "Medya türü kayıtla uyuşmuyor; yeniden yükleyin.");
        if (m.kind !== "image") {
          if (!m.posterId) issues.push({ level: "error", path: `${fp}.media.posterId`, message: "Animasyonlu görsel ve video için poster kare zorunlu." });
          else mediaRef(m.posterId, `${fp}.media.posterId`, (x) => STATIC_KINDS.includes(x.kind), "Poster durağan bir görsel (SVG, PNG, WebP) olmalı.");
        }
        if (!m.alt && !f.title) issues.push({ level: "warn", path: `${fp}.media.alt`, message: "Görsel açıklaması boş." });
      }
    }
  });
  if (totalItems > LIMITS.maxTotalItems) {
    issues.push({ level: "error", path: "groups", message: `Menüde en fazla ${LIMITS.maxTotalItems} bağlantı olabilir (şu an ${totalItems}).` });
  }
  if (!cfg.groups.some((g) => !g.hidden)) {
    issues.push({ level: "warn", path: "groups", message: "Hiç görünen menü grubu yok; üst menü boş kalır." });
  }

  let footerLinks = 0;
  cfg.footer.forEach((c, ci) => {
    const cp = `footer.${ci}`;
    dupId(c.id, `${cp}.id`);
    if (!c.title) issues.push({ level: "error", path: `${cp}.title`, message: "Sütun başlığı boş olamaz." });
    if (!c.hidden && !c.autoPlans && c.links.every((l) => l.hidden)) issues.push({ level: "warn", path: cp, message: `"${c.title || "Sütun"}" sütununda görünen bağlantı yok.` });
    footerLinks += c.links.length;
    const colTargets = new Set<string>();
    c.links.forEach((l, li) => {
      const lp = `${cp}.links.${li}`;
      dupId(l.id, `${lp}.id`);
      if (!l.label) issues.push({ level: "error", path: `${lp}.label`, message: "Bağlantı adı boş olamaz." });
      hrefIssues(l.href, `${lp}.href`, issues);
      if (!l.hidden) {
        const t = normalizedTarget(l.href);
        if (colTargets.has(t)) issues.push({ level: "warn", path: `${lp}.href`, message: "Bu sütunda aynı hedefe giden başka bir bağlantı var." });
        colTargets.add(t);
      }
    });
  });
  if (footerLinks > LIMITS.maxFooterLinks) {
    issues.push({ level: "error", path: "footer", message: `Alt bilgide en fazla ${LIMITS.maxFooterLinks} bağlantı olabilir (şu an ${footerLinks}).` });
  }

  const a = cfg.announcement;
  if (a.enabled) {
    if (!a.text) issues.push({ level: "error", path: "announcement.text", message: "Duyuru açıkken metin zorunlu." });
    if (a.href) {
      hrefIssues(a.href, "announcement.href", issues);
      if (!a.linkLabel) issues.push({ level: "error", path: "announcement.linkLabel", message: "Bağlantı varsa bağlantı metni de yazın." });
    }
    if (a.endsOn && Number.isNaN(Date.parse(`${a.endsOn}T00:00:00Z`))) {
      issues.push({ level: "error", path: "announcement.endsOn", message: "Bitiş tarihi geçerli değil." });
    }
  }

  return { config: cfg, issues };
}
