import type { PageSnapshot } from "./page-snapshot";
import { SERP_PX, descriptionPixelVerdict, titlePixelVerdict } from "./pixel-width";
import { expectedTypesFor } from "./structured-data";
import { SEO_THRESHOLDS } from "./thresholds";
import { containsPhrase, keyTerms } from "./text-match";

export { containsPhrase, foldTr, keyTerms } from "./text-match";

/**
 * SEO OPTİMİZASYON PUANI (SAF, deterministik). Girdi yalnız GERÇEK ölçümdür: robotun sayfa anlık görüntüsü, varsa
 * hız ölçümü (PSI/CrUX) ve Search Console sorgusu, sitemap lastmod'u. Veri yoksa kategori `null` (uygulanamaz) olur ve
 * ağırlığı diğerlerine dağıtılır; hiç sayfa yoksa site puanı YOKTUR. Tahmini kısım (`estimated`) ekranda etiketlenir.
 * Model: docs/design/SEO_GELISMIS_2026-10.md §2.
 */

export const SCORE_CATEGORIES = ["teknik", "sayfaIci", "yapisal", "performans", "tazelik"] as const;
export type ScoreCategory = (typeof SCORE_CATEGORIES)[number];

export const CATEGORY_WEIGHT: Record<ScoreCategory, number> = { teknik: 30, sayfaIci: 30, yapisal: 15, performans: 15, tazelik: 10 };

export const CATEGORY_LABEL: Record<ScoreCategory, string> = {
  teknik: "Teknik",
  sayfaIci: "Sayfa içi",
  yapisal: "Yapılandırılmış veri",
  performans: "Performans",
  tazelik: "Tazelik",
};

export type ScoreCheck = {
  id: string;
  category: ScoreCategory;
  label: string;
  /** 0..1 (1 = tam geçti). */
  ratio: number;
  weight: number;
  detail: string;
  /** Geçmeyen kontrol için Türkçe öneri (tavsiye motoru kullanır). */
  fix?: string;
  /** Değer tahminidir (ör. laboratuvar ölçümü yokken sayfa ağırlığından performans). */
  estimated?: boolean;
};

export type PageScore = {
  url: string;
  path: string;
  total: number;
  categories: Record<ScoreCategory, number | null>;
  checks: ScoreCheck[];
  /** Performans kategorisi tahmini mi (PSI/CrUX yok)? */
  perfEstimated: boolean;
};

export type PerfInput = { score: number; source: "psi" | "crux" | "lighthouse" } | null;

export type PageScoreContext = {
  /** Mobil laboratuvar/saha puanı (0-100). */
  perf?: PerfInput;
  /** Sitemap lastmod (ISO) — yoksa tazelik uygulanamaz. */
  lastmod?: string | null;
  /** Search Console'da bu sayfanın en çok gösterim aldığı sorgu (varsa). */
  topQuery?: string | null;
  nowMs: number;
};

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return url;
  }
};

const verdictRatio = (v: "ok" | "warn" | "fail") => (v === "ok" ? 1 : v === "warn" ? 0.5 : 0);

function categoryScore(checks: readonly ScoreCheck[], cat: ScoreCategory): number | null {
  const list = checks.filter((c) => c.category === cat);
  const w = list.reduce((s, c) => s + c.weight, 0);
  if (w === 0) return null;
  return Math.round((100 * list.reduce((s, c) => s + c.weight * c.ratio, 0)) / w);
}

/** Uygulanabilir kategorilerin ağırlıklı ortalaması (ağırlık yeniden dağıtılır). */
export function combineCategories(cats: Record<ScoreCategory, number | null>): number {
  let w = 0;
  let sum = 0;
  for (const c of SCORE_CATEGORIES) {
    const v = cats[c];
    if (v === null) continue;
    w += CATEGORY_WEIGHT[c];
    sum += CATEGORY_WEIGHT[c] * v;
  }
  return w === 0 ? 0 : Math.round(sum / w);
}

