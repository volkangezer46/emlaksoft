import type { HealthWeights, ListingControlConfig } from "./config";
import { DEFAULT_LISTING_CONTROL_CONFIG } from "./config";
import type { HealthColor } from "./types";

/**
 * İLAN SAĞLIK SKORU 0-100 (SAF). Ağırlıklar ofis ayarlıdır (`HealthWeights`, varsayılan toplam 100).
 * Bileşen değeri 0..1 ya da `null` (ÖLÇÜLEMEDİ). Ölçülemeyen bileşen paydadan çıkar ve `partial=true` olur:
 * kullanıcı cezalandırılmaz, "ölçülemedi" açıkça gösterilir (photo-quality ile aynı ilke; sahte skor yok).
 * Her bileşen gerekçesiyle döner (`components`) — ekranda skor açıklanabilir.
 *
 * Renk: ≥85 yeşil (sağlıklı), 60-84 sarı (kontrol bekliyor), 40-59 turuncu (uyuşmazlık), <40 kırmızı (kritik),
 * ölçüm yok gri (kontrol edilemiyor). Eşikler ayarlanabilir.
 */

export type HealthInputs = {
  /** Aktif portföyün en az bir canlı ve doğrulanmış (verified) portal ilanı var mı. null = hiç kontrol yok. */
  onPortal: number | null;
  /** 1 = tüm portal fiyatları CRM fiyatıyla uyumlu, 0 = kritik fark; null = portal fiyatı bilinmiyor. */
  price: number | null;
  advisor: number | null;
  authority: number | null;
  /** photo-quality skoru / 100 ya da null. */
  photos: number | null;
  freshness: number | null;
  idUrlValid: number | null;
  contact: number | null;
  eids: number | null;
  checkRecency: number | null;
};

export type HealthComponent = { key: keyof HealthWeights; label: string; weight: number; value: number | null; points: number };

export type HealthResult = {
  /** 0-100; hiçbir bileşen ölçülemediyse null. */
  score: number | null;
  color: HealthColor;
  partial: boolean;
  components: HealthComponent[];
};

const LABELS: Record<keyof HealthWeights, string> = {
  onPortal: "Portalda aktif",
  price: "Fiyat tutarlılığı",
  advisor: "Danışman atanmış ve aktif",
  authority: "Yetki belgesi geçerli",
  photos: "Fotoğraf kalitesi",
  freshness: "Son güncelleme",
  idUrlValid: "İlan no / bağlantı geçerli",
  contact: "İletişim / ilan sahibi bilgisi",
  eids: "EİDS / yetki belge bilgisi",
  checkRecency: "Son kontrol başarılı",
};

export function colorForScore(score: number | null, colors: ListingControlConfig["healthColors"]): HealthColor {
  if (score === null) return "gray";
  if (score >= colors.green) return "green";
  if (score >= colors.yellow) return "yellow";
  if (score >= colors.orange) return "orange";
  return "red";
}

export function computeHealthScore(
  inputs: HealthInputs,
  weights: HealthWeights = DEFAULT_LISTING_CONTROL_CONFIG.healthWeights,
  colors: ListingControlConfig["healthColors"] = DEFAULT_LISTING_CONTROL_CONFIG.healthColors,
): HealthResult {
  const keys = Object.keys(LABELS) as (keyof HealthWeights)[];
  let measuredWeight = 0;
  let earned = 0;
  let partial = false;
  const components: HealthComponent[] = [];
  for (const key of keys) {
    const w = weights[key];
    const raw = inputs[key];
    if (w <= 0) {
      components.push({ key, label: LABELS[key], weight: 0, value: raw, points: 0 });
      continue;
    }
    if (raw === null || !Number.isFinite(raw)) {
      partial = true;
      components.push({ key, label: LABELS[key], weight: w, value: null, points: 0 });
      continue;
    }
    const v = Math.min(1, Math.max(0, raw));
    measuredWeight += w;
    earned += w * v;
    components.push({ key, label: LABELS[key], weight: w, value: v, points: Math.round(w * v * 10) / 10 });
  }
  const score = measuredWeight > 0 ? Math.round((earned / measuredWeight) * 100) : null;
  return { score, color: colorForScore(score, colors), partial, components };
}

/** Tazelik: ≤30 gün 1, 30-90 gün doğrusal düşer, ≥90 gün 0. */
export function freshnessValue(daysSinceUpdate: number | null): number | null {
  if (daysSinceUpdate === null || !Number.isFinite(daysSinceUpdate)) return null;
  if (daysSinceUpdate <= 30) return 1;
  if (daysSinceUpdate >= 90) return 0;
  return 1 - (daysSinceUpdate - 30) / 60;
}

/** Fiyat tutarlılığı: oran ≤ tolerans 1, ≥ kritik 0, arası doğrusal. Portal fiyatı yoksa null. */
export function priceConsistencyValue(
  crmPrice: number | null,
  portalPrices: readonly number[],
  tolerance: number,
  critical: number,
): number | null {
  if (!crmPrice || crmPrice <= 0 || portalPrices.length === 0) return null;
  const worst = Math.max(...portalPrices.map((p) => Math.abs(p - crmPrice) / crmPrice));
  if (worst <= tolerance) return 1;
  if (worst >= critical) return 0;
  return 1 - (worst - tolerance) / Math.max(critical - tolerance, 1e-9);
}
