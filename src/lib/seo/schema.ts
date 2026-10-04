import { z } from "zod";

/**
 * SEO merkezi ayar şemaları (saf; sunucu/istemci ortak).
 *
 * Depolama: `platform_settings` anahtar-değer tablosu (yeni migration gerekmez).
 *   seo.global    -> SeoGlobal (kısmi; eksik alanlar DEFAULT_SEO_GLOBAL'dan gelir)
 *   seo.pages     -> { [yol]: SeoPageOverride }
 *   seo.sitemap   -> SeoSitemapSettings
 *   seo.robots    -> SeoRobotsSettings
 *   seo.redirects -> SeoRedirectRule[]
 *   seo.indexnow  -> SeoIndexNowSettings
 *   seo.audit.latest / seo.audit.history -> robot denetim sonucu
 *
 * Güvenlik: HİÇBİR alan HTML kabul etmez; metinler düz metin olarak render edilir,
 * JSON-LD `serializeJsonLd` ile '<' kaçışlıdır. Her anahtarın boyut sınırı vardır.
 */

export const SEO_KEYS = {
  global: "seo.global",
  pages: "seo.pages",
  sitemap: "seo.sitemap",
  robots: "seo.robots",
  redirects: "seo.redirects",
  indexnow: "seo.indexnow",
  indexnowSeen: "seo.indexnow.seen",
  auditLatest: "seo.audit.latest",
  auditHistory: "seo.audit.history",
} as const;

/** Anahtar başına en çok bayt (JSON metni). */
export const SEO_MAX_BYTES: Record<keyof typeof SEO_KEYS, number> = {
  global: 16 * 1024,
  pages: 96 * 1024,
  sitemap: 32 * 1024,
  robots: 16 * 1024,
  redirects: 128 * 1024,
  indexnow: 8 * 1024,
  indexnowSeen: 512 * 1024,
  auditLatest: 256 * 1024,
  auditHistory: 64 * 1024,
};

const plain = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[<>]/.test(v), "HTML etiketi kullanılamaz");

const optionalPlain = (max: number) => plain(max).optional();

/** Mutlak https adresi (http yalnız localhost). */
const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" || (u.protocol === "http:" && u.hostname === "localhost");
    } catch {
      return false;
    }
  }, "Geçerli bir https adresi girin");

/** Aynı site yolu ("/x") ya da mutlak https adresi. */
const pathOrUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => (v.startsWith("/") && !v.startsWith("//") && !/\s/.test(v)) || /^https:\/\/[^\s]+$/.test(v), "Yol '/' ile başlamalı ya da https adresi olmalı");

const verificationToken = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{10,120}$/, "Yalnız doğrulama kodunun kendisini girin (meta etiketi değil)");

export const GlobalInputSchema = z.object({
  siteName: plain(60).min(1).optional(),
  titleTemplate: plain(80)
    .refine((v) => v.includes("%s"), "Şablon %s içermeli")
    .optional(),
  defaultTitle: plain(120).min(1).optional(),
  defaultDescription: plain(320).min(1).optional(),
  ogImage: pathOrUrl.optional(),
  twitterHandle: z
    .string()
    .trim()
    .regex(/^(@?[A-Za-z0-9_]{1,15})?$/, "Geçerli bir kullanıcı adı girin")
    .optional(),
  locale: z.enum(["tr_TR"]).optional(),
  organization: z
    .object({
      name: optionalPlain(120),
      legalName: optionalPlain(160),
      logo: pathOrUrl.optional().or(z.literal("")),
      sameAs: z.array(httpsUrl).max(10).optional(),
      email: z.string().trim().max(160).regex(/^([^\s@]+@[^\s@]+\.[^\s@]+)?$/, "Geçerli e-posta girin").optional(),
      phone: z.string().trim().max(24).regex(/^(\+?[0-9 ()-]{7,24})?$/, "Geçerli telefon girin").optional(),
    })
    .optional(),
  verification: z
    .object({
      google: verificationToken.optional().or(z.literal("")),
      bing: verificationToken.optional().or(z.literal("")),
      yandex: verificationToken.optional().or(z.literal("")),
    })
    .optional(),
});

