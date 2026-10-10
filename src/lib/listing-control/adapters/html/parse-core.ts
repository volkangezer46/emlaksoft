import type { ProbeReply } from "../../worker/core";
import {
  cleanText,
  collectStateCandidates,
  currencyHint,
  decodeEntities,
  extractJsonLd,
  extractMeta,
  extractStates,
  hasAnyNorm,
  jsonLdFacts,
  normalizeTlPrice,
  stripSiteSuffix,
  visibleText,
  LISTING_NO_RE,
  type StateCandidate,
} from "./parse-layers";

/**
 * PORTAL İLAN SAYFASI AYRIŞTIRICI ÇEKİRDEĞİ (SAF: ağ, DOM, saat yok). Tarayıcı eklentisinin service worker'ı kullanıcının
 * KENDİ tarayıcısında aldığı sayfayı buraya verir; sunucu portala istek ATMAZ. Service worker'da DOMParser olmadığı için
 * ayrıştırma metin tabanlıdır. KATMANLI strateji (`parse-layers.ts`): JSON-LD (schema.org) → meta/og → gömülü durum JSON'u
 * (`__NEXT_DATA__` / `window.__...__`) → son çare DOM kalıpları (`portal-rules.json`, sürümlü). İlan no HERHANGİ bir katmanda
 * beklenenle eşleşirse ilan "yayında"dır; hiçbir katman tanımazsa "kontrol edilemedi" (seçici kayması) + telemetri işareti.
 *
 * MUHAFAZAKÂR KARAR SIRASI (ASLA yanlış "ilan yok" üretme):
 *   1) HTTP 404/410 → bulunamadı. 401/403/429 → engel; 5xx/diğer → belirsiz. Hepsi `error` (kontrol edilemedi), 404/410 hariç.
 *   2) Son adres portal dışında / giriş sayfasında → `redirected` / `login_required`.
 *   3) Görünür metinde (betik/stil hariç) portalın "yayından kaldırıldı" ibaresi, ya da gömülü durum JSON'unda AÇIK pasif/silindi
 *      durumu → yayından kaldırıldı. İstisna: aynı anda yapısal katman (JSON-LD/durum JSON'u) ilan no + fiyatı doğruluyorsa
 *      işaretler çelişir → `conflicting_signals` (kontrol edilemedi).
 *   4) İlan no eşleşirse bulundu (+fiyat/başlık/ilan sahibi, TL'ye normalleştirilmiş; başka para birimi yazılmaz). Farklıysa
 *      `id_mismatch` (hata).
 *   5) Hiçbiri tanınmadı → CAPTCHA işareti varsa `captcha`, yoksa `unexpected_structure` (+ `drift`).
 * CAPTCHA çözülmez, atlatılmaz; engel görülünce yalnız raporlanır.
 */

export { cleanText, decodeEntities, extractJsonLd };

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
  /** "İlanlarım" (kendi ilan listesi) başlangıç adresleri; DOĞRULANMADI (portal-rules.json notu). Yalnız portal alanında olabilir. */
  storeStartUrls?: readonly string[];
  /** Listenin gösterdiği TOPLAM ilan sayısı kalıpları (ilk grup = sayı). Yoksa/bulunamazsa liste "tam" sayılmaz. */
  storeTotal?: readonly string[];
  /** Kart içi konum metni kalıbı (ilk grup). */
  storeLocation?: string;
};

export type FetchedPage = { status: number; finalUrl: string; html: string };

/** Mağaza/ilanlarım kartından okunabilen alanlar (hepsi savunmacı; okunamayan null kalır, ASLA uydurulmaz). */
export type StoreItem = {
  externalId: string;
  url: string;
  title?: string | null;
  price?: number | null;
  sqm?: number | null;
  rooms?: string | null;
  location?: string | null;
  thumbUrl?: string | null;
  status?: "active" | "passive";
};
export type StoreListResult = {
  items: StoreItem[];
  nextUrl: string | null;
  error: string | null;
  /** Portalın listede gösterdiği toplam ilan sayısı (okunamazsa null: liste tam sayılamaz). */
  totalCount?: number | null;
};

/** Ayrıştırılan en fazla HTML boyutu (bellek/yavaş regex koruması). */
export const MAX_HTML_CHARS = 1_500_000;

