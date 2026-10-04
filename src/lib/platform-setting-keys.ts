/**
 * Platform genel ayar anahtarları ve saf çözümleyiciler (sunucu/istemci ortak, yan etkisiz).
 * Depo: `platform_settings` (anahtar-değer, metin). Okuyucu: `platform-flags.ts`.
 */
export const PLATFORM_SETTING_KEYS = {
  maintenanceMode: "maintenance_mode",
  maintenanceMessage: "maintenance_message",
  registrationOpen: "registration_open",
  defaultTrialDays: "default_trial_days",
} as const;

export const DEFAULT_TRIAL_DAYS = 14;
export const MIN_TRIAL_DAYS = 1;
export const MAX_TRIAL_DAYS = 90;
export const MAX_MAINTENANCE_MESSAGE = 300;

/** "on" | "true" | "1" → true; "off" | "false" | "0" → false; boş/bilinmeyen → varsayılan. */
export function parseSettingBool(raw: string | null | undefined, fallback: boolean): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "on" || v === "true" || v === "1") return true;
  if (v === "off" || v === "false" || v === "0") return false;
  return fallback;
}

/** Deneme süresi: tam sayı ve 1..90 aralığı dışında varsayılan (14). */
export function parseTrialDays(raw: string | null | undefined): number {
  const v = (raw ?? "").trim();
  if (!/^[0-9]{1,3}$/.test(v)) return DEFAULT_TRIAL_DAYS;
  const n = Number(v);
  return n >= MIN_TRIAL_DAYS && n <= MAX_TRIAL_DAYS ? n : DEFAULT_TRIAL_DAYS;
}

export type GeneralSettings = {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  registrationOpen: boolean;
  defaultTrialDays: number;
};
