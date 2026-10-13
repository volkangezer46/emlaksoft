import { extractJsonLdBlocks, validateJsonLd } from "./jsonld";
import { NEVER_INDEX_PREFIXES } from "./registry";
import { DESC_MAX, TITLE_MAX } from "./rules";
import { SEO_THRESHOLDS } from "./thresholds";

/**
 * Robot denetim kuralları (SAF): HTML metni + HTTP bilgisi → bulgular. Ağ/DB yok; tamamı birim testlidir.
 * Robot YALNIZ kendi alan adını tarar; bu modül harici site bilgisi kullanmaz.
 */

export type Severity = "critical" | "warning" | "info";

export type Finding = {
  code: string;
  severity: Severity;
  url: string;
  message: string;
  /** Düzeltme önerisi (Türkçe, tek cümle). */
  fix: string;
};

export type PageFacts = {
  url: string;
  status: number;
  title: string | null;
  description: string | null;
  canonical: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  h1Count: number;
  robotsMeta: string | null;
  xRobotsTag: string | null;
  noindex: boolean;
  jsonLdCount: number;
  jsonLdParseErrors: number;
  jsonLdErrors: string[];
  links: string[];
  lang: string | null;
};

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? decode(m[2] ?? m[3] ?? "") : null;
}

function metaContent(html: string, key: "name" | "property", value: string): string | null {
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if ((attr(m[0], key) ?? "").toLowerCase() === value.toLowerCase()) return attr(m[0], "content");
  }
  return null;
}

function linkHref(html: string, rel: string): string | null {
  const re = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const r = (attr(m[0], "rel") ?? "").toLowerCase().split(/\s+/);
    if (r.includes(rel)) return attr(m[0], "href");
  }
  return null;
}

export function extractFacts(url: string, status: number, html: string, headers: { xRobotsTag?: string | null } = {}): PageFacts {
  const titleM = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const body = html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "");
  const h1Count = (body.match(/<h1\b/gi) ?? []).length;
  const robotsMeta = metaContent(html, "name", "robots");
  const googlebot = metaContent(html, "name", "googlebot");
  const xRobots = headers.xRobotsTag ?? null;
  const directives = `${robotsMeta ?? ""},${googlebot ?? ""},${xRobots ?? ""}`.toLowerCase();
  const { blocks, parseErrors } = extractJsonLdBlocks(html);
  const jsonLdErrors = blocks.flatMap((b) => validateJsonLd(b));

  const links: string[] = [];
  const aRe = /<a\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = aRe.exec(body))) {
    const href = attr(m[0], "href");
    if (href) links.push(href);
  }
  const lang = /<html\b[^>]*>/i.exec(html);

  return {
    url,
    status,
    title: titleM ? decode(titleM[1] ?? "") : null,
    description: metaContent(html, "name", "description"),
    canonical: linkHref(html, "canonical"),
    ogTitle: metaContent(html, "property", "og:title"),
    ogDescription: metaContent(html, "property", "og:description"),
    ogImage: metaContent(html, "property", "og:image"),
    h1Count,
    robotsMeta,
    xRobotsTag: xRobots,
    noindex: /\bnoindex\b|\bnone\b/.test(directives),
    jsonLdCount: blocks.length,
    jsonLdParseErrors: parseErrors,
    jsonLdErrors,
    links,
    lang: lang ? attr(lang[0], "lang") : null,
  };
}

