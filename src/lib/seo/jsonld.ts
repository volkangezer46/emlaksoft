import { getSeoPage } from "./registry";
import { canonicalUrl } from "./rules";
import type { JsonLdKind, SeoGlobal } from "./schema";

/**
 * JSON-LD yardımcıları (SAF). Kurallar:
 *  - AggregateRating / Review / reviewRating ASLA üretilmez ve doğrulayıcı bunları HATA sayar.
 *  - FAQPage yalnız sayfada görünen SSS listesinden üretilir (çağıran geçirir).
 *  - Fiyatlar KDV hariçtir ve yalnız plans.ts'teki gerçek tutarlardır.
 *  - Çıktı `serializeJsonLd` ile basılır: '<' '>' '&' ve U+2028/2029 kaçışlıdır (script kırılması/XSS yok).
 */

export type LdNode = Record<string, unknown>;

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(LINE_SEPARATOR, "\\u2028")
    .replace(PARAGRAPH_SEPARATOR, "\\u2029");
}

// U+2028/U+2029: JSON'da ge\u00e7erli ama eski JS motorlar\u0131nda string'i k\u0131rar; ka\u00e7\u0131\u015flan\u0131r.
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), "g");
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), "g");

/** Saklama biçimi (05XXXXXXXXX / 0XXXXXXXXXX) -> +90...; yabancı (+...) numara aynen. */
export function toE164(phone: string): string {
  const digits = phone.replace(/[\s()-]/g, "");
  if (/^0\d{10}$/.test(digits)) return `+90${digits.slice(1)}`;
  return digits;
}

export function organizationLd(global: SeoGlobal, base: string): LdNode {
  const o = global.organization;
  const node: LdNode = {
    "@type": "Organization",
    "@id": `${base}/#organization`,
    name: o.name || global.siteName,
    url: base,
    description: "Türkiye emlak ofisleri için abonelikli CRM ve ofis yönetim platformu.",
    areaServed: "TR",
  };
  if (o.legalName) node.legalName = o.legalName;
  if (o.logo) node.logo = canonicalUrl(base, o.logo);
  if (o.sameAs.length > 0) node.sameAs = o.sameAs;
  // İletişim yalnız admin'in girdiği doğrulanabilir bilgidir; boşsa hiç basılmaz.
  if (o.email || o.phone) {
    node.contactPoint = {
      "@type": "ContactPoint",
      contactType: "customer support",
      ...(o.email ? { email: o.email } : {}),
      ...(o.phone ? { telephone: toE164(o.phone) } : {}),
      availableLanguage: "Turkish",
    };
  }
  return node;
}

/** WebSite. SearchAction YALNIZ gerçekten çalışan site içi arama varsa eklenir (şu an yok → eklenmez). */
export function webSiteLd(global: SeoGlobal, base: string): LdNode {
  return { "@type": "WebSite", "@id": `${base}/#website`, name: global.siteName, url: base, inLanguage: "tr-TR", publisher: { "@id": `${base}/#organization` } };
}

export type PlanForLd = { id: string; name: string; monthlyTry: number };

/** Paket başına gerçek KDV hariç aylık fiyat. İndirim/sahte "önceki fiyat" yok. */
export function softwareApplicationLd(global: SeoGlobal, base: string, plans: readonly PlanForLd[]): LdNode {
  return {
    "@type": "SoftwareApplication",
    "@id": `${base}/#software`,
    name: global.siteName,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "Müşteri, portföy, randevu, anlaşma ve komisyon akışını tek platformda yöneten emlak ofisi yazılımı. KVKK süreçlerini destekler.",
    inLanguage: "tr-TR",
    url: base,
    offers: plans.map((p) => ({
      "@type": "Offer",
      name: p.name,
      price: String(p.monthlyTry),
      priceCurrency: "TRY",
      url: `${base}/fiyatlar`,
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: p.monthlyTry,
        priceCurrency: "TRY",
        valueAddedTaxIncluded: false,
        unitText: "MON",
        billingDuration: "P1M",
      },
    })),
  };
}

export function faqLd(items: readonly { q: string; a: string }[]): LdNode | null {
  const list = items.filter((f) => f.q.trim() && f.a.trim());
  if (list.length === 0) return null;
  return {
    "@type": "FAQPage",
    mainEntity: list.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

export function breadcrumbLd(path: string, base: string): LdNode | null {
  if (path === "/") return null;
  const segs = path.split("/").filter(Boolean);
  const items: { name: string; path: string }[] = [{ name: "Ana sayfa", path: "/" }];
  let acc = "";
  for (const s of segs) {
    acc += `/${s}`;
    const def = getSeoPage(acc);
    const fallback = acc === "/araclar" ? "Araçlar" : s;
    items.push({ name: def?.title ?? def?.label ?? fallback, path: acc });
  }
  if (items.length < 2) return null;
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: canonicalUrl(base, it.path) })),
  };
}

export function webApplicationLd(tool: { title: string; description: string; url: string }): LdNode {
  return {
    "@type": "WebApplication",
    name: tool.title,
    description: tool.description,
    url: tool.url,
    inLanguage: "tr",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers: { "@type": "Offer", price: "0", priceCurrency: "TRY" },
  };
}

export type PageLdContext = {
  global: SeoGlobal;
  base: string;
  path: string;
  plans: readonly PlanForLd[];
  faq?: readonly { q: string; a: string }[];
  /** Sayfa için etkin türler (kayıt varsayılanı ∩ admin seçimi). */
  kinds: readonly JsonLdKind[];
  tool?: { title: string; description: string; url: string };
};

