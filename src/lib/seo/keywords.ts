/**
 * ANAHTAR KELİME ANALİZİ (SAF). Girdi yalnız Search Console verisidir (`seo_gsc_keyword_pairs`: sorgu × sayfa, güncel
 * ve önceki eşit pencere). "Arama hacmi" UYDURULMAZ: hacim yerine Google'ın verdiği GÖSTERİM kullanılır. Ek tıklama
 * kestirimi bilinen pozisyon-CTR eğrisinden yapılır ve ekranda "tahmini" etiketlidir.
 */

export type KwPair = {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  position: number | null;
  prevClicks: number;
  prevImpressions: number;
  prevPosition: number | null;
};

export type QueryRow = {
  query: string;
  clicks: number;
  impressions: number;
  position: number | null;
  prevClicks: number;
  prevImpressions: number;
  prevPosition: number | null;
  pages: number;
  topPage: string;
};

/** Pozisyon başına tahmini tıklama oranı (genel sektör eğrisi; TAHMİN). */
export function expectedCtrAt(position: number): number {
  const p = Math.max(1, Math.round(position));
  const table = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
  if (p <= 10) return table[p - 1]!;
  if (p <= 20) return 0.01;
  return 0.004;
}

const wavg = (pairs: readonly { v: number | null; w: number }[]) => {
  let w = 0;
  let s = 0;
  for (const p of pairs) {
    if (p.v === null || p.w <= 0) continue;
    w += p.w;
    s += p.v * p.w;
  }
  return w > 0 ? s / w : null;
};

/** Sorgu düzeyinde toplam (pozisyon gösterim ağırlıklı); en çok gösterim alan sayfa `topPage`. */
export function aggregateQueries(pairs: readonly KwPair[]): QueryRow[] {
  const by = new Map<string, KwPair[]>();
  for (const p of pairs) {
    const k = p.query.trim();
    if (!k) continue;
    by.set(k, [...(by.get(k) ?? []), p]);
  }
  const out: QueryRow[] = [];
  for (const [query, list] of by) {
    const top = [...list].sort((a, b) => b.impressions - a.impressions || a.page.localeCompare(b.page))[0]!;
    out.push({
      query,
      clicks: list.reduce((s, p) => s + p.clicks, 0),
      impressions: list.reduce((s, p) => s + p.impressions, 0),
      position: wavg(list.map((p) => ({ v: p.position, w: p.impressions }))),
      prevClicks: list.reduce((s, p) => s + p.prevClicks, 0),
      prevImpressions: list.reduce((s, p) => s + p.prevImpressions, 0),
      prevPosition: wavg(list.map((p) => ({ v: p.prevPosition, w: p.prevImpressions }))),
      pages: list.filter((p) => p.impressions > 0).length,
      topPage: top.page,
    });
  }
  return out.sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query, "tr"));
}

export type Mover = QueryRow & { delta: number };

/**
 * Kazananlar / kaybedenler: iki pencerede de en az `minImpressions` gösterim alan sorgularda pozisyon değişimi
 * (pozitif = yükseldi). Sıralama: |değişim| × log(gösterim) — çok gösterimli küçük hareket de görünür.
 */
export function winnersLosers(rows: readonly QueryRow[], opts: { minImpressions?: number; limit?: number } = {}): { winners: Mover[]; losers: Mover[] } {
  const min = opts.minImpressions ?? 20;
  const limit = opts.limit ?? 10;
  const movers = rows
    .filter((r) => r.position !== null && r.prevPosition !== null && r.impressions >= min && r.prevImpressions >= min)
    .map((r) => ({ ...r, delta: Math.round(((r.prevPosition as number) - (r.position as number)) * 10) / 10 }))
    .filter((r) => Math.abs(r.delta) >= 0.5);
  const rank = (m: Mover) => Math.abs(m.delta) * Math.log10(10 + m.impressions);
  return {
    winners: movers.filter((m) => m.delta > 0).sort((a, b) => rank(b) - rank(a) || a.query.localeCompare(b.query, "tr")).slice(0, limit),
    losers: movers.filter((m) => m.delta < 0).sort((a, b) => rank(b) - rank(a) || a.query.localeCompare(b.query, "tr")).slice(0, limit),
  };
}

export type Opportunity = QueryRow & { position: number; extraClicks: number };

/** FIRSAT: pozisyon 4–20, gösterim ≥ `minImpressions`. Tahmini ek tıklama = gösterim × (CTR@3 − mevcut CTR). */
export function opportunities(rows: readonly QueryRow[], opts: { minImpressions?: number; limit?: number } = {}): Opportunity[] {
  const min = opts.minImpressions ?? 50;
  return rows
    .filter((r): r is QueryRow & { position: number } => r.position !== null && r.position >= 4 && r.position <= 20 && r.impressions >= min)
    .map((r) => {
      const current = r.impressions > 0 ? r.clicks / r.impressions : 0;
      return { ...r, extraClicks: Math.max(0, Math.round(r.impressions * (expectedCtrAt(3) - Math.max(current, expectedCtrAt(r.position))))) };
    })
    .sort((a, b) => b.extraClicks - a.extraClicks || b.impressions - a.impressions || a.query.localeCompare(b.query, "tr"))
    .slice(0, opts.limit ?? 20);
}

export type Cannibal = { query: string; impressions: number; pages: { page: string; impressions: number; share: number; position: number | null }[] };

/**
 * YAMYAMLIK: aynı sorguda en az iki sayfa, her biri sorgu gösteriminin ≥ %`minShare`'ini ve ≥ `minImpressions`
 * gösterimi alıyor. Google iki sayfa arasında gidip geliyor demektir; tek sayfada birleştirme önerilir.
 */
export function cannibalization(pairs: readonly KwPair[], opts: { minShare?: number; minImpressions?: number; limit?: number } = {}): Cannibal[] {
  const minShare = opts.minShare ?? 0.15;
  const minImp = opts.minImpressions ?? 10;
  const by = new Map<string, KwPair[]>();
  for (const p of pairs) if (p.query.trim() && p.impressions > 0) by.set(p.query.trim(), [...(by.get(p.query.trim()) ?? []), p]);
  const out: Cannibal[] = [];
  for (const [query, list] of by) {
    const total = list.reduce((s, p) => s + p.impressions, 0);
    const pages = list
      .map((p) => ({ page: p.page, impressions: p.impressions, share: total > 0 ? p.impressions / total : 0, position: p.position }))
      .filter((p) => p.share >= minShare && p.impressions >= minImp)
      .sort((a, b) => b.impressions - a.impressions || a.page.localeCompare(b.page));
    if (pages.length >= 2) out.push({ query, impressions: total, pages });
  }
  return out.sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query, "tr")).slice(0, opts.limit ?? 20);
}

/** Sayfa adresi → en çok gösterim aldığı sorgu (puanlamada "anahtar kelime başlıkta mı" kontrolü). */
export function topQueryByPage(pairs: readonly KwPair[], minImpressions = 10): Map<string, string> {
  const best = new Map<string, KwPair>();
  for (const p of pairs) {
    if (p.impressions < minImpressions || !p.query.trim()) continue;
    const key = p.page.replace(/\/+$/, "");
    const cur = best.get(key);
    if (!cur || p.impressions > cur.impressions || (p.impressions === cur.impressions && p.query < cur.query)) best.set(key, p);
  }
  return new Map([...best].map(([k, v]) => [k, v.query.trim()]));
}
