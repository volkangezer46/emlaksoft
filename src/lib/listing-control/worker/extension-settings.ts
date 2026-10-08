import { EXTENSION_LIMITS } from "./extension-pacing";

/**
 * EKLENTİ AYARLARI (SAF, testli). Kullanıcı yalnız KISABİLİR: portal aç/kapa, çalışma saatleri, günlük üst sınır.
 * Hız tavanları (20 sn aralık, saatte 60, günde `EXTENSION_LIMITS.maxPerDay`, engel beklemesi) ayarla GEVŞETİLEMEZ:
 * günlük sınır tavanı aşamaz; saatlik/aralık/engel kuralları ayar kapsamında değildir.
 */

export type ExtensionSettings = {
  /** Portal kimliği → açık mı. Kayıt yoksa AÇIK sayılır. */
  portals: Record<string, boolean>;
  /** Yerel saat penceresi [from, to). from > to = gece yarısını aşan pencere; from === to = tüm gün. */
  hours: { enabled: boolean; from: number; to: number };
  /** Günlük kontrol üst sınırı (1..tavan). */
  dailyCap: number;
};

export const MIN_DAILY_CAP = 10;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  portals: {},
  hours: { enabled: true, from: 8, to: 22 },
  dailyCap: EXTENSION_LIMITS.maxPerDay,
};

function int(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Depodan/arayüzden gelen ham değeri güvenli ayara çevirir (bilinmeyen alan atılır, sınırlar zorlanır). */
export function sanitizeSettings(raw: unknown): ExtensionSettings {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const portals: Record<string, boolean> = {};
  if (typeof o.portals === "object" && o.portals !== null) {
    for (const [k, v] of Object.entries(o.portals as Record<string, unknown>).slice(0, 20)) {
      if (/^[a-z0-9-]{2,40}$/.test(k) && typeof v === "boolean") portals[k] = v;
    }
  }
  const h = (typeof o.hours === "object" && o.hours !== null ? o.hours : {}) as Record<string, unknown>;
  return {
    portals,
    hours: {
      enabled: typeof h.enabled === "boolean" ? h.enabled : DEFAULT_SETTINGS.hours.enabled,
      from: int(h.from, 0, 23, DEFAULT_SETTINGS.hours.from),
      to: int(h.to, 0, 24, DEFAULT_SETTINGS.hours.to),
    },
    dailyCap: int(o.dailyCap, MIN_DAILY_CAP, EXTENSION_LIMITS.maxPerDay, DEFAULT_SETTINGS.dailyCap),
  };
}

export function portalEnabled(settings: ExtensionSettings, portal: string): boolean {
  return settings.portals[portal] !== false;
}

/** Yerel saat (0..23). `tzOffsetMinutes` = `Date#getTimezoneOffset()` (UTC − yerel). */
export function localHour(nowMs: number, tzOffsetMinutes: number): number {
  return new Date(nowMs - tzOffsetMinutes * 60_000).getUTCHours();
}

/** Çalışma saati penceresinde mi (devre dışıysa her zaman evet). */
export function withinWorkingHours(settings: ExtensionSettings, nowMs: number, tzOffsetMinutes: number): boolean {
  const { enabled, from, to } = settings.hours;
  if (!enabled || from === to) return true;
  const h = localHour(nowMs, tzOffsetMinutes);
  return from < to ? h >= from && h < to : h >= from || h < to;
}

/** Pencere dışındayken bir sonraki açılışa kalan süre (ms; en çok 24 saat). Pencere içindeyse 0. */
export function msUntilWindowOpens(settings: ExtensionSettings, nowMs: number, tzOffsetMinutes: number): number {
  if (withinWorkingHours(settings, nowMs, tzOffsetMinutes)) return 0;
  const local = new Date(nowMs - tzOffsetMinutes * 60_000);
  const minutesNow = local.getUTCHours() * 60 + local.getUTCMinutes();
  let diff = settings.hours.from * 60 - minutesNow;
  if (diff <= 0) diff += 24 * 60;
  return diff * 60_000;
}

/** Arayüz etiketi: "08:00 – 22:00" / "Tüm gün". */
export function hoursLabel(settings: ExtensionSettings): string {
  const { enabled, from, to } = settings.hours;
  if (!enabled || from === to) return "Tüm gün";
  const p = (n: number) => `${String(n % 24).padStart(2, "0")}:00`;
  return `${p(from)} – ${p(to)}`;
}