export type SeoGlobal = {
  siteName: string;
  titleTemplate: string;
  defaultTitle: string;
  defaultDescription: string;
  /** Boşsa marka kartı (/opengraph-image) kullanılır. */
  ogImage: string;
  twitterHandle: string;
  locale: "tr_TR";
  organization: {
    name: string;
    legalName: string;
    logo: string;
    sameAs: string[];
    email: string;
    phone: string;
  };
  verification: { google: string; bing: string; yandex: string };
};

/** Ayar yokken bugünkü canlı değerler (layout.tsx ile birebir). */
export const DEFAULT_SEO_GLOBAL: SeoGlobal = {
  siteName: "EmlakSoft",
  titleTemplate: "%s | EmlakSoft",
  defaultTitle: "EmlakSoft — Türkiye’nin emlak işletim sistemi",
  defaultDescription:
    "Müşteriden tapuya, ilandan komisyona kadar emlak ofisinizi tek platformda yönetin. İYS/EİDS hazırlık süreçleri ve yapay zeka destekli emlak CRM.",
  ogImage: "",
  twitterHandle: "",
  locale: "tr_TR",
  organization: { name: "EmlakSoft", legalName: "", logo: "", sameAs: [], email: "", phone: "" },
  verification: { google: "", bing: "", yandex: "" },
};

export function mergeGlobal(input: z.infer<typeof GlobalInputSchema> | null | undefined): SeoGlobal {
  const d = DEFAULT_SEO_GLOBAL;
  const i = input ?? {};
  return {
    siteName: i.siteName || d.siteName,
    titleTemplate: i.titleTemplate || d.titleTemplate,
    defaultTitle: i.defaultTitle || d.defaultTitle,
    defaultDescription: i.defaultDescription || d.defaultDescription,
    ogImage: i.ogImage || d.ogImage,
    twitterHandle: (i.twitterHandle ?? d.twitterHandle).replace(/^@/, ""),
    locale: "tr_TR",
    organization: {
      name: i.organization?.name || d.organization.name,
      legalName: i.organization?.legalName ?? "",
      logo: i.organization?.logo ?? "",
      sameAs: i.organization?.sameAs ?? [],
      email: i.organization?.email ?? "",
      phone: i.organization?.phone ?? "",
    },
    verification: {
      google: i.verification?.google ?? "",
      bing: i.verification?.bing ?? "",
      yandex: i.verification?.yandex ?? "",
    },
  };
}

export const CHANGE_FREQS = ["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"] as const;
export type ChangeFreq = (typeof CHANGE_FREQS)[number];

export const JSON_LD_KINDS = ["Organization", "WebSite", "SoftwareApplication", "FAQPage", "BreadcrumbList", "WebApplication"] as const;
export type JsonLdKind = (typeof JSON_LD_KINDS)[number];

export const PageOverrideSchema = z.object({
  title: optionalPlain(120),
  description: optionalPlain(320),
  canonical: pathOrUrl.optional(),
  ogTitle: optionalPlain(120),
  ogDescription: optionalPlain(320),
  ogImage: pathOrUrl.optional(),
  robotsIndex: z.boolean().optional(),
  robotsFollow: z.boolean().optional(),
  sitemapInclude: z.boolean().optional(),
  sitemapPriority: z.number().min(0).max(1).optional(),
  changeFreq: z.enum(CHANGE_FREQS).optional(),
  jsonLd: z.array(z.enum(JSON_LD_KINDS)).max(6).optional(),
  /** Admin kaydetme zamanı (ISO) — sitemap lastmod için TEK gerçek kaynak. */
  updatedAt: z.string().max(40).optional(),
});
export type SeoPageOverride = z.infer<typeof PageOverrideSchema>;

export const PagesSchema = z.record(z.string().max(200), PageOverrideSchema);
export type SeoPages = z.infer<typeof PagesSchema>;