/** Sayfa için @graph üretir; hiç düğüm yoksa null (script basılmaz). */
export function buildPageJsonLd(ctx: PageLdContext): LdNode | null {
  const nodes: LdNode[] = [];
  for (const kind of ctx.kinds) {
    let n: LdNode | null = null;
    if (kind === "Organization") n = organizationLd(ctx.global, ctx.base);
    else if (kind === "WebSite") n = webSiteLd(ctx.global, ctx.base);
    else if (kind === "SoftwareApplication") n = softwareApplicationLd(ctx.global, ctx.base, ctx.plans);
    else if (kind === "FAQPage") n = ctx.faq ? faqLd(ctx.faq) : null;
    else if (kind === "BreadcrumbList") n = breadcrumbLd(ctx.path, ctx.base);
    else if (kind === "WebApplication") n = ctx.tool ? webApplicationLd(ctx.tool) : null;
    if (n) nodes.push(n);
  }
  if (nodes.length === 0) return null;
  return { "@context": "https://schema.org", "@graph": nodes };
}

const FORBIDDEN_KEYS = new Set(["aggregateRating", "review", "reviewRating", "ratingValue", "reviewCount", "ratingCount"]);

function typesOf(node: LdNode): string[] {
  const t = node["@type"];
  return Array.isArray(t) ? t.map(String) : t ? [String(t)] : [];
}

const isNonEmpty = (v: unknown) => (typeof v === "string" ? v.trim().length > 0 : v !== undefined && v !== null);

function need(node: LdNode, label: string, fields: string[], errors: string[]) {
  for (const f of fields) if (!isNonEmpty(node[f])) errors.push(`${label}: '${f}' zorunlu alanı eksik.`);
}

function scanForbidden(value: unknown, errors: string[], path = "$") {
  if (Array.isArray(value)) {
    value.forEach((v, i) => scanForbidden(v, errors, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k)) errors.push(`${path}.${k}: değerlendirme/puan verisi yasak (sahte AggregateRating/Review eklenmez).`);
      scanForbidden(v, errors, `${path}.${k}`);
    }
  }
}

/** Zorunlu alan kontrolü (Rich Results Test'in yerini tutmaz; hızlı yerel denetim). Hata listesi boşsa geçerli. */
export function validateJsonLd(input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return ["Yapılandırılmış veri bir nesne olmalı."];
  const root = input as LdNode;
  scanForbidden(root, errors);

  const nodes: LdNode[] = Array.isArray(root["@graph"]) ? (root["@graph"] as LdNode[]) : [root];
  if (!root["@context"]) errors.push("@context eksik (https://schema.org olmalı).");

  for (const node of nodes) {
    const types = typesOf(node);
    if (types.length === 0) {
      errors.push("Düğümde @type yok.");
      continue;
    }
    for (const type of types) {
      switch (type) {
        case "Organization":
          need(node, "Organization", ["name", "url"], errors);
          break;
        case "WebSite":
          need(node, "WebSite", ["name", "url"], errors);
          break;
        case "SoftwareApplication":
        case "WebApplication": {
          need(node, type, ["name", "applicationCategory", "operatingSystem"], errors);
          if (type === "SoftwareApplication" && !isNonEmpty(node.offers)) errors.push("SoftwareApplication: 'offers' eksik (fiyat bilgisi gerekir).");
          const offers = Array.isArray(node.offers) ? node.offers : node.offers ? [node.offers] : [];
          offers.forEach((o, i) => {
            const off = o as LdNode;
            need(off, `offers[${i}]`, ["price", "priceCurrency"], errors);
            if (isNonEmpty(off.price) && !/^\d+(\.\d+)?$/.test(String(off.price))) errors.push(`offers[${i}]: 'price' sayısal olmalı.`);
          });
          break;
        }
        case "FAQPage": {
          const main = node.mainEntity;
          if (!Array.isArray(main) || main.length === 0) errors.push("FAQPage: 'mainEntity' boş.");
          else
            main.forEach((q, i) => {
              const qq = q as LdNode;
              need(qq, `mainEntity[${i}]`, ["name"], errors);
              const ans = qq.acceptedAnswer as LdNode | undefined;
              if (!ans || !isNonEmpty(ans.text)) errors.push(`mainEntity[${i}]: 'acceptedAnswer.text' eksik.`);
            });
          break;
        }
        case "BreadcrumbList": {
          const list = node.itemListElement;
          if (!Array.isArray(list) || list.length < 2) errors.push("BreadcrumbList: en az 2 öğe gerekir.");
          else
            list.forEach((it, i) => {
              const li = it as LdNode;
              need(li, `itemListElement[${i}]`, ["position", "name"], errors);
              if (i < list.length - 1 && !isNonEmpty(li.item)) errors.push(`itemListElement[${i}]: 'item' (URL) eksik.`);
            });
          break;
        }
        case "RealEstateListing":
          need(node, "RealEstateListing", ["name", "url"], errors);
          break;
        case "RealEstateAgent":
        case "LocalBusiness":
          need(node, type, ["name"], errors);
          break;
        default:
          break;
      }
    }
  }
  return errors;
}

/** HTML içindeki tüm application/ld+json bloklarını ayrıştırır (robot denetimi ve doğrulayıcı için). */
export function extractJsonLdBlocks(html: string): { blocks: unknown[]; parseErrors: number } {
  const blocks: unknown[] = [];
  let parseErrors = 0;
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      blocks.push(JSON.parse(m[1] ?? ""));
    } catch {
      parseErrors += 1;
    }
  }
  return { blocks, parseErrors };
}