/** Küçük sayfalarda (CAPTCHA ara sayfaları küçüktür) ham HTML'de de engel işareti aranır; büyük sayfalarda yalnız görünür metinde. */
const CAPTCHA_RAW_SCAN_MAX = 40_000;

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

type Hit = { value: string; trailing: string };
function firstHit(html: string, patterns: readonly string[]): Hit | null {
  for (const p of patterns) {
    const re = compile(p, "i");
    const m = re ? re.exec(html) : null;
    if (m?.[1]) return { value: m[1], trailing: html.slice(m.index + m[0].length, m.index + m[0].length + 20) };
  }
  return null;
}

function hostAllowed(host: string, hosts: readonly string[]): boolean {
  const h = host.toLowerCase();
  return hosts.some((x) => h === x || h.endsWith(`.${x}`));
}

const BLOCKING_ERRORS = new Set(["http_401", "http_403", "http_429", "login_required", "captcha"]);

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
  const path = u.pathname.toLocaleLowerCase("tr-TR");
  if (rules.loginPaths.some((p) => path === p.toLocaleLowerCase("tr-TR") || path.startsWith(`${p.toLocaleLowerCase("tr-TR")}/`))) return "login_required";
  return null;
}

type IdHit = { id: string; layer: "json_ld" | "meta" | "state" | "pattern" | "url" };

/** Katmanlardan toplanan ilan no adayları ve alanlar. */
function gather(rules: PortalHtmlRules, html: string, page: FetchedPage, expected: string) {
  const ld = jsonLdFacts(extractJsonLd(html));
  const { meta, canonical } = extractMeta(html);
  const states = collectStateCandidates(extractStates(html));

  const ids: IdHit[] = [];
  const addId = (id: string | null | undefined, layer: IdHit["layer"]) => {
    if (id && LISTING_NO_RE.test(id) && !ids.some((x) => x.id === id && x.layer === layer)) ids.push({ id, layer });
  };
  for (const id of ld.ids) addId(id, "json_ld");

  const pathRe = compile(rules.listingPath, "i");
  for (const raw of [canonical, meta.get("og:url")]) {
    if (!raw || !pathRe) continue;
    try {
      const m = pathRe.exec(new URL(raw, page.finalUrl).pathname);
      addId(m?.[1], "meta");
    } catch {
      /* geçersiz adres: atlanır */
    }
  }
  for (const c of states) addId(c.id, "state");
  const patId = firstHit(html, rules.listingNo);
  addId(patId?.value, "pattern");

  const target = expected || ids[0]?.id || "";
  const ldUsable = ld.ids.length === 0 || ld.ids.includes(target);
  const st: StateCandidate | undefined = states.find((c) => c.id === target);

  // Alanlar: JSON-LD → meta → durum JSON'u → DOM kalıbı. Para birimi TL değilse fiyat YAZILMAZ.
  let price: number | null = null;
  let nonTl = false;
  const takePrice = (r: { price: number | null; nonTl: boolean }) => {
    if (r.nonTl) nonTl = true;
    else if (price === null) price = r.price;
  };
  if (ldUsable) {
    if (ld.nonTl) nonTl = true;
    else price = ld.price;
  }
  if (price === null && !nonTl) {
    const mp = meta.get("product:price:amount") ?? meta.get("og:price:amount") ?? meta.get("price");
    const mc = meta.get("product:price:currency") ?? meta.get("og:price:currency") ?? meta.get("pricecurrency");
    if (mp) takePrice(normalizeTlPrice(mp, mc));
  }
  if (price === null && !nonTl && st) {
    if (st.nonTl) nonTl = true;
    else price = st.price;
  }
  if (price === null && !nonTl) {
    const hit = firstHit(html, rules.price);
    if (hit) takePrice(normalizeTlPrice(hit.value, currencyHint(hit.trailing)));
  }
  if (nonTl) price = null;

  const title = cleanText(
    (ldUsable ? ld.title : null) ?? stripSiteSuffix(meta.get("og:title") ?? null) ?? st?.title ?? firstHit(html, rules.title)?.value ?? null,
    300,
  );
  const advisorName = cleanText((ldUsable ? ld.seller : null) ?? st?.seller ?? firstHit(html, rules.advisor)?.value ?? null, 120);
  const status = cleanText(firstHit(html, rules.status)?.value ?? (st && !st.removed ? st.status : null), 40);

  const removedState = states.some((c) => c.removed && (expected ? c.id === expected : true));
  // Yapısal doğrulama: JSON-LD ya da (pasif DEĞİL) durum nesnesi ilan no + fiyatı birlikte veriyor.
  const strongLive =
    (ld.ids.includes(target) && ld.price !== null && !ld.nonTl) || (!!st && !st.removed && st.price !== null && st.id === target);
  return { ids, price, title, advisorName, status, removedState, strongLive };
}

