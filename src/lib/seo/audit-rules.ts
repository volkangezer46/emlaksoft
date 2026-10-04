import { extractJsonLdBlocks, validateJsonLd } from "./jsonld";
import { NEVER_INDEX_PREFIXES } from "./registry";
import { DESC_MAX, TITLE_MAX } from "./rules";

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
