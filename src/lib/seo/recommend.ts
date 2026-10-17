import { seoHref, seoPageEditorHref } from "./admin-links";
import type { Cannibal, KwPair, Opportunity } from "./keywords";
import { CATEGORY_WEIGHT, type PageScore, type ScoreCheck } from "./score";

/**
 * TAVSİYE MOTORU (SAF). Yalnız gerçek sinyallerden öncelikli iş listesi üretir: sayfa puanındaki başarısız kontroller,
 * Search Console fırsatları ve yamyamlık. Öncelik = ETKİ (1–5) × KOLAYLIK (1–5). Etki: kontrolün puandaki payı ×
 * sayfanın önemi (ana sayfa, sitemap sayfası, gösterim). Kolaylık: düzeltmenin türü (meta metni kolay, içerik zor).
 * Tahmin içeren her öneri `estimate` metni taşır ve ekranda "tahmini" etiketlenir. Her öneri düzeltme ekranına bağlıdır.
 */

export type RecSource = "puan" | "arama" | "yamyamlik";

export type Recommendation = {
  id: string;
  source: RecSource;
  path: string;
  title: string;
  detail: string;
  impact: number;
  ease: number;
  priority: number;
  href: string;
  hrefLabel: string;
  estimate?: string;
};

/** Kontrol → kolaylık (5 = birkaç dakikalık metin değişikliği). */
const EASE: Record<string, number> = {
  "title-px": 5,
  "desc-px": 5,
  "kw-title": 5,
  "kw-h1": 4,
  "kw-topic": 4,
  "kw-url": 1,
  "dup-title": 5,
  "dup-description": 5,
  canonical: 3,
  "index-sitemap": 4,
  robots: 4,
  status: 3,
  https: 3,
  h1: 3,
  headings: 3,
  alt: 4,
  "links-in": 3,
  "links-out": 3,
  content: 2,
  "ld-parse": 3,
  "ld-errors": 3,
  "ld-type": 3,
  "ld-recommended": 3,
  perf: 2,
  ttfb: 2,
  weight: 2,
  fresh: 2,
};

const fmt = (n: number) => n.toLocaleString("tr-TR");

/** Kontrolün düzeltileceği ekran (registry sayfası meta editörü; vitrin/rehber/hız kendi ekranı). */
export function fixTarget(check: Pick<ScoreCheck, "id" | "category">, path: string, isRegistry: boolean): { href: string; label: string } {
  if (check.category === "performans") return { href: "/admin/site/hiz", label: "Hız merkezi" };
  if (path.startsWith("/rehber/")) return { href: "/admin/site/rehber", label: "Rehber editörü" };
  if (path.startsWith("/emlak/")) return { href: seoHref("programatik"), label: "Programatik sayfalar" };
  if (path.startsWith("/vitrin/") || path.startsWith("/danisman/")) return { href: seoHref("sayfalar", "kaliplar"), label: "Vitrin kalıpları" };
  if (check.category === "yapisal") return isRegistry ? { href: seoPageEditorHref(path), label: "Sayfa SEO kaydı" } : { href: seoHref("tarama", "veri"), label: "Yapılandırılmış veri" };
  if (check.id === "index-sitemap" || check.id === "robots") return { href: seoHref("tarama", "sitemap"), label: "Sitemap ve robots" };
  if (check.id === "status") return { href: seoHref("tarama", "yonlendirme"), label: "Yönlendirmeler" };
  if (isRegistry) return { href: seoPageEditorHref(path), label: "Sayfa SEO kaydı" };
  return { href: "/admin/site/sayfalar", label: "İçerik" };
}

/** Sayfanın önemi (1–3): ana sayfa 3, gösterim alan sayfa 2–3, diğer sitemap sayfası 1,5, gizli sayfa 0,5. */
export function pageImportance(path: string, opts: { inSitemap: boolean; noindex: boolean; impressions: number }): number {
  if (path === "/") return 3;
  if (opts.noindex) return 0.5;
  const imp = opts.impressions >= 1000 ? 3 : opts.impressions >= 100 ? 2.5 : opts.impressions > 0 ? 2 : 1.5;
  return opts.inSitemap ? imp : Math.min(imp, 1);
}

const clamp15 = (n: number) => Math.max(1, Math.min(5, Math.round(n)));

export type RecommendInput = {
  pages: readonly { score: PageScore; inSitemap: boolean; noindex: boolean; isRegistry: boolean }[];
  /** Sayfa yolu → 28 günlük gösterim (GSC; yoksa boş). */
  impressionsByPath?: ReadonlyMap<string, number>;
  /** Sayfa yolu → en çok gösterim aldığı sorgu ve gösterimi. */
  topQueryByPath?: ReadonlyMap<string, { query: string; impressions: number }>;
  opportunities?: readonly Opportunity[];
  cannibals?: readonly Cannibal[];
  limit?: number;
};