/** Tek ilan sayfası → köprü yanıtı (`ProbeReply`). `expectedId` işten gelen ilan no'dur (yoksa yalnız kaldırıldı/engel tespiti). */
export function parseListingPage(rules: PortalHtmlRules, page: FetchedPage, expectedId: string | null): ProbeReply {
  if (page.status === 404 || page.status === 410) return { found: false, notFound: true, classification: "not_found" };
  const tErr = transportError(rules, page);
  if (tErr) return { error: tErr, classification: BLOCKING_ERRORS.has(tErr) ? "blocked" : "unknown" };

  const html = page.html.length > MAX_HTML_CHARS ? page.html.slice(0, MAX_HTML_CHARS) : page.html;
  const text = visibleText(html);
  const expected = (expectedId ?? "").trim();
  const g = gather(rules, html, page, expected);

  const removedText = hasAnyNorm(text, rules.removedPhrases);
  if ((removedText || g.removedState) && g.strongLive) return { error: "conflicting_signals", classification: "unknown" };
  if (removedText || g.removedState) return { found: false, notFound: true, classification: "removed" };

  const match = expected ? g.ids.find((i) => i.id === expected) : g.ids[0];
  if (!match && expected && g.ids.length > 0) return { error: "id_mismatch", classification: "unknown" };

  let layer: IdHit["layer"] | null = match?.layer ?? null;
  if (!match && expected && g.title) {
    try {
      if (new URL(page.finalUrl).pathname.includes(expected)) layer = "url";
    } catch {
      layer = null;
    }
  }
  if (!layer) {
    const captcha = hasAnyNorm(text, rules.captchaMarkers) || (html.length < CAPTCHA_RAW_SCAN_MAX && hasAnyNorm(html, rules.captchaMarkers));
    return captcha ? { error: "captcha", classification: "blocked" } : { error: "unexpected_structure", classification: "unknown", drift: true };
  }
  return {
    found: true,
    price: g.price,
    title: g.title,
    advisorName: g.advisorName,
    status: g.status,
    classification: "live",
    layer,
    partial: g.price === null || !g.title,
  };
}

function absolute(href: string, base: string): string | null {
  try {
    return new URL(decodeEntities(href), base).toString();
  } catch {
    return null;
  }
}

/** Kart penceresi (bir ilan bağlantısından sonrakine kadar) en çok bu kadar karakter taranır. */
const CARD_WINDOW = 3_500;
const PRICE_TL_RE = /(\d{1,3}(?:\.\d{3})+|\d{4,})(?:,\d{1,2})?\s*(?:TL|₺)/i;
const SQM_RE = /(\d{2,4})(?:[.,]\d+)?\s*(?:m²|m2|m²|metrekare)/i;
const ROOMS_RE = /\b(\d{1,2}\s*\+\s*\d{1,2})\b/;
const IMG_RE = /<img\b[^>]*?\s(?:data-src|data-lazy-src|src)="(https:\/\/[^"\s]+)"/i;
const PASSIVE_PHRASES = ["pasif", "yayında değil", "yayinda degil", "süresi doldu", "onay bekliyor", "yayından kaldırıldı"];

