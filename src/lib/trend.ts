/**
 * DEĞİŞİM (TREND) KURALI — tek tanım (kartlar, raporlar, ana ekran aynı kuralı kullanır; saf, vitest: trend.test.ts).
 *
 * Yüzde yalnız karşılaştırma tabanı ANLAMLIYKEN yazılır; aksi halde okunaklı bir söz kullanılır:
 *  - önceki dönem 0 (ya da yok) ve bu dönem > 0 → "yeni" (yüzde YAZILMAZ; "%6300" gibi anlamsız oran çıkmaz)
 *  - önceki ve bu dönem 0 → değişim yok (rozet çizilmez: null)
 *  - büyüme 3 katı ve üstü → "3,2 kat" (50 katın üstünde önceki dönem ihmal edilebilir sayılır → "yeni")
 *  - aksi halde yuvarlanmış yüzde: "%12"
 * `invert`: azalış iyidir (ör. satış süresi, gecikme sayısı).
 */

export type TrendKind = "pct" | "times" | "new";

export type Trend = {
  /** Mutlak yüzde (yalnız `kind === "pct"` iken anlamlı; diğerlerinde 0). */
  pct: number;
  dir: "up" | "down" | "flat";
  good: boolean;
  kind: TrendKind;
  /** Rozet metni: "%12" · "3,2 kat" · "yeni". */
  text: string;
  /** Ekran okuyucu cümlesi ("%12 artış", "3,2 kat artış", "önceki dönemde kayıt yoktu"). */
  spoken: string;
};

/** "x kat" ifadesine geçilen oran (bu dönem / önceki dönem). */
export const TREND_TIMES_FROM = 3;
/** Bu oranın üstünde önceki dönem ihmal edilebilir sayılır → "yeni". */
export const TREND_TIMES_MAX = 50;

const fmt1 = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: n >= 10 ? 0 : 1 });

export function trendOf(cur: number, prev: number, opts: { invert?: boolean } = {}): Trend | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  const invert = Boolean(opts.invert);
  const goodFor = (dir: Trend["dir"]) => (dir === "flat" ? true : invert ? dir === "down" : dir === "up");
  if (prev <= 0) {
    if (cur <= 0) return null;
    return { pct: 0, dir: "up", good: goodFor("up"), kind: "new", text: "yeni", spoken: "önceki dönemde kayıt yoktu, bu dönem yeni" };
  }
  const ratio = cur / prev;
  if (ratio > TREND_TIMES_MAX) {
    return { pct: 0, dir: "up", good: goodFor("up"), kind: "new", text: "yeni", spoken: "önceki dönem çok düşüktü, bu dönem yeni" };
  }
  if (ratio >= TREND_TIMES_FROM) {
    const t = fmt1(Math.floor(ratio * 10) / 10);
    return { pct: 0, dir: "up", good: goodFor("up"), kind: "times", text: `${t} kat`, spoken: `${t} kat artış` };
  }
  const signed = Math.round((ratio - 1) * 100);
  const dir: Trend["dir"] = signed > 0 ? "up" : signed < 0 ? "down" : "flat";
  const pct = Math.abs(signed);
  const word = dir === "up" ? "artış" : dir === "down" ? "azalış" : "değişim yok";
  return { pct, dir, good: goodFor(dir), kind: "pct", text: `%${pct}`, spoken: dir === "flat" ? word : `%${pct} ${word}` };
}

/**
 * Ortalama süre (gün): yalnız gerçekten süre taşıyan kayıtlardan (başlangıç < bitiş). Hiç kayıt yoksa ya da ortalama
 * 1 günün altındaysa (aynı gün açılıp kapanmış — çoğu kez toplu/geriye dönük veri girişi) null: kart "—" gösterir ve
 * yanına `AVG_DAYS_EMPTY_NOTE` açıklaması yazılır; "0 gün" ve "↘%100" gibi yanıltıcı değerler üretilmez.
 */
export function averageDays(pairs: readonly { start: string | null; end: string | null }[], dayMs = 86_400_000): number | null {
  const ds: number[] = [];
  for (const p of pairs) {
    if (!p.start || !p.end) continue;
    const a = Date.parse(p.start);
    const b = Date.parse(p.end);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    ds.push((b - a) / dayMs);
  }
  if (ds.length === 0) return null;
  const avg = ds.reduce((s, v) => s + v, 0) / ds.length;
  return avg < 1 ? null : Math.round(avg);
}

export const AVG_DAYS_EMPTY_NOTE = "Hesaplamak için açılış ve kapanış tarihi farklı satış gerekir";
