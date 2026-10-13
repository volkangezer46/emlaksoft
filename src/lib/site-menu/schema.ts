import { z } from "zod";
import {
  ANNOUNCEMENT_PATH_MODES,
  FEATURED_PREVIEWS,
  FEATURED_RATIOS,
  FOOTER_BADGE_ICONS,
  LIMITS,
  MEDIA_KINDS,
  checkHref,
  checkPageHref,
  type Issue,
  type MediaInfo,
  type MediaKind,
  type ValidationContext,
} from "./schema-core";
export * from "./schema-core";
import { startOfDayTrMs } from "./announcements";
import { defaultSiteMenu } from "./defaults";
import { isMenuIconName } from "./icon-registry";

/**
 * Site çerçevesi yapılandırması (üst menü, alt bilgi + marka bloğu, dönüşüm düğmeleri, duyurular, paylaşım kartı, 404):
 * tür, sınırlar ve doğrulama. Eski kayıtlar `upgradeSiteMenu` ile okunurken yükseltilir.
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

/** ESKİ tekil duyuru şeridi (yalnız yükseltme için okunur; yeni kayıtlar `announcements` listesini kullanır). */
type LegacyAnnouncement = { enabled?: unknown; text?: unknown; href?: unknown; linkLabel?: unknown; endsOn?: unknown; dismissible?: unknown };

const day = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Tarih YYYY-AA-GG olmalı.");
const hrefField = z.string().trim().max(LIMITS.href, "Bağlantı çok uzun.");

const announcementItemSchema = z.strictObject({
  id,
  text: text(LIMITS.announcementItemText, "Duyuru metni"),
  /** İsteğe bağlı bağlantı (boş: bağlantısız). Bağlantı varsa bağlantı metni zorunlu. */
  href: hrefField,
  linkLabel: text(LIMITS.announcementLinkLabel, "Bağlantı metni"),
  /** `YYYY-MM-DD` veya boş: Türkiye günüyle başlangıç (00:00) ve bitiş (23:59:59). */
  startsOn: day,
  endsOn: day,
  /** Yol hedefi: bütün site, yalnız ana sayfa ya da bir yol öneki (`/fiyatlar` → /fiyatlar ve altı). */
  pathMode: z.enum(ANNOUNCEMENT_PATH_MODES),
  pathPrefix: z.string().trim().max(LIMITS.pathPrefix, "Yol öneki çok uzun."),
  /** 1-9; aynı anda birden çok duyuru uyarsa en yüksek öncelikli TEK duyuru gösterilir. */
  priority: z.number().int().min(1, "Öncelik 1-9 olmalı.").max(9, "Öncelik 1-9 olmalı."),
  dismissible: z.boolean(),
});

const ctaLinkSchema = z.strictObject({ label: text(LIMITS.ctaLabel, "Düğme metni"), href: hrefField });

const footerBrandSchema = z.strictObject({
  description: text(LIMITS.footerDescription, "Marka açıklaması"),
  badges: z
    .array(z.strictObject({ label: text(LIMITS.footerBadge, "Rozet"), icon: z.enum(FOOTER_BADGE_ICONS) }))
    .max(LIMITS.maxFooterBadges, `En fazla ${LIMITS.maxFooterBadges} güven rozeti olabilir.`),
  cta: z.strictObject({ label: text(LIMITS.footerCta, "Düğme metni"), href: hrefField }),
  /** `{yil}` değişkeni Türkiye saatiyle bu yılla değişir. */
  copyright: text(LIMITS.copyright, "Telif satırı"),
  disclaimer: text(LIMITS.disclaimer, "Yasal not"),
  /** Açıksa sosyal ve iletişim satırı SEO kurum bilgisinden (sameAs, e-posta, telefon) gelir. */
  showContact: z.boolean(),
});

const ogCardSchema = z.strictObject({
  title: text(LIMITS.ogTitle, "Kart başlığı"),
  subtitle: text(LIMITS.ogSubtitle, "Kart alt başlığı"),
  chips: z.array(text(LIMITS.ogChip, "Rozet")).max(LIMITS.maxOgChips, `En fazla ${LIMITS.maxOgChips} rozet olabilir.`),
});