/** Sitemap'te listelenen bir sayfa için bulgular. `origin` = site kökü (https://alan.adi). */
export function auditPage(facts: PageFacts, origin: string, opts: { inSitemap: boolean }): Finding[] {
  const out: Finding[] = [];
  const u = facts.url;
  const push = (code: string, severity: Severity, message: string, fix: string) => out.push({ code, severity, url: u, message, fix });

  if (facts.status >= 400 || facts.status === 0) {
    if (opts.inSitemap) push("http-error", "critical", `Sitemap'teki adres ${facts.status === 0 ? "yanıt vermedi" : `HTTP ${facts.status} döndü`}.`, "Sayfayı düzeltin ya da sitemap kapsamından çıkarın.");
    return out;
  }
  if (facts.status >= 300) {
    if (opts.inSitemap) push("sitemap-redirect", "warning", `Sitemap'teki adres yönlendiriyor (HTTP ${facts.status}).`, "Sitemap'e yönlendirmenin nihai adresini yazın.");
    return out;
  }

  if (!facts.title) push("missing-title", "critical", "Sayfa başlığı (title) yok.", "Sayfa için başlık tanımlayın.");
  else if (facts.title.length > TITLE_MAX) push("long-title", "warning", `Başlık ${facts.title.length} karakter (en çok ${TITLE_MAX} önerilir).`, "Başlığı kısaltın.");

  if (!facts.description) push("missing-description", "warning", "Meta açıklama yok.", "70-160 karakterlik bir açıklama yazın.");
  else if (facts.description.length > DESC_MAX) push("long-description", "info", `Açıklama ${facts.description.length} karakter; arama sonucunda kesilebilir.`, "Açıklamayı 160 karakter altına indirin.");

  if (!facts.canonical) push("missing-canonical", "warning", "Canonical bağlantısı yok.", "Sayfaya canonical ekleyin.");
  else if (!/^https?:\/\//i.test(facts.canonical)) push("relative-canonical", "warning", "Canonical göreli adres; mutlak olmalı.", "metadataBase'in doğru olduğundan emin olun ya da mutlak canonical girin.");
  else {
    let canonHost = "";
    try {
      canonHost = new URL(facts.canonical).host.toLowerCase();
    } catch {
      /* geçersiz */
    }
    const host = new URL(origin).host.toLowerCase();
    if (canonHost !== host) push("canonical-host-mismatch", "critical", `Canonical farklı alan adına işaret ediyor (${canonHost || "geçersiz"}).`, "Canonical alan adını sitenin ana alan adıyla eşitleyin (www/apex tutarlılığı).");
    else if (stripSlash(facts.canonical) !== stripSlash(u)) push("canonical-mismatch", "warning", "Canonical adresi sayfa adresiyle aynı değil.", "Bu sayfa kendi kendine canonical olmalı ya da bilerek başka sayfaya işaret ettiğini doğrulayın.");
  }

  if (!facts.ogImage) push("missing-og-image", "warning", "Open Graph görseli yok.", "Sayfaya ya da genel ayara paylaşım görseli ekleyin.");
  if (!facts.ogTitle) push("missing-og-title", "info", "og:title yok.", "Paylaşım başlığı ekleyin.");

  if (facts.h1Count === 0) push("missing-h1", "warning", "Sayfada h1 yok.", "Sayfaya tek bir h1 ekleyin.");
  else if (facts.h1Count > 1) push("multiple-h1", "warning", `Sayfada ${facts.h1Count} h1 var.`, "Tek h1 bırakın.");

  if (facts.noindex && opts.inSitemap) push("noindex-in-sitemap", "critical", "Sayfa noindex ama sitemap'te listeli.", "Sayfayı sitemap'ten çıkarın ya da noindex'i kaldırın.");

  if (facts.jsonLdParseErrors > 0) push("jsonld-parse", "critical", `${facts.jsonLdParseErrors} yapılandırılmış veri bloğu ayrıştırılamadı.`, "JSON-LD biçimini düzeltin.");
  for (const err of facts.jsonLdErrors) {
    const forbidden = err.includes("yasak");
    push(forbidden ? "jsonld-forbidden" : "jsonld-fields", forbidden ? "critical" : "warning", err, forbidden ? "Sahte puan/yorum verisini kaldırın." : "Eksik zorunlu alanı tamamlayın.");
  }
  return out;
}

function stripSlash(v: string): string {
  return v.replace(/[?#].*$/, "").replace(/\/+$/, "");
}

/** Sayfalar arası yinelenen title/description bulguları. */
export function findDuplicates(pages: readonly PageFacts[]): Finding[] {
  const out: Finding[] = [];
  const ok = pages.filter((p) => p.status >= 200 && p.status < 300);
  for (const field of ["title", "description"] as const) {
    const groups = new Map<string, string[]>();
    for (const p of ok) {
      const v = (p[field] ?? "").trim().toLowerCase();
      if (!v) continue;
      groups.set(v, [...(groups.get(v) ?? []), p.url]);
    }
    for (const urls of groups.values()) {
      if (urls.length < 2) continue;
      for (const url of urls) {
        out.push({
          code: field === "title" ? "duplicate-title" : "duplicate-description",
          severity: "warning",
          url,
          message: `${field === "title" ? "Başlık" : "Açıklama"} ${urls.length} sayfada aynı.`,
          fix: `${field === "title" ? "Başlıkları" : "Açıklamaları"} sayfaya özgü yapın.`,
        });
      }
    }
  }
  return out;
}

/** robots.txt (`*` grubu) içinde yolun engelli olup olmadığı. Allow > Disallow uzunluk kuralı uygulanır. */
export function isDisallowedByRobots(robotsTxt: string, path: string): boolean {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let cur: { agents: string[]; allow: string[]; disallow: string[] } | null = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!cur) continue;
      if (key === "allow") cur.allow.push(val);
      else if (key === "disallow" && val) cur.disallow.push(val);
    }
  }
  const star = groups.find((g) => g.agents.includes("*"));
  if (!star) return false;
  const matches = (rule: string) => {
    const re = new RegExp(
      "^" + rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"),
    );
    return re.test(path);
  };
  const longest = (rules: string[]) => rules.filter(matches).reduce((n, r) => Math.max(n, r.length), -1);
  const d = longest(star.disallow);
  if (d < 0) return false;
  return longest(star.allow) < d;
}