export function recommend(input: RecommendInput): Recommendation[] {
  const out: Recommendation[] = [];
  for (const { score, inSitemap, noindex, isRegistry } of input.pages) {
    const imp = input.impressionsByPath?.get(score.path) ?? 0;
    const importance = pageImportance(score.path, { inSitemap, noindex, impressions: imp });
    const catW = (c: ScoreCheck) => CATEGORY_WEIGHT[c.category] / 30; // 0.33–1
    const checkWeightSum = (cat: ScoreCheck["category"]) => score.checks.filter((c) => c.category === cat).reduce((s, c) => s + c.weight, 0) || 1;
    for (const c of score.checks) {
      if (c.ratio >= 1 || !c.fix) continue;
      // Kontrolün sayfa puanına kaybettirdiği pay (0–1) × kategori ağırlığı × sayfa önemi.
      const lost = ((1 - c.ratio) * c.weight) / checkWeightSum(c.category);
      const impact = clamp15(lost * catW(c) * importance * 5 + 0.5);
      const ease = EASE[c.id] ?? 3;
      const target = fixTarget(c, score.path, isRegistry);
      const q = input.topQueryByPath?.get(score.path);
      let title = `${score.path}: ${c.label.toLocaleLowerCase("tr-TR")} — ${c.detail}`;
      let detail = c.fix;
      if ((c.id === "kw-title" || c.id === "kw-h1") && q) {
        title = `${score.path}: ${c.id === "kw-title" ? "başlıkta" : "ana başlıkta (h1)"} “${q.query}” geçmiyor`;
        detail = `Bu sayfa son 28 günde “${q.query}” aramasında ${fmt(q.impressions)} kez gösterildi (Search Console). ${c.fix}`;
      }
      out.push({
        id: `puan:${score.path}:${c.id}`,
        source: "puan",
        path: score.path,
        title,
        detail,
        impact,
        ease,
        priority: impact * ease,
        href: target.href,
        hrefLabel: target.label,
        estimate: c.estimated ? "Ölçüm tahminidir (laboratuvar hız verisi yok)." : undefined,
      });
    }
  }

  for (const o of input.opportunities ?? []) {
    const path = pathOf(o.topPage);
    const impact = clamp15(o.extraClicks >= 200 ? 5 : o.extraClicks >= 50 ? 4 : o.extraClicks >= 15 ? 3 : 2);
    out.push({
      id: `arama:${o.query}`,
      source: "arama",
      path,
      title: `“${o.query}” aramasında ${o.position.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}. sıradasınız`,
      detail: `${fmt(o.impressions)} gösterim, ${fmt(o.clicks)} tıklama (28 gün). ${path} sayfasının başlığını ve ilk paragrafını bu aramaya göre güçlendirin, ilgili sayfalardan bu ifadeyle bağlantı verin.`,
      impact,
      ease: 3,
      priority: impact * 3,
      href: seoHref("kelimeler", "analiz", {}, "firsatlar"),
      hrefLabel: "Anahtar kelimeler",
      estimate: o.extraClicks > 0 ? `İlk 3'e çıkarsa ayda tahmini +${fmt(o.extraClicks)} tıklama (genel tıklama oranı eğrisinden).` : undefined,
    });
  }

  for (const c of input.cannibals ?? []) {
    const impact = clamp15(c.impressions >= 1000 ? 4 : c.impressions >= 200 ? 3 : 2);
    out.push({
      id: `yamyamlik:${c.query}`,
      source: "yamyamlik",
      path: pathOf(c.pages[0]!.page),
      title: `“${c.query}” aramasında ${c.pages.length} sayfanız yarışıyor`,
      detail: `${c.pages.map((p) => pathOf(p.page)).join(", ")} aynı aramada birbirinin gösterimini bölüyor. Birini bu aramanın ana sayfası yapın, diğerinden ona bağlantı verin (içerik çakışıyorsa birleştirin).`,
      impact,
      ease: 2,
      priority: impact * 2,
      href: seoHref("kelimeler", "analiz", {}, "yamyamlik"),
      hrefLabel: "Anahtar kelimeler",
    });
  }

  return out.sort((a, b) => b.priority - a.priority || b.impact - a.impact || a.id.localeCompare(b.id)).slice(0, input.limit ?? 50);
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return url;
  }
}

/** GSC çiftlerinden yol → toplam gösterim ve en çok gösterim alan sorgu. */
export function gscPathMaps(pairs: readonly KwPair[]): { impressions: Map<string, number>; topQuery: Map<string, { query: string; impressions: number }> } {
  const impressions = new Map<string, number>();
  const topQuery = new Map<string, { query: string; impressions: number }>();
  for (const p of pairs) {
    const path = pathOf(p.page);
    impressions.set(path, (impressions.get(path) ?? 0) + p.impressions);
    const cur = topQuery.get(path);
    if (p.query.trim() && (!cur || p.impressions > cur.impressions)) topQuery.set(path, { query: p.query.trim(), impressions: p.impressions });
  }
  return { impressions, topQuery };
}
