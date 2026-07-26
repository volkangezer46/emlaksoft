/**
 * Günün rotası — saf hesap fonksiyonları (UI'sız, saat okumasız).
 *
 * İlke: randevular SAATLİDİR; sıralama daima saat sırasıdır, gezgin satıcı
 * optimizasyonu YAPILMAZ. Bunun yerine ardışık duraklar arası kuş uçuşu
 * (haversine) mesafe, şehir içi ortalama hızla (40 km/s) tahmini yol süresi
 * ve iki randevu arasındaki boşluk karşılaştırılır — boşluk tahmini yol
 * süresinden kısaysa "sıkışık geçiş" uyarısı üretilir.
 *
 * Polyline mantığıyla birebir: koordinatı olmayan duraklar bacak (leg)
 * hesabında ATLANIR; bir durağın bacağı, ondan önceki koordinatlı durağa
 * çizilir (haritadaki çizgiyle aynı).
 */

export const CITY_SPEED_KMH = 40;
/** Süresi girilmemiş randevu için varsayım (dk) — appointments çakışma freniyle aynı. */
export const DEFAULT_DURATION_MIN = 60;

export type RoutePlanStop = {
  id: string;
  /** ISO scheduled_at */
  scheduledAt: string;
  durationMin: number | null;
  lat: number | null;
  lng: number | null;
};

export type RouteLeg = {
  /** Bacağın başladığı (bir önceki koordinatlı) durak. */
  fromId: string;
  /** Bacağın bittiği durak. */
  toId: string;
  /** Kuş uçuşu mesafe (km). */
  distanceKm: number;
  /** CITY_SPEED_KMH ile tahmini yol süresi (dk, yukarı yuvarlanır). */
  travelMin: number;
  /** Önceki randevunun bitişi ile bu randevunun başlangıcı arası boşluk (dk; örtüşmede negatif). */
  gapMin: number;
  /** Boşluk tahmini yol süresini karşılamıyor → "Sıkışık geçiş". */
  tight: boolean;
};

export type RoutePlan = {
  /** Saat sırasına dizilmiş duraklar (girdi mutasyona uğramaz). */
  stops: RoutePlanStop[];
  /**
   * `legs[i]` — `stops[i]`e VARIŞ bacağı; `stops[i]` koordinatsızsa ya da
   * öncesinde koordinatlı durak yoksa `null`. `legs[0]` daima `null`.
   */
  legs: (RouteLeg | null)[];
  /** Tüm bacakların toplamı (km). */
  totalKm: number;
  /** Sıkışık geçiş sayısı. */
  tightCount: number;
};

/** İki nokta arası kuş uçuşu mesafe (km) — haversine. */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Kuş uçuşu km → tahmini şehir içi yol süresi (dk, yukarı yuvarlanır). */
export function travelMinutes(km: number, speedKmh: number = CITY_SPEED_KMH): number {
  if (km <= 0 || speedKmh <= 0) return 0;
  return Math.ceil((km / speedKmh) * 60);
}

function hasCoords(s: RoutePlanStop): s is RoutePlanStop & { lat: number; lng: number } {
  return s.lat != null && s.lng != null;
}

/** Saat sırası SABİT rota planı: bacak mesafeleri + sıkışık geçiş bayrakları. */
export function buildRoutePlan(input: RoutePlanStop[]): RoutePlan {
  const stops = [...input].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const legs: (RouteLeg | null)[] = stops.map(() => null);
  let totalKm = 0;
  let tightCount = 0;

  let prevCoordIdx = -1;
  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i];
    if (!hasCoords(stop)) continue;
    if (prevCoordIdx >= 0) {
      const prev = stops[prevCoordIdx] as RoutePlanStop & { lat: number; lng: number };
      const distanceKm = haversineKm(prev.lat, prev.lng, stop.lat, stop.lng);
      const travelMin = travelMinutes(distanceKm);
      const prevEndMs =
        Date.parse(prev.scheduledAt) + (prev.durationMin ?? DEFAULT_DURATION_MIN) * 60_000;
      const gapMin = Math.round((Date.parse(stop.scheduledAt) - prevEndMs) / 60_000);
      const tight = gapMin < travelMin;
      legs[i] = { fromId: prev.id, toId: stop.id, distanceKm, travelMin, gapMin, tight };
      totalKm += distanceKm;
      if (tight) tightCount += 1;
    }
    prevCoordIdx = i;
  }

  return { stops, legs, totalKm, tightCount };
}
