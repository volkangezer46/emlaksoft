import { parsePriceText } from "../inventory-csv";
import type { ProbeReply } from "../../worker/core";

/**
 * PORTAL İLAN SAYFASI AYRIŞTIRICI ÇEKİRDEĞİ (SAF: ağ, DOM, saat yok). Tarayıcı eklentisinin service worker'ı kullanıcının
 * KENDİ tarayıcısında aldığı sayfayı buraya verir; sunucu portala istek ATMAZ. Service worker'da DOMParser olmadığı için
 * ayrıştırma metin tabanlıdır: önce JSON-LD (schema.org), sonra yapılandırılabilir kalıplar (`portal-rules.json`, sürümlü).
 *
 * MUHAFAZAKÂR KARAR SIRASI (ASLA yanlış "ilan yok" üretme):
 *   1) HTTP 404/410 → bulunamadı (notFound). 401/403/429/5xx → engel (blocked). Diğer 2xx dışı → hata.
 *   2) Son adres portal dışında / giriş sayfasında → `redirected` / `login_required` (engel).
 *   3) Sayfada portalın "yayından kaldırıldı" ibaresi → bulunamadı.
 *   4) İlan no çıkarıldı ve beklenenle aynı → bulundu (+fiyat/başlık/ilan sahibi). Farklı → `id_mismatch` (hata).
 *   5) Hiçbiri tanınmadı → CAPTCHA işareti varsa `captcha`, yoksa `unexpected_structure` (kontrol edilemedi).
 * CAPTCHA çözülmez, atlatılmaz; engel görülünce yalnız raporlanır.
 */

export type PortalHtmlRules = {
  label: string;
  hosts: readonly string[];
  listingPath: string;
  removedPhrases: readonly string[];
  captchaMarkers: readonly string[];
  loginPaths: readonly string[];
  listingNo: readonly string[];
  price: readonly string[];
  title: readonly string[];
  advisor: readonly string[];
  status: readonly string[];
  storeItem: string;
  nextPage: string;
};

export type FetchedPage = { status: number; finalUrl: string; html: string };

export type StoreItem = { externalId: string; url: string };
export type StoreListResult = { items: StoreItem[]; nextUrl: string | null; error: string | null };