/** Alanları boş (undefined / "") olan geçersiz girdileri atar; hepsi boşsa null. */
export function compactOverride(o: SeoPageOverride): SeoPageOverride | null {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  const keys = Object.keys(out).filter((k) => k !== "updatedAt");
  return keys.length === 0 ? null : (out as SeoPageOverride);
}

export const SitemapSettingsSchema = z.object({
  staticPages: z.boolean().optional(),
  tools: z.boolean().optional(),
  /** Vitrin ofis sayfaları: YALNIZ aşağıdaki opt-in listesindeki ofisler (varsayılan: boş = hiçbiri). */
  vitrinOffices: z.boolean().optional(),
  vitrinListings: z.boolean().optional(),
  advisors: z.boolean().optional(),
  /** true (varsayılan): yalnız optInTenantSlugs içindeki ofisler; false: tüm aktif ofisler. */
  onlyOptIn: z.boolean().optional(),
  optInTenantSlugs: z.array(z.string().regex(/^[a-z0-9-]{1,80}$/)).max(2000).optional(),
  /** Parça başına en çok URL (protokol sınırı 50.000). */
  maxUrlsPerSitemap: z.number().int().min(1000).max(50000).optional(),
});
export type SeoSitemapSettings = {
  staticPages: boolean;
  tools: boolean;
  vitrinOffices: boolean;
  vitrinListings: boolean;
  advisors: boolean;
  onlyOptIn: boolean;
  optInTenantSlugs: string[];
  maxUrlsPerSitemap: number;
};
export const DEFAULT_SITEMAP: SeoSitemapSettings = {
  staticPages: true,
  tools: true,
  vitrinOffices: true,
  vitrinListings: true,
  advisors: true,
  onlyOptIn: true,
  optInTenantSlugs: [],
  maxUrlsPerSitemap: 45000,
};
export function mergeSitemap(i: z.infer<typeof SitemapSettingsSchema> | null | undefined): SeoSitemapSettings {
  const d = DEFAULT_SITEMAP;
  return {
    staticPages: i?.staticPages ?? d.staticPages,
    tools: i?.tools ?? d.tools,
    vitrinOffices: i?.vitrinOffices ?? d.vitrinOffices,
    vitrinListings: i?.vitrinListings ?? d.vitrinListings,
    advisors: i?.advisors ?? d.advisors,
    onlyOptIn: i?.onlyOptIn ?? d.onlyOptIn,
    optInTenantSlugs: [...new Set(i?.optInTenantSlugs ?? [])],
    maxUrlsPerSitemap: i?.maxUrlsPerSitemap ?? d.maxUrlsPerSitemap,
  };
}

export const AI_BOTS = [
  { id: "GPTBot", label: "GPTBot (OpenAI eğitim)" },
  { id: "OAI-SearchBot", label: "OAI-SearchBot (ChatGPT arama)" },
  { id: "ChatGPT-User", label: "ChatGPT-User (kullanıcı isteği)" },
  { id: "ClaudeBot", label: "ClaudeBot (Anthropic)" },
  { id: "Claude-SearchBot", label: "Claude-SearchBot (Anthropic arama)" },
  { id: "Google-Extended", label: "Google-Extended (Gemini eğitimi)" },
  { id: "CCBot", label: "CCBot (Common Crawl)" },
  { id: "PerplexityBot", label: "PerplexityBot" },
  { id: "Applebot-Extended", label: "Applebot-Extended (Apple yapay zekâ)" },
  { id: "Bytespider", label: "Bytespider (ByteDance)" },
] as const;
export type AiBotId = (typeof AI_BOTS)[number]["id"];
const AI_BOT_IDS = AI_BOTS.map((b) => b.id) as [AiBotId, ...AiBotId[]];

const disallowPath = z
  .string()
  .trim()
  .max(200)
  .regex(/^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/%*?]*$/, "Yol '/' ile başlamalı, boşluk içermemeli")
  .refine((v) => v !== "/" && v !== "/*", "Tüm siteyi engelleyen kural kullanılamaz");