const notFoundSchema = z.strictObject({
  title: text(LIMITS.notFoundTitle, "Başlık"),
  text: text(LIMITS.notFoundText, "Açıklama"),
  links: z
    .array(z.strictObject({ label: text(LIMITS.notFoundLabel, "Bağlantı adı"), desc: text(LIMITS.notFoundDesc, "Kısa açıklama"), href: hrefField }))
    .max(LIMITS.maxNotFoundLinks, `En fazla ${LIMITS.maxNotFoundLinks} bağlantı olabilir.`),
});

const siteMenuObject = z.strictObject({
  v: z.literal(1),
  groups: z.array(groupSchema).max(LIMITS.maxGroups, `En fazla ${LIMITS.maxGroups} üst grup olabilir.`),
  footer: z.array(footerColumnSchema).max(LIMITS.maxFooterColumns, `En fazla ${LIMITS.maxFooterColumns} alt bilgi sütunu olabilir.`),
  footerBrand: footerBrandSchema,
  ctas: z.strictObject({ login: ctaLinkSchema, trial: ctaLinkSchema, mobileLogin: ctaLinkSchema, mobileTrial: ctaLinkSchema }),
  announcements: z.array(announcementItemSchema).max(LIMITS.maxAnnouncements, `En fazla ${LIMITS.maxAnnouncements} duyuru olabilir.`),
  ogCard: ogCardSchema,
  notFound: notFoundSchema,
});

/** Sonradan eklenen üst düzey alanlar: eski kayıtta yoksa varsayılandan (bugünkü sabit metin) gelir. */
const LATER_KEYS = ["footerBrand", "ctas", "ogCard", "notFound"] as const;

/** Eski tekil duyuruyu listeye çevirir (`id: "legacy"`); kapalı ya da metinsiz eski duyuru listeye girmez. */
export function legacyAnnouncementToList(a: LegacyAnnouncement | null | undefined): AnnouncementItem[] {
  if (!a || typeof a !== "object" || a.enabled !== true || typeof a.text !== "string" || !a.text.trim()) return [];
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return [
    {
      id: "legacy",
      text: a.text,
      href: str(a.href),
      linkLabel: str(a.linkLabel),
      startsOn: "",
      endsOn: str(a.endsOn),
      pathMode: "all",
      pathPrefix: "",
      priority: 5,
      dismissible: a.dismissible !== false,
    },
  ];
}

/**
 * Eski kayıtları (yayın, taslak, geçmiş) yükseltir: tekil `announcement` → `announcements`, eksik yeni alanlar
 * varsayılandan. Saf; girdiyi değiştirmez. Yükseltilmiş eski kayıt bugünkü çıktıyı birebir verir.
 */
export function upgradeSiteMenu(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  if (out.announcements === undefined) out.announcements = legacyAnnouncementToList(out.announcement as LegacyAnnouncement | undefined);
  delete out.announcement;
  let defaults: SiteMenuConfig | null = null;
  for (const k of LATER_KEYS) {
    if (out[k] === undefined) {
      defaults ??= defaultSiteMenu();
      out[k] = defaults[k];
    }
  }
  return out;
}

export const siteMenuSchema = z.preprocess(upgradeSiteMenu, siteMenuObject);

export type SiteMenuConfig = z.infer<typeof siteMenuObject>;
export type MenuGroup = z.infer<typeof groupSchema>;
export type MenuItem = z.infer<typeof itemSchema>;
export type MenuFeatured = z.infer<typeof featuredSchema>;
export type IconRef = z.infer<typeof iconRef>;
export type FooterColumn = z.infer<typeof footerColumnSchema>;
export type FooterLink = z.infer<typeof footerLinkSchema>;
export type AnnouncementItem = z.infer<typeof announcementItemSchema>;
export type FooterBrand = z.infer<typeof footerBrandSchema>;
export type OgCard = z.infer<typeof ogCardSchema>;
export type NotFoundContent = z.infer<typeof notFoundSchema>;

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

function pageHrefIssues(raw: string, path: string, out: Issue[]) {
  const r = checkPageHref(raw);
  if (!r.ok) out.push({ level: "error", path, message: r.message });
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

  frameIssues(cfg, issues, ctx.risky);

  return { config: cfg, issues };
}