export type AuditSummary = {
  critical: number;
  warning: number;
  info: number;
  pagesChecked: number;
  linksChecked: number;
};

export function summarize(findings: readonly Finding[], pagesChecked: number, linksChecked: number): AuditSummary {
  return {
    critical: findings.filter((f) => f.severity === "critical").length,
    warning: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
    pagesChecked,
    linksChecked,
  };
}

/** Bildirim eşiği: kritik bulgu varsa ya da uyarılar eşiği aşarsa. */
export function shouldNotify(s: AuditSummary, warningThreshold = 10): boolean {
  return s.critical > 0 || s.warning >= warningThreshold;
}

/** Önceki çalıştırmaya göre kötüleşme ya da yeni eşik aşımı varsa bildir (günlük tekrar yok). */
export function worsened(prev: AuditSummary | null, next: AuditSummary): boolean {
  if (!shouldNotify(next)) return false;
  if (!prev) return true;
  if (!shouldNotify(prev)) return true;
  return next.critical > prev.critical || next.warning >= prev.warning + 5;
}

/** Yalnız aynı host; yol korumalı alana düşmüyorsa ve dosya değilse denetlenebilir iç bağlantı (harici site YOK). */
export function resolveInternalLink(href: string, pageUrl: string, origin: string): string | null {
  if (/^(mailto:|tel:|javascript:|#|data:|sms:|whatsapp:)/i.test(href)) return null;
  let u: URL;
  try {
    u = new URL(href, pageUrl);
  } catch {
    return null;
  }
  if (u.host.toLowerCase() !== new URL(origin).host.toLowerCase()) return null;
  const p = u.pathname;
  if (NEVER_INDEX_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`))) return null;
  if (p.startsWith("/_next") || /\.(png|jpe?g|webp|avif|svg|ico|css|js|woff2?|pdf|zip|xml|txt)$/i.test(p)) return null;
  u.hash = "";
  u.search = "";
  return u.toString();
}

/* ------------------------------ Genişletilmiş kurallar (SP2) ------------------------------ */

/**
 * Ham HTML'den çıkarılan ek ölçümler (SAF). `auditPage` bunları kullanmaz: mevcut kurallar ve testleri değişmez;
 * robot ek kuralları `auditPageDeep` ile ayrıca çalıştırır.
 */
export type DeepFacts = {
  /** Ham HTML bayt sayısı (okunamayan çok büyük gövde: sınır + 1). */
  rawBytes: number;
  /** İlk yanıt başlıklarına kadar geçen süre; ölçülmediyse null. */
  ttfbMs: number | null;
  /** alt özniteliği HİÇ olmayan <img> sayısı (alt="" dekoratif sayılır, bulgu değildir). */
  imgsMissingAlt: number;
  /** İlk başlık atlaması (ör. "h2→h4"); yoksa null. */
  headingSkip: string | null;
  /** Görünür metindeki sözcük sayısı (script/style/svg/noscript hariç). */
  wordCount: number;
  /** <title> ya da meta description </head>'den SONRA geliyor. */
  metaAfterHead: boolean;
  /** rel="nofollow" taşıyan iç bağlantı sayısı. */
  nofollowInternal: number;
  /** https sayfada http:// ile yüklenen kaynak sayısı (img/script/iframe/stil). */
  mixedContent: number;
};

const stripInvisible = (html: string) =>
  html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ");

/** Görünür metin (etiketler atılmış, boşluklar sadeleşmiş). */
export function visibleText(html: string): string {
  const bodyStart = html.search(/<body\b/i);
  const part = bodyStart >= 0 ? html.slice(bodyStart) : html;
  return decode(stripInvisible(part).replace(/<[^>]+>/g, " "));
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function sameOrigin(href: string, pageUrl: string, origin: string): boolean {
  try {
    return new URL(href, pageUrl).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export function extractDeepFacts(
  pageUrl: string,
  html: string,
  origin: string,
  timing: { rawBytes?: number; ttfbMs?: number | null } = {},
): DeepFacts {
  const clean = stripInvisible(html);

  let imgsMissingAlt = 0;
  for (const m of clean.matchAll(/<img\b[^>]*>/gi)) if (attr(m[0], "alt") === null) imgsMissingAlt += 1;

  let headingSkip: string | null = null;
  let prev = 0;
  for (const m of clean.matchAll(/<h([1-6])\b/gi)) {
    const level = Number(m[1]);
    if (prev > 0 && level > prev + 1) {
      headingSkip = `h${prev}→h${level}`;
      break;
    }
    prev = level;
  }

  const headEnd = html.search(/<\/head>/i);
  const titleAt = html.search(/<title\b/i);
  let descAt = -1;
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    if ((attr(m[0], "name") ?? "").toLowerCase() === "description") {
      descAt = m.index ?? -1;
      break;
    }
  }
  const metaAfterHead = headEnd >= 0 && ((titleAt >= 0 && titleAt > headEnd) || (descAt >= 0 && descAt > headEnd));

  let nofollowInternal = 0;
  for (const m of clean.matchAll(/<a\b[^>]*>/gi)) {
    const rel = (attr(m[0], "rel") ?? "").toLowerCase().split(/\s+/);
    const href = attr(m[0], "href");
    if (href && rel.includes("nofollow") && !/^(mailto:|tel:|javascript:|#)/i.test(href) && sameOrigin(href, pageUrl, origin)) nofollowInternal += 1;
  }

  let mixedContent = 0;
  if (pageUrl.startsWith("https://")) {
    for (const m of clean.matchAll(/<(img|iframe|source|video|audio|embed)\b[^>]*>/gi)) {
      if (/^http:\/\//i.test(attr(m[0], "src") ?? "")) mixedContent += 1;
    }
    // stripInvisible <script> bloklarını atar; dış betik etiketleri ham HTML'de sayılır.
    for (const m of html.matchAll(/<script\b[^>]*>/gi)) if (/^http:\/\//i.test(attr(m[0], "src") ?? "")) mixedContent += 1;
    for (const m of clean.matchAll(/<link\b[^>]*>/gi)) {
      const rel = (attr(m[0], "rel") ?? "").toLowerCase();
      if (/stylesheet|icon|preload/.test(rel) && /^http:\/\//i.test(attr(m[0], "href") ?? "")) mixedContent += 1;
    }
  }

  return {
    rawBytes: timing.rawBytes ?? new TextEncoder().encode(html).length,
    ttfbMs: timing.ttfbMs ?? null,
    imgsMissingAlt,
    headingSkip,
    wordCount: countWords(visibleText(html)),
    metaAfterHead,
    nofollowInternal,
    mixedContent,
  };
}

/**
 * Ek sayfa kuralları (SAF): alt metin, başlık hiyerarşisi, ince içerik, yavaş yanıt, büyük HTML, <head> dışı meta,
 * iç bağlantıda nofollow, karışık içerik. Yalnız 2xx sayfalarda çalışır. Eşikler: thresholds.ts.
 */
export function auditPageDeep(facts: PageFacts, deep: DeepFacts, opts: { inSitemap: boolean }): Finding[] {
  if (facts.status < 200 || facts.status >= 300) return [];
  const T = SEO_THRESHOLDS;
  const out: Finding[] = [];
  const push = (code: string, severity: Severity, message: string, fix: string) => out.push({ code, severity, url: facts.url, message, fix });

  if (deep.imgsMissingAlt > 0) push("img-missing-alt", "warning", `${deep.imgsMissingAlt} görselde alt metni yok.`, "Her görsele içeriğini anlatan kısa bir alt metni yazın (süs görselinde alt=\"\").");
  if (deep.headingSkip) push("heading-skip", "info", `Başlık sırası atlıyor (${deep.headingSkip}).`, "Ara başlık düzeyini atlamadan sıralayın.");
  if (opts.inSitemap && !facts.noindex && deep.wordCount < T.thinContentWords) {
    push("thin-content", "warning", `Sayfada yalnız ${deep.wordCount} sözcük görünür metin var (en az ${T.thinContentWords} önerilir).`, "Sayfaya ziyaretçinin sorusunu yanıtlayan özgün metin ekleyin.");
  }
  if (deep.ttfbMs !== null && deep.ttfbMs > T.slowTtfbMs) push("slow-ttfb", "warning", `Sunucu ilk yanıtı ${Math.round(deep.ttfbMs)} ms'de verdi (en çok ${T.slowTtfbMs} ms önerilir).`, "Sayfayı önbelleğe alın ya da statik sürümünü açın.");
  if (deep.rawBytes > T.htmlTooLargeBytes) push("html-too-large", "warning", `HTML ${Math.round(deep.rawBytes / 1024)} KB (en çok ${Math.round(T.htmlTooLargeBytes / 1024)} KB önerilir).`, "Sayfaya gömülü veriyi azaltın.");
  if (deep.metaAfterHead) push("meta-not-in-head", "warning", "Başlık ya da açıklama <head> bölümünün dışında basılıyor.", "Metadata'nın <head> içinde basıldığından emin olun (akışlı metadata).");
  if (deep.nofollowInternal > 0) push("internal-link-nofollow", "warning", `${deep.nofollowInternal} iç bağlantı nofollow.`, "Kendi sayfalarınıza verdiğiniz bağlantılardan nofollow'u kaldırın.");
  if (deep.mixedContent > 0) push("mixed-content", "critical", `${deep.mixedContent} kaynak güvensiz (http://) adresten yükleniyor.`, "Kaynak adreslerini https:// yapın.");
  return out;
}

/** OG görseli nerede: kendi kökenimiz mi (denetlenebilir), dış adres mi (ASLA çekilmez)? */
export function classifyOgImage(ogImage: string | null, pageUrl: string, origin: string): { kind: "own"; url: string } | { kind: "external" } | null {
  if (!ogImage) return null;
  try {
    const u = new URL(ogImage, pageUrl);
    if (u.origin === new URL(origin).origin) return { kind: "own", url: u.toString() };
    return { kind: "external" };
  } catch {
    return null;
  }
}

/** OG görseli bulgusu: kendi kökenimizdeki görsel erişilemiyorsa uyarı; dış görsel yalnız bilgi (çekilmedi). */
export function ogImageFinding(pageUrl: string, kind: "own" | "external", status: number | null): Finding | null {
  if (kind === "external") {
    return { code: "og-image-external", severity: "info", url: pageUrl, message: "Dış OG görseli (denetlenmedi).", fix: "Paylaşım görselini kendi alan adınızda barındırırsanız robot erişimini denetleyebilir." };
  }
  if (status !== null && status >= 200 && status < 400) return null;
  return {
    code: "og-image-unreachable",
    severity: "warning",
    url: pageUrl,
    message: `Paylaşım görseli açılmıyor (${status === null || status === 0 ? "yanıt yok" : `HTTP ${status}`}).`,
    fix: "OG görselinin adresini düzeltin ya da genel ayardaki marka kartına dönün.",
  };
}

/**
 * Yetim sayfa: sitemap'te olup taranan HİÇBİR başka sayfadan bağlantı almayan sayfa (ana sayfa hariç).
 * `inbound`: hedef adres (sondaki "/" yok) → bağlantı veren sayfalar. Tarama kısmi ise çağıran bu kuralı çalıştırmaz.
 */
export function findOrphans(sitemapUrls: readonly string[], inbound: ReadonlyMap<string, ReadonlySet<string>>, origin: string): Finding[] {
  const home = stripSlash(origin);
  return sitemapUrls
    .filter((u) => stripSlash(u) !== home)
    .filter((u) => {
      const from = inbound.get(stripSlash(u));
      return !from || [...from].every((f) => stripSlash(f) === stripSlash(u));
    })
    .map((url) => ({ code: "orphan-page", severity: "info" as const, url, message: "Hiçbir sayfa bu sayfaya bağlantı vermiyor (yetim sayfa).", fix: "İlgili bir sayfadan ya da menüden bu sayfaya bağlantı verin." }));
}