export const RobotsSettingsSchema = z.object({
  /** Yönetilen ek Disallow yolları (zorunlu güvenlik yolları koddan eklenir ve çıkarılamaz). */
  extraDisallow: z.array(disallowPath).max(100).optional(),
  /** Engellenen yapay zekâ tarayıcıları (varsayılan: boş = hepsine izin). */
  blockedAiBots: z.array(z.enum(AI_BOT_IDS)).max(AI_BOTS.length).optional(),
  llmsTxtEnabled: z.boolean().optional(),
  llmsTxt: optionalPlain(4000),
});
export type SeoRobotsSettings = {
  extraDisallow: string[];
  blockedAiBots: AiBotId[];
  llmsTxtEnabled: boolean;
  llmsTxt: string;
};
export const DEFAULT_ROBOTS: SeoRobotsSettings = { extraDisallow: [], blockedAiBots: [], llmsTxtEnabled: false, llmsTxt: "" };
export function mergeRobots(i: z.infer<typeof RobotsSettingsSchema> | null | undefined): SeoRobotsSettings {
  return {
    extraDisallow: [...new Set(i?.extraDisallow ?? [])],
    blockedAiBots: [...new Set(i?.blockedAiBots ?? [])],
    llmsTxtEnabled: i?.llmsTxtEnabled ?? false,
    llmsTxt: i?.llmsTxt ?? "",
  };
}

export const REDIRECT_STATUSES = [308, 307] as const;
export const RedirectRuleSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{6,24}$/),
  from: pathOrUrl.refine((v) => v.startsWith("/"), "Kaynak yol '/' ile başlamalı"),
  to: pathOrUrl,
  status: z.union([z.literal(308), z.literal(307)]),
  enabled: z.boolean(),
  note: optionalPlain(160),
});
export type SeoRedirectRule = z.infer<typeof RedirectRuleSchema>;
export const RedirectsSchema = z.array(RedirectRuleSchema).max(500);

export const IndexNowSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  key: z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .optional(),
  /** Son gönderilen URL özetinin SHA-256 değeri (değişiklik tespiti). */
  lastHash: z.string().max(80).optional(),
  lastSentAt: z.string().max(40).optional(),
  lastCount: z.number().int().min(0).optional(),
  lastStatus: z.string().max(200).optional(),
  /** Günlük sayaç: "YYYY-MM-DD" + gönderilen URL sayısı. */
  dayKey: z.string().max(12).optional(),
  dayCount: z.number().int().min(0).optional(),
});
export type SeoIndexNowSettings = {
  enabled: boolean;
  key: string;
  lastHash: string;
  lastSentAt: string;
  lastCount: number;
  lastStatus: string;
  dayKey: string;
  dayCount: number;
};
export const INDEXNOW_DAILY_LIMIT = 2000;
export const DEFAULT_INDEXNOW: SeoIndexNowSettings = {
  enabled: false,
  key: "",
  lastHash: "",
  lastSentAt: "",
  lastCount: 0,
  lastStatus: "",
  dayKey: "",
  dayCount: 0,
};
export function mergeIndexNow(i: z.infer<typeof IndexNowSettingsSchema> | null | undefined): SeoIndexNowSettings {
  return { ...DEFAULT_INDEXNOW, ...(i ?? {}) } as SeoIndexNowSettings;
}

/** Güvenli JSON ayrıştırma: bozuk/uyumsuz veri null döner (çağıran varsayılana düşer). */
export function safeParse<T>(schema: z.ZodType<T>, raw: string | null): T | null {
  if (!raw) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Yazmadan önce: şema doğrulama + boyut sınırı. Hata mesajı Türkçe. */
export function serializeSetting<T>(
  key: keyof typeof SEO_KEYS,
  schema: z.ZodType<T>,
  value: unknown,
): { ok: true; json: string; value: T } | { ok: false; error: string } {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first ? `${first.path.join(".") || "Ayar"}: ${first.message}` : "Geçersiz ayar." };
  }
  const json = JSON.stringify(parsed.data);
  if (new TextEncoder().encode(json).length > SEO_MAX_BYTES[key]) {
    return { ok: false, error: "Ayar boyut sınırını aşıyor." };
  }
  return { ok: true, json, value: parsed.data };
}
