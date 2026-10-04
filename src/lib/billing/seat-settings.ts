/**
 * Ek kullanıcı (koltuk) fiyatlama GENEL ayarları — saf katman (sunucu bağımsız).
 * Depo: `platform_settings` anahtarı `billing.seat_settings` (şema gerekmez). Kayıt yoksa/bozuksa varsayılan.
 * Plan başına kademe/yuvarlama/azami koltuk PlanDef'tedir (plan-overrides.ts); burası yalnız genel eşiklerdir.
 */
export const SEAT_SETTINGS_KEY = "billing.seat_settings";

export type SeatSettings = {
  /** Koltuk doluluğunda "uyarı" eşiği (yüzde, 50-99). Ofis tarafı satın alma yönlendirmesi bunu kullanır. */
  warnPercent: number;
};

export const DEFAULT_SEAT_SETTINGS: SeatSettings = { warnPercent: 80 };

export const SEAT_WARN_PERCENT_MIN = 50;
export const SEAT_WARN_PERCENT_MAX = 99;

export function sanitizeSeatSettings(raw: unknown): SeatSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_SEAT_SETTINGS;
  const w = (raw as Record<string, unknown>).warnPercent;
  if (typeof w === "number" && Number.isInteger(w) && w >= SEAT_WARN_PERCENT_MIN && w <= SEAT_WARN_PERCENT_MAX) {
    return { warnPercent: w };
  }
  return DEFAULT_SEAT_SETTINGS;
}

export function parseSeatSettings(raw: string | null | undefined): SeatSettings {
  if (!raw) return DEFAULT_SEAT_SETTINGS;
  try {
    return sanitizeSeatSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SEAT_SETTINGS;
  }
}

export function serializeSeatSettings(settings: SeatSettings): string {
  return JSON.stringify({ v: 1, warnPercent: settings.warnPercent });
}

/** Yüzde ayarını seatUtilization'ın oran eşiğine çevirir. */
export function warnRatioOf(settings: SeatSettings): number {
  return settings.warnPercent / 100;
}