/** Ayrıştırılan en fazla HTML boyutu (bellek/yavaş regex koruması). */
export const MAX_HTML_CHARS = 1_500_000;

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, code: string) => {
    const c = code.toLowerCase();
    if (ENTITY[c] !== undefined) return ENTITY[c];
    if (c.startsWith("#x")) {
      const n = Number.parseInt(c.slice(2), 16);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    if (c.startsWith("#")) {
      const n = Number.parseInt(c.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return m;
  });
}

/** Etiketleri atar, varlıkları çözer, boşlukları teke indirir, uzunluğu kırpar. Boşsa null. */
export function cleanText(raw: string | null | undefined, max: number): string | null {
  if (!raw) return null;
  const s = decodeEntities(raw.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

function fold(s: string): string {
  return s.toLocaleLowerCase("tr-TR");
}

const regexCache = new Map<string, RegExp | null>();
function compile(pattern: string, flags: string): RegExp | null {
  const key = `${flags}:${pattern}`;
  if (!regexCache.has(key)) {
    try {
      regexCache.set(key, new RegExp(pattern, flags));
    } catch {
      regexCache.set(key, null); // bozuk kalıp: yok sayılır (yanlış eşleşme yerine "tanınmadı")
    }
  }
  return regexCache.get(key) ?? null;
}

function firstMatch(html: string, patterns: readonly string[]): string | null {
  for (const p of patterns) {
    const re = compile(p, "i");
    const m = re ? re.exec(html) : null;
    if (m?.[1]) return m[1];
  }
  return null;
}

type Json = Record<string, unknown>;

/** `<script type="application/ld+json">` blokları (dizi ve @graph düzleştirilir). Bozuk JSON atlanır. */
export function extractJsonLd(html: string): Json[] {
  const out: Json[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(html)) && guard < 20) {
    guard += 1;
    try {
      const parsed: unknown = JSON.parse(m[1].trim());
      const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== "object") continue;
        const o = item as Json;
        if (Array.isArray(o["@graph"])) queue.push(...(o["@graph"] as unknown[]));
        out.push(o);
      }
    } catch {
      /* bozuk JSON-LD: atlanır */
    }
  }
  return out;
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function jsonLdFacts(objs: readonly Json[]): { id: string | null; title: string | null; price: number | null; seller: string | null } {
  let id: string | null = null;
  let title: string | null = null;
  let price: number | null = null;
  let seller: string | null = null;
  for (const o of objs) {
    id ??= str(o.sku) ?? str(o.productID) ?? (typeof o.identifier === "object" && o.identifier ? str((o.identifier as Json).value) : str(o.identifier));
    title ??= str(o.name);
    const offers = Array.isArray(o.offers) ? (o.offers[0] as Json | undefined) : (o.offers as Json | undefined);
    if (price === null && offers && typeof offers === "object") {
      const p = str(offers.price);
      price = p ? parsePriceText(p) : null;
      const s = offers.seller as Json | undefined;
      seller ??= s && typeof s === "object" ? str(s.name) : null;
    }
  }
  return { id: id && /^\d{6,12}$/.test(id) ? id : null, title, price, seller };
}

function hostAllowed(host: string, hosts: readonly string[]): boolean {
  const h = host.toLowerCase();
  return hosts.some((x) => h === x || h.endsWith(`.${x}`));
}

/** HTTP/yönlendirme/giriş engelleri. null = sayfa ayrıştırılabilir. */
function transportError(rules: PortalHtmlRules, page: FetchedPage): string | null {
  if (page.status === 429) return "http_429";
  if (page.status === 401 || page.status === 403) return `http_${page.status}`;
  if (page.status >= 500 && page.status <= 599) return `http_${page.status}`;
  if (page.status < 200 || page.status > 299) return `http_${page.status}`;
  let u: URL;
  try {
    u = new URL(page.finalUrl);
  } catch {
    return "redirected";
  }
  if (!hostAllowed(u.hostname, rules.hosts)) return "redirected";
  const path = fold(u.pathname);
  if (rules.loginPaths.some((p) => path === fold(p) || path.startsWith(`${fold(p)}/`))) return "login_required";
  return null;
}

function hasAny(html: string, needles: readonly string[]): boolean {
  const h = fold(html);
  return needles.some((n) => n && h.includes(fold(n)));
}

/** Tek ilan sayfası → köprü yanıtı (`ProbeReply`). `expectedId` işten gelen ilan no'dur (yoksa yalnız kaldırıldı/engel tespiti). */
export function parseListingPage(rules: PortalHtmlRules, page: FetchedPage, expectedId: string | null): ProbeReply {
  if (page.status === 404 || page.status === 410) return { found: false, notFound: true };
  const tErr = transportError(rules, page);
  if (tErr) return { error: tErr };
  const html = page.html.length > MAX_HTML_CHARS ? page.html.slice(0, MAX_HTML_CHARS) : page.html;
  if (hasAny(html, rules.removedPhrases)) return { found: false, notFound: true };

  const ld = jsonLdFacts(extractJsonLd(html));
  const no = firstMatch(html, rules.listingNo) ?? ld.id;
  const title = cleanText(ld.title ?? firstMatch(html, rules.title), 300);
  const priceRaw = firstMatch(html, rules.price);
  const price = ld.price ?? (priceRaw ? parsePriceText(priceRaw) : null);
  const advisorName = cleanText(ld.seller ?? firstMatch(html, rules.advisor), 120);
  const status = cleanText(firstMatch(html, rules.status), 40);
  const expected = (expectedId ?? "").trim();

  if (no && expected && no !== expected) return { error: "id_mismatch" };
  let pathHasId = false;
  try {
    pathHasId = !!expected && new URL(page.finalUrl).pathname.includes(expected);
  } catch {
    pathHasId = false;
  }
  const found = (!!no && (!expected || no === expected)) || (!no && pathHasId && !!title);
  if (!found) return { error: hasAny(html, rules.captchaMarkers) ? "captcha" : "unexpected_structure" };
  return { found: true, price, title, advisorName, status };
}

function absolute(href: string, base: string): string | null {
  try {
    return new URL(decodeEntities(href), base).toString();
  } catch {
    return null;
  }
}

/** Ofis/danışman "mağaza" (ilan listesi) sayfası → ilan no + URL listesi ve sonraki sayfa. Tanınmayan yapı = hata. */
export function parseStoreListPage(rules: PortalHtmlRules, page: FetchedPage, maxItems = 200): StoreListResult {
  if (page.status === 404 || page.status === 410) return { items: [], nextUrl: null, error: `http_${page.status}` };
  const tErr = transportError(rules, page);
  if (tErr) return { items: [], nextUrl: null, error: tErr };
  const html = page.html.length > MAX_HTML_CHARS ? page.html.slice(0, MAX_HTML_CHARS) : page.html;
  const itemRe = compile(rules.storeItem, "gi");
  const items: StoreItem[] = [];
  const seen = new Set<string>();
  if (itemRe) {
    itemRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(html)) && items.length < maxItems) {
      const id = m[2];
      const url = m[1] ? absolute(m[1], page.finalUrl) : null;
      if (!id || !url || seen.has(id)) continue;
      try {
        if (!hostAllowed(new URL(url).hostname, rules.hosts)) continue;
      } catch {
        continue;
      }
      seen.add(id);
      items.push({ externalId: id, url });
    }
  }
  const nextHref = firstMatch(html, [rules.nextPage]);
  let nextUrl = nextHref ? absolute(nextHref, page.finalUrl) : null;
  try {
    if (nextUrl && (!hostAllowed(new URL(nextUrl).hostname, rules.hosts) || nextUrl === page.finalUrl)) nextUrl = null;
  } catch {
    nextUrl = null;
  }
  if (items.length === 0) return { items, nextUrl: null, error: hasAny(html, rules.captchaMarkers) ? "captcha" : "no_items" };
  return { items, nextUrl, error: null };
}