function readCard(rules: PortalHtmlRules, card: string, baseUrl: string): Omit<StoreItem, "externalId" | "url"> {
  const out: Omit<StoreItem, "externalId" | "url"> = {};
  // Pencere ilan bağlantısının `href`inden başlar (etiketin ortasındadır): önce title özniteliği, yoksa bağlantı metni.
  const titleAttr = /\btitle="([^"]{4,300})"/i.exec(card)?.[1];
  const anchorText = /^[^>]*>([\s\S]{4,400}?)<\/a>/i.exec(card)?.[1];
  const title = cleanText(titleAttr ?? anchorText ?? null, 300);
  if (title && !/^(sonraki|önceki|detay|incele)$/i.test(title)) out.title = title;
  const text = visibleText(card);
  const price = PRICE_TL_RE.exec(text);
  // Başka para birimi görünüyorsa fiyat yazılmaz (yanlış TL fiyatı uyuşmazlık alarmı doğurur).
  const foreign = /(?:\$|€|£|\busd\b|\beur\b|\bgbp\b)/i.test(text);
  if (price && !foreign) {
    const n = normalizeTlPrice(price[0], "TRY").price;
    if (n !== null) out.price = n;
  }
  const sqm = SQM_RE.exec(text);
  if (sqm) {
    const v = Number(sqm[1]);
    if (v >= 10 && v <= 20_000) out.sqm = v;
  }
  const rooms = ROOMS_RE.exec(title ?? text);
  if (rooms) out.rooms = rooms[1].replace(/\s+/g, "");
  const locRe = rules.storeLocation ? compile(rules.storeLocation, "i") : null;
  const loc = cleanText(
    (locRe ? locRe.exec(card)?.[1] : null) ?? /class="[^"]*(?:location|konum|adres)[^"]*"[^>]*>\s*(?:<[^>]*>\s*)*([^<]{3,160})</i.exec(card)?.[1] ?? null,
    160,
  );
  if (loc) out.location = loc;
  const img = IMG_RE.exec(card)?.[1];
  if (img) {
    try {
      const u = new URL(img, baseUrl);
      if (u.protocol === "https:") out.thumbUrl = u.toString().slice(0, 600);
    } catch {
      /* geçersiz görsel adresi: atlanır */
    }
  }
  out.status = hasAnyNorm(text, PASSIVE_PHRASES) ? "passive" : "active";
  return out;
}

function readTotal(rules: PortalHtmlRules, html: string): number | null {
  const patterns = rules.storeTotal ?? [];
  const hit = firstHit(html, patterns);
  if (!hit) return null;
  const n = Number(hit.value.replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 && n <= 100_000 ? n : null;
}

/**
 * Ofis/danışman "mağaza" ya da "ilanlarım" sayfası → ilan no + URL + (okunabilirse) başlık/fiyat/m²/oda/konum/küçük resim,
 * toplam ilan sayısı ve sonraki sayfa. Tanınmayan yapı = hata (`no_items`); alanlar okunamazsa null kalır, ASLA uydurulmaz.
 */
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
    const hits: { index: number; id: string; url: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(html)) && hits.length < maxItems * 4) {
      const id = m[2];
      const url = m[1] ? absolute(m[1], page.finalUrl) : null;
      if (!id || !url || seen.has(id)) continue;
      try {
        if (!hostAllowed(new URL(url).hostname, rules.hosts)) continue;
      } catch {
        continue;
      }
      seen.add(id);
      hits.push({ index: m.index, id, url });
    }
    for (let i = 0; i < hits.length && items.length < maxItems; i += 1) {
      const end = Math.min(hits[i + 1]?.index ?? html.length, hits[i].index + CARD_WINDOW);
      items.push({ externalId: hits[i].id, url: hits[i].url, ...readCard(rules, html.slice(hits[i].index, end), page.finalUrl) });
    }
  }
  const nextHref = firstHit(html, [rules.nextPage])?.value ?? null;
  let nextUrl = nextHref ? absolute(nextHref, page.finalUrl) : null;
  try {
    if (nextUrl && (!hostAllowed(new URL(nextUrl).hostname, rules.hosts) || nextUrl === page.finalUrl)) nextUrl = null;
  } catch {
    nextUrl = null;
  }
  if (items.length === 0) {
    const captcha = hasAnyNorm(visibleText(html), rules.captchaMarkers) || hasAnyNorm(html, rules.captchaMarkers);
    return { items, nextUrl: null, error: captcha ? "captcha" : "no_items", totalCount: null };
  }
  return { items, nextUrl, error: null, totalCount: readTotal(rules, html) };
}