export function scorePage(s: PageSnapshot, ctx: PageScoreContext): PageScore {
  const path = pathOf(s.url);
  const checks: ScoreCheck[] = [];
  const add = (c: ScoreCheck) => checks.push({ ...c, ratio: Math.max(0, Math.min(1, c.ratio)) });
  const ok2xx = s.status >= 200 && s.status < 300;

  /* ---------- Teknik ---------- */
  add({
    id: "status",
    category: "teknik",
    label: "Sayfa açılıyor (HTTP 2xx)",
    ratio: ok2xx ? 1 : 0,
    weight: 3,
    detail: ok2xx ? `HTTP ${s.status}` : s.status === 0 ? "Yanıt yok" : s.status >= 300 && s.status < 400 ? `Yönlendiriyor (HTTP ${s.status})` : `HTTP ${s.status}`,
    fix: s.status >= 300 && s.status < 400 ? "Bağlantıları ve sitemap'i yönlendirmenin son adresine çekin." : "Sayfayı düzeltin ya da sitemap ve bağlantılardan çıkarın.",
  });
  if (!ok2xx) {
    const categories: Record<ScoreCategory, number | null> = { teknik: 0, sayfaIci: null, yapisal: null, performans: null, tazelik: null };
    return { url: s.url, path, total: 0, categories, checks, perfEstimated: false };
  }
  const consistent = (!s.noindex && s.inSitemap) || (s.noindex && !s.inSitemap);
  add({
    id: "index-sitemap",
    category: "teknik",
    label: "İndeks ve sitemap tutarlı",
    ratio: consistent ? 1 : 0,
    weight: 3,
    detail: s.noindex ? (s.inSitemap ? "noindex ama sitemap'te" : "Bilerek gizli (noindex), sitemap dışı") : s.inSitemap ? "İndekslenebilir ve sitemap'te" : "İndekslenebilir ama sitemap'te yok",
    fix: s.noindex ? "Sayfayı sitemap'ten çıkarın ya da noindex'i kaldırın." : "Sayfayı sitemap kapsamına alın ya da arama motorlarından gizleyin.",
  });
  let canonRatio = 0;
  let canonDetail = "Canonical yok";
  if (s.canonical) {
    if (!/^https?:\/\//i.test(s.canonical)) {
      canonRatio = 0.25;
      canonDetail = "Canonical göreli adres";
    } else {
      const self = s.canonical.replace(/[?#].*$/, "").replace(/\/+$/, "") === s.url.replace(/[?#].*$/, "").replace(/\/+$/, "");
      canonRatio = self ? 1 : 0.5;
      canonDetail = self ? "Kendine işaret ediyor" : "Başka bir sayfaya işaret ediyor";
    }
  }
  add({ id: "canonical", category: "teknik", label: "Canonical doğru", ratio: canonRatio, weight: 2, detail: canonDetail, fix: "Sayfa kendi mutlak adresini canonical olarak göstermeli." });
  add({ id: "robots", category: "teknik", label: "robots.txt engellemiyor", ratio: s.robotsBlocked ? 0 : 1, weight: 2, detail: s.robotsBlocked ? "robots.txt ile engelli" : "Taranabilir", fix: "robots.txt kuralını kaldırın ya da sayfayı sitemap'ten çıkarın." });
  add({ id: "dup-title", category: "teknik", label: "Başlık benzersiz", ratio: s.dupTitle ? 0 : 1, weight: 1, detail: s.dupTitle ? "Başka sayfayla aynı başlık" : "Benzersiz", fix: "Başlığı bu sayfaya özgü yapın." });
  add({ id: "dup-description", category: "teknik", label: "Açıklama benzersiz", ratio: s.dupDescription ? 0 : 1, weight: 1, detail: s.dupDescription ? "Başka sayfayla aynı açıklama" : "Benzersiz", fix: "Açıklamayı bu sayfaya özgü yapın." });
  add({ id: "https", category: "teknik", label: "Güvenli bağlantı (https, karışık içerik yok)", ratio: s.url.startsWith("https://") && s.mixed === 0 ? 1 : 0, weight: 1, detail: s.mixed > 0 ? `${s.mixed} güvensiz kaynak` : "Güvenli", fix: "Tüm kaynak adreslerini https:// yapın." });

  /* ---------- Sayfa içi ---------- */
  const tv = titlePixelVerdict(s.title ?? "");
  add({ id: "title-px", category: "sayfaIci", label: "Başlık uzunluğu (piksel)", ratio: verdictRatio(tv.verdict), weight: 3, detail: tv.message, fix: tv.px > SERP_PX.titleMax ? `Başlığı ${SERP_PX.titleMax} px altına kısaltın (önemli sözcük başta).` : "Sayfanın konusunu anlatan 30-60 karakterlik bir başlık yazın." });
  const dv = descriptionPixelVerdict(s.description);
  add({ id: "desc-px", category: "sayfaIci", label: "Açıklama uzunluğu (piksel)", ratio: verdictRatio(dv.verdict), weight: 2, detail: dv.message, fix: dv.px > SERP_PX.descMax ? `Açıklamayı ${SERP_PX.descMax} px altına kısaltın.` : "Ziyaretçiye ne bulacağını söyleyen 120-155 karakterlik bir açıklama yazın." });
  add({ id: "h1", category: "sayfaIci", label: "Tek ana başlık (h1)", ratio: s.h1Count === 1 ? 1 : s.h1Count > 1 ? 0.5 : 0, weight: 2, detail: s.h1Count === 0 ? "h1 yok" : `${s.h1Count} h1`, fix: s.h1Count === 0 ? "Sayfaya tek bir h1 ekleyin." : "Tek h1 bırakın, diğerlerini h2 yapın." });
  add({ id: "headings", category: "sayfaIci", label: "Başlık sırası", ratio: s.headingSkip ? 0.5 : 1, weight: 1, detail: s.headingSkip ? `Atlama: ${s.headingSkip}` : "Sıralı", fix: "Ara başlık düzeyini atlamadan sıralayın." });

  if (ctx.topQuery) {
    const q = ctx.topQuery;
    add({ id: "kw-title", category: "sayfaIci", label: "Arama sorgusu başlıkta", ratio: containsPhrase(s.title, q) ? 1 : 0, weight: 2, detail: `Search Console sorgusu: “${q}”`, fix: `Başlıkta “${q}” ifadesi (ya da anlamlı sözcükleri) geçmiyor; Search Console'da bu sayfa en çok bu aramada görünüyor.` });
    add({ id: "kw-h1", category: "sayfaIci", label: "Arama sorgusu h1'de", ratio: containsPhrase(s.h1, q) ? 1 : 0, weight: 1, detail: `“${q}”`, fix: `Ana başlıkta (h1) “${q}” konusunu açıkça söyleyin.` });
    if (path !== "/") add({ id: "kw-url", category: "sayfaIci", label: "Arama sorgusu adreste", ratio: containsPhrase(path.replace(/[/-]/g, " "), q) ? 1 : 0.5, weight: 1, detail: path, fix: "Adres sözcükleri konuyu anlatmıyor; yeni sayfalarda adresi sorguya göre seçin (mevcut adresi değiştirmeyin)." });
  } else if (s.h1 && s.title) {
    const overlap = keyTerms(s.h1).some((t) => containsPhrase(s.title, t));
    add({ id: "kw-topic", category: "sayfaIci", label: "Başlık ve h1 aynı konuda", ratio: overlap ? 1 : 0.4, weight: 2, detail: overlap ? "Ortak anahtar sözcük var" : "Başlık ile h1 ortak sözcük taşımıyor", fix: "Başlık ve h1 aynı ana konuyu (anahtar kelimeyi) söylemeli." });
  }
  if (path !== "/") add({ id: "links-in", category: "sayfaIci", label: "Sayfaya iç bağlantı geliyor", ratio: s.linksIn >= 2 ? 1 : s.linksIn === 1 ? 0.6 : 0, weight: 1, detail: `${s.linksIn} sayfadan bağlantı`, fix: "İlgili sayfalardan bu sayfaya açıklayıcı metinle bağlantı verin." });
  add({ id: "links-out", category: "sayfaIci", label: "Sayfadan iç bağlantı çıkıyor", ratio: s.linksOut >= 3 ? 1 : s.linksOut > 0 ? 0.5 : 0, weight: 1, detail: `${s.linksOut} iç bağlantı`, fix: "Ziyaretçiyi ilgili sayfalara götüren iç bağlantılar ekleyin." });
  if (s.imgs > 0) add({ id: "alt", category: "sayfaIci", label: "Görsel alt metni", ratio: 1 - s.imgsNoAlt / s.imgs, weight: 1, detail: `${s.imgs - s.imgsNoAlt}/${s.imgs} görselde alt metni var`, fix: "Her görsele içeriğini anlatan kısa bir alt metni yazın." });
  if (!s.noindex) {
    const T = SEO_THRESHOLDS.thinContentWords;
    add({ id: "content", category: "sayfaIci", label: "İçerik yeterli", ratio: s.words >= T ? 1 : s.words >= T / 2 ? 0.5 : 0.1, weight: 2, detail: `${s.words} sözcük (en az ${T} önerilir)`, fix: "Ziyaretçinin sorusunu yanıtlayan özgün metin ekleyin (sözcük doldurma değil)." });
  }

  /* ---------- Yapılandırılmış veri ---------- */
  add({ id: "ld-parse", category: "yapisal", label: "JSON-LD ayrıştırılabiliyor", ratio: s.ldParseErrors === 0 ? 1 : 0, weight: 2, detail: s.ldParseErrors === 0 ? "Hatasız" : `${s.ldParseErrors} bozuk blok`, fix: "Bozuk JSON-LD bloğunu düzeltin." });
  add({ id: "ld-errors", category: "yapisal", label: "Zorunlu alanlar tam", ratio: s.ldErrors === 0 ? 1 : Math.max(0, 1 - s.ldErrors / 3), weight: 2, detail: s.ldErrors === 0 ? "Eksik yok" : `${s.ldErrors} hata`, fix: "Yapılandırılmış verideki eksik zorunlu alanı tamamlayın." });
  const expected = expectedTypesFor(path);
  if (expected) {
    const has = expected.types.some((t) => s.ldTypes.includes(t));
    add({ id: "ld-type", category: "yapisal", label: "Sayfaya uygun tür", ratio: has ? 1 : 0, weight: 2, detail: has ? expected.label : `Beklenen: ${expected.label}`, fix: `Sayfaya ${expected.label} yapılandırılmış verisi ekleyin.` });
  }
  if (s.ldTypes.length > 0) add({ id: "ld-recommended", category: "yapisal", label: "Önerilen alanlar", ratio: 1 - Math.min(s.ldWarnings, 5) / 5, weight: 1, detail: s.ldWarnings === 0 ? "Tamam" : `${s.ldWarnings} önerilen alan eksik`, fix: "Önerilen alanları (görsel, adres, telefon, logo) gerçek değerle doldurun." });

  /* ---------- Performans ---------- */
  let perfEstimated = false;
  if (ctx.perf) {
    add({ id: "perf", category: "performans", label: ctx.perf.source === "crux" ? "Gerçek kullanıcı hızı (CrUX)" : "Laboratuvar hızı (PageSpeed)", ratio: ctx.perf.score / 100, weight: 1, detail: `Puan ${Math.round(ctx.perf.score)}/100 (mobil)`, fix: "Hız merkezindeki önerileri uygulayın (görsel boyutu, statik sunum)." });
  } else if (s.ttfbMs !== null || s.bytes > 0) {
    perfEstimated = true;
    if (s.ttfbMs !== null) add({ id: "ttfb", category: "performans", label: "Sunucu yanıt süresi (tahmini)", ratio: s.ttfbMs <= 200 ? 1 : s.ttfbMs <= SEO_THRESHOLDS.slowTtfbMs ? 1 - (s.ttfbMs - 200) / (SEO_THRESHOLDS.slowTtfbMs - 200) / 2 : 0.2, weight: 1, detail: `${s.ttfbMs} ms (robot ölçümü)`, fix: "Sayfayı statik sunuma alın ya da sorguları hızlandırın.", estimated: true });
    if (s.bytes > 0) add({ id: "weight", category: "performans", label: "Sayfa ağırlığı (tahmini)", ratio: s.bytes <= 100 * 1024 ? 1 : s.bytes <= SEO_THRESHOLDS.htmlTooLargeBytes ? 0.6 : 0.2, weight: 1, detail: `HTML ${Math.round(s.bytes / 1024)} KB`, fix: "Sayfaya gömülü veriyi azaltın.", estimated: true });
  }

  /* ---------- Tazelik ---------- */
  if (ctx.lastmod) {
    const t = Date.parse(ctx.lastmod);
    if (Number.isFinite(t)) {
      const days = Math.max(0, Math.floor((ctx.nowMs - t) / 86_400_000));
      add({ id: "fresh", category: "tazelik", label: "İçerik güncel", ratio: days <= 90 ? 1 : days <= 180 ? 0.75 : days <= 365 ? 0.4 : 0.1, weight: 1, detail: `${days} gün önce güncellendi`, fix: "İçeriği gözden geçirip güncel bilgiyle yenileyin." });
    }
  }

  const categories = Object.fromEntries(SCORE_CATEGORIES.map((c) => [c, categoryScore(checks, c)])) as Record<ScoreCategory, number | null>;
  return { url: s.url, path, total: combineCategories(categories), categories, checks, perfEstimated };
}

/* ------------------------------ Site puanı ------------------------------ */

/** Site geneli kritik bulgular (sayfa puanına yansımayan): her biri −10, en çok −30. */
export const SITE_CRITICAL_CODES = ["sitemap-unreachable", "robots-unreachable", "robots-missing-guard", "sitemap-foreign-host"] as const;

export type SiteScore = {
  total: number;
  categories: Record<ScoreCategory, number | null>;
  pages: number;
  penalty: number;
  perfEstimated: boolean;
};

export function pageWeight(p: Pick<PageScore, "path">, s: Pick<PageSnapshot, "inSitemap" | "noindex">): number {
  if (p.path === "/") return 3;
  if (s.inSitemap && !s.noindex) return 1;
  return 0.25;
}

export function scoreSite(items: readonly { score: PageScore; snap: Pick<PageSnapshot, "inSitemap" | "noindex"> }[], siteCriticalCodes: readonly string[]): SiteScore | null {
  if (items.length === 0) return null;
  const penalty = Math.min(30, 10 * siteCriticalCodes.filter((c) => (SITE_CRITICAL_CODES as readonly string[]).includes(c)).length);
  let wSum = 0;
  let tSum = 0;
  const cat: Record<ScoreCategory, { w: number; s: number }> = Object.fromEntries(SCORE_CATEGORIES.map((c) => [c, { w: 0, s: 0 }])) as never;
  for (const { score, snap } of items) {
    const w = pageWeight(score, snap);
    wSum += w;
    tSum += w * score.total;
    for (const c of SCORE_CATEGORIES) {
      const v = score.categories[c];
      if (v === null) continue;
      cat[c].w += w;
      cat[c].s += w * v;
    }
  }
  const categories = Object.fromEntries(SCORE_CATEGORIES.map((c) => [c, cat[c].w > 0 ? Math.round(cat[c].s / cat[c].w) : null])) as Record<ScoreCategory, number | null>;
  return {
    total: Math.max(0, Math.round(tSum / wSum) - penalty),
    categories,
    pages: items.length,
    penalty,
    perfEstimated: items.some((i) => i.score.perfEstimated),
  };
}

/* ------------------------------ Geçmiş ve "neden düştü" ------------------------------ */

/** Saklanan sayfa özeti: puan + başarısız kontrol kimlikleri (önceki koşuyla karşılaştırma için). */
export type PageScoreLite = { url: string; total: number; failed: string[] };

export const toLite = (p: PageScore): PageScoreLite => ({ url: p.url, total: p.total, failed: p.checks.filter((c) => c.ratio < 1).map((c) => c.id) });

export type DropReason = { url: string; before: number; after: number; newlyFailed: string[] };

/** Puanı en az `minDrop` düşen sayfalar ve yeni başarısız kontroller (en çok `limit`, en büyük düşüş önce). */
export function explainDrop(prev: readonly PageScoreLite[], next: readonly PageScoreLite[], opts: { minDrop?: number; limit?: number } = {}): DropReason[] {
  const minDrop = opts.minDrop ?? 3;
  const before = new Map(prev.map((p) => [p.url, p] as const));
  const out: DropReason[] = [];
  for (const n of next) {
    const b = before.get(n.url);
    if (!b || b.total - n.total < minDrop) continue;
    const was = new Set(b.failed);
    out.push({ url: n.url, before: b.total, after: n.total, newlyFailed: n.failed.filter((f) => !was.has(f)) });
  }
  return out.sort((a, b) => b.before - b.after - (a.before - a.after) || a.url.localeCompare(b.url)).slice(0, opts.limit ?? 8);
}

/** Kontrol kimliği → Türkçe etiket ("neden düştü" ekranı). */
export const CHECK_LABEL: Record<string, string> = {
  status: "Sayfa açılmıyor",
  "index-sitemap": "İndeks/sitemap çelişkisi",
  canonical: "Canonical sorunu",
  robots: "robots.txt engeli",
  "dup-title": "Yinelenen başlık",
  "dup-description": "Yinelenen açıklama",
  https: "Güvensiz kaynak",
  "title-px": "Başlık uzunluğu",
  "desc-px": "Açıklama uzunluğu",
  h1: "Ana başlık (h1)",
  headings: "Başlık sırası",
  "kw-title": "Sorgu başlıkta yok",
  "kw-h1": "Sorgu h1'de yok",
  "kw-url": "Sorgu adreste yok",
  "kw-topic": "Başlık/h1 konu uyumu",
  "links-in": "Gelen iç bağlantı az",
  "links-out": "Çıkan iç bağlantı az",
  alt: "Alt metni eksik",
  content: "İnce içerik",
  "ld-parse": "Bozuk JSON-LD",
  "ld-errors": "JSON-LD zorunlu alan",
  "ld-type": "Uygun JSON-LD türü yok",
  "ld-recommended": "JSON-LD önerilen alan",
  perf: "Hız puanı",
  ttfb: "Sunucu yanıt süresi",
  weight: "Sayfa ağırlığı",
  fresh: "İçerik eskidi",
};

export type ScoreGrade = { label: string; tone: "success" | "attention" | "danger" | "neutral" };

export function scoreGrade(n: number | null): ScoreGrade {
  if (n === null) return { label: "Veri yok", tone: "neutral" };
  if (n >= 90) return { label: "Mükemmel", tone: "success" };
  if (n >= 75) return { label: "İyi", tone: "success" };
  if (n >= 50) return { label: "Geliştirilmeli", tone: "attention" };
  return { label: "Zayıf", tone: "danger" };
}

/* ------------------------------ Vitrin (ofis) puanı ------------------------------ */

export type VitrinScoreInput = {
  optin: boolean;
  vitrinEnabled: boolean;
  neverIndex: boolean;
  liveListings: number;
  withPhotos: number;
  withDescription: number;
  hasPhone: boolean;
  hasAddress: boolean;
  hasLogo: boolean;
  /** Robotun bu ofisin vitrin sayfalarına verdiği puanlar (taranmadıysa boş). */
  pageScores: readonly number[];
};

export type VitrinScore = { total: number | null; checks: { label: string; ok: boolean; detail: string; fix: string }[] };

export function scoreVitrin(v: VitrinScoreInput): VitrinScore {
  if (!v.vitrinEnabled) return { total: null, checks: [{ label: "Vitrin açık", ok: false, detail: "Ofis vitrinini kapatmış", fix: "Vitrin kapalıyken arama görünürlüğü yoktur." }] };
  const pct = (a: number, b: number) => (b > 0 ? a / b : 0);
  const items: { label: string; ratio: number; w: number; detail: string; fix: string }[] = [
    { label: "Arama onayı", ratio: v.optin && !v.neverIndex ? 1 : 0, w: 25, detail: v.neverIndex ? "Kalıcı noindex listesinde" : v.optin ? "Ofis onay verdi" : "Ofis onay vermedi", fix: "Ofis Ayarlar > Vitrin'den “vitrinim aramalarda görünsün” onayını verebilir." },
    { label: "Yayındaki ilan", ratio: v.liveListings >= 10 ? 1 : v.liveListings / 10, w: 20, detail: `${v.liveListings} ilan`, fix: "Daha fazla ilanı vitrinde yayınlayın." },
    { label: "Fotoğraflı ilan oranı", ratio: pct(v.withPhotos, v.liveListings), w: 15, detail: `${v.withPhotos}/${v.liveListings}`, fix: "Fotoğrafsız ilanlara fotoğraf ekleyin." },
    { label: "Açıklamalı ilan oranı", ratio: pct(v.withDescription, v.liveListings), w: 15, detail: `${v.withDescription}/${v.liveListings}`, fix: "İlanlara özgün açıklama yazın (kopya metin değil)." },
    { label: "Ofis bilgileri (telefon, adres, logo)", ratio: ([v.hasPhone, v.hasAddress, v.hasLogo].filter(Boolean).length) / 3, w: 10, detail: [v.hasPhone ? "telefon" : null, v.hasAddress ? "adres" : null, v.hasLogo ? "logo" : null].filter(Boolean).join(", ") || "eksik", fix: "Ofis telefonu, açık adresi ve logosu yerel aramada (LocalBusiness) gereklidir." },
  ];
  if (v.pageScores.length > 0) {
    const avg = v.pageScores.reduce((s, n) => s + n, 0) / v.pageScores.length;
    items.push({ label: "Taranan vitrin sayfaları", ratio: avg / 100, w: 15, detail: `${v.pageScores.length} sayfa, ortalama ${Math.round(avg)}`, fix: "Sayfa sekmesindeki önerileri uygulayın." });
  }
  const w = items.reduce((s, i) => s + i.w, 0);
  const total = Math.round((100 * items.reduce((s, i) => s + i.w * Math.max(0, Math.min(1, i.ratio)), 0)) / w);
  return { total, checks: items.map((i) => ({ label: i.label, ok: i.ratio >= 0.999, detail: i.detail, fix: i.fix })) };
}
