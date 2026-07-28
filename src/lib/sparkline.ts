/**
 * Sparkline geometrisi — saf fonksiyon, paket yok.
 *
 * Dashboard'daki yerel `Sparkline` bileşeni ile `StatCard`'ın yeni
 * `sparkline` prop'u aynı hesabı iki kez yapmasın diye buraya alındı.
 * Render'dan bağımsız (DOM/zaman yok) olduğu için birim testi yazılabiliyor.
 *
 * Koordinat sistemi: viewBox `0 0 width height`, y ekseni aşağı doğru —
 * yani en BÜYÜK veri noktası en KÜÇÜK y değerini alır.
 */

export type SparklineGeometry = {
  /** `<polyline points="...">` için "x,y x,y ..." dizesi */
  points: string;
  /** `<polygon points="...">` için kapalı alan (tabana inen) */
  area: string;
  /** Son noktanın koordinatı — uç nokta işareti (nokta/halka) için */
  last: { x: number; y: number };
  /** Ham koordinatlar (özel çizim gerekirse) */
  coords: Array<{ x: number; y: number }>;
  /** Serideki tüm değerler eşitse true — "düz çizgi" durumu */
  flat: boolean;
};

export type SparklineOptions = {
  /** viewBox genişliği (varsayılan 100) */
  width?: number;
  /** viewBox yüksekliği (varsayılan 28) */
  height?: number;
  /** Üst/alt güvenlik payı — çizgi kalınlığı kırpılmasın (varsayılan 2) */
  padding?: number;
};

/**
 * Sayı dizisinden sparkline geometrisi üretir.
 *
 * Sınır durumları:
 * - Boş dizi → tek noktalı düz çizgi (görünürde yatay bir çizgi kalır).
 * - Tek eleman → orta noktaya yerleşir, dikey olarak ortalanır.
 * - Tüm değerler eşit → `flat: true`, çizgi dikey olarak ortalanır
 *   (aksi halde 0'a bölme olur ya da çizgi tabana yapışırdı).
 * - Negatif değerler desteklenir; ölçek min-max aralığına göre normalize edilir.
 */
export function sparklineGeometry(
  data: readonly number[],
  options: SparklineOptions = {},
): SparklineGeometry {
  const width = options.width ?? 100;
  const height = options.height ?? 28;
  const padding = options.padding ?? 2;

  const safe = data.length > 0 ? data.filter((n) => Number.isFinite(n)) : [];
  const series = safe.length > 0 ? safe : [0];

  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = max - min;
  const flat = range === 0;

  const usable = Math.max(0, height - padding * 2);

  const coords = series.map((value, index) => {
    const x = series.length === 1 ? width / 2 : (index / (series.length - 1)) * width;
    // Düz seride oran hesaplanamaz; çizgiyi dikey ortaya al.
    const ratio = flat ? 0.5 : (value - min) / range;
    const y = height - padding - ratio * usable;
    return { x: round(x), y: round(y) };
  });

  const points = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const area = `0,${height} ${points} ${width},${height}`;

  return {
    points,
    area,
    last: coords[coords.length - 1]!,
    coords,
    flat,
  };
}

/** SVG çıktısını kısa tutmak için 2 ondalığa yuvarlar (-0 normalize edilir). */
function round(n: number) {
  return Math.round(n * 100) / 100 + 0;
}

/**
 * Trend yüzdesi — önceki döneme göre değişim.
 * Önceki dönem 0 ise oran tanımsızdır: bu durumda `null` döner ve arayüz
 * "%0" yerine "yeni" gösterir (sahte yüzde üretmeme kuralı).
 */
export function trendPercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