/** Çerçeve alanları: alt bilgi marka bloğu, dönüşüm düğmeleri, duyurular, paylaşım kartı, 404. Metinler düz metindir. */
function frameIssues(cfg: SiteMenuConfig, issues: Issue[], risky: ValidationContext["risky"]) {
  const warnRisky = (value: string, path: string) => {
    if (!risky || !value) return;
    const words = risky(value);
    if (words.length) issues.push({ level: "warn", path, message: `Riskli/abartılı ifade: ${words.join(", ")}. Kanıtlanabilir bir ifade tercih edin.` });
  };

  const b = cfg.footerBrand;
  warnRisky(b.description, "footerBrand.description");
  b.badges.forEach((x, i) => {
    if (!x.label) issues.push({ level: "error", path: `footerBrand.badges.${i}.label`, message: "Rozet metni boş olamaz." });
    warnRisky(x.label, `footerBrand.badges.${i}.label`);
  });
  if (!b.cta.label) issues.push({ level: "error", path: "footerBrand.cta.label", message: "Düğme metni boş olamaz." });
  pageHrefIssues(b.cta.href, "footerBrand.cta.href", issues);
  warnRisky(b.disclaimer, "footerBrand.disclaimer");
  if (b.copyright && !b.copyright.includes("{yil}")) issues.push({ level: "warn", path: "footerBrand.copyright", message: "Telif satırında {yil} yok; yıl her yıl elle güncellenmeli." });

  for (const k of ["login", "trial", "mobileLogin", "mobileTrial"] as const) {
    const c = cfg.ctas[k];
    if (!c.label && k !== "mobileTrial") issues.push({ level: "error", path: `ctas.${k}.label`, message: "Düğme metni boş olamaz." });
    pageHrefIssues(c.href, `ctas.${k}.href`, issues);
    warnRisky(c.label, `ctas.${k}.label`);
  }

  const seenAnn = new Set<string>();
  cfg.announcements.forEach((a, i) => {
    const p = `announcements.${i}`;
    if (seenAnn.has(a.id)) issues.push({ level: "error", path: `${p}.id`, message: "Duyuru kimliği yinelendi; sayfayı yenileyip tekrar deneyin." });
    seenAnn.add(a.id);
    if (!a.text) issues.push({ level: "error", path: `${p}.text`, message: "Duyuru metni boş olamaz." });
    warnRisky(a.text, `${p}.text`);
    if (a.href) {
      pageHrefIssues(a.href, `${p}.href`, issues);
      if (!a.linkLabel) issues.push({ level: "error", path: `${p}.linkLabel`, message: "Bağlantı varsa bağlantı metni de yazın." });
    }
    const start = a.startsOn ? startOfDayTrMs(a.startsOn) : null;
    const end = a.endsOn ? startOfDayTrMs(a.endsOn) : null;
    if (a.startsOn && start === null) issues.push({ level: "error", path: `${p}.startsOn`, message: "Başlangıç tarihi geçerli değil." });
    if (a.endsOn && end === null) issues.push({ level: "error", path: `${p}.endsOn`, message: "Bitiş tarihi geçerli değil." });
    if (start !== null && end !== null && end < start) issues.push({ level: "error", path: `${p}.endsOn`, message: "Bitiş tarihi başlangıçtan önce olamaz." });
    if (a.pathMode === "prefix" && !/^\/[A-Za-z0-9/_-]*$/.test(a.pathPrefix)) {
      issues.push({ level: "error", path: `${p}.pathPrefix`, message: "Yol öneki / ile başlamalı (ör. /fiyatlar); sorgu ve bölüm içeremez." });
    }
  });

  const og = cfg.ogCard;
  if (!og.title) issues.push({ level: "error", path: "ogCard.title", message: "Kart başlığı boş olamaz." });
  warnRisky(og.title, "ogCard.title");
  warnRisky(og.subtitle, "ogCard.subtitle");
  og.chips.forEach((c, i) => {
    if (!c) issues.push({ level: "error", path: `ogCard.chips.${i}`, message: "Rozet boş olamaz; kullanmayacaksanız silin." });
    warnRisky(c, `ogCard.chips.${i}`);
  });

  const nf = cfg.notFound;
  if (!nf.title) issues.push({ level: "error", path: "notFound.title", message: "404 başlığı boş olamaz." });
  nf.links.forEach((l, i) => {
    if (!l.label) issues.push({ level: "error", path: `notFound.links.${i}.label`, message: "Bağlantı adı boş olamaz." });
    pageHrefIssues(l.href, `notFound.links.${i}.href`, issues);
  });
}
