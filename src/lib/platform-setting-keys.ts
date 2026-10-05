/**
 * Platform genel ayar anahtarları ve saf çözümleyiciler (sunucu/istemci ortak, yan etkisiz).
 * Depo: `platform_settings` (anahtar-değer, metin). Okuyucu: `platform-flags.ts`.
 */
export const PLATFORM_SETTING_KEYS = {
  maintenanceMode: "maintenance_mode",
  maintenanceMessage: "maintenance_message",
  registrationOpen: "registration_open",
  defaultTrialDays: "default_trial_days",
  /** Deneme bitiminden sonra otomatik askıya almaya kadar tolerans (gün). */
  trialGraceDays: "billing.trial_grace_days",
} as const;

/** Kayıt kapalıyken /kayit ve signUp'ın gösterdiği mesaj. */
export const REGISTRATION_CLOSED_MESSAGE =
  "Yeni ofis kayıtları şu anda geçici olarak kapalı. Mevcut hesabınızla giriş yapabilirsiniz.";

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

export const DEFAULT_TRIAL_GRACE_DAYS = 7;
export const MIN_TRIAL_GRACE_DAYS = 0;
export const MAX_TRIAL_GRACE_DAYS = 60;

/** Tolerans günü: tam sayı ve 0..60 dışında varsayılan (7). */
export function parseTrialGraceDays(raw: string | null | undefined): number {
  const v = (raw ?? "").trim();
  if (!/^[0-9]{1,2}$/.test(v)) return DEFAULT_TRIAL_GRACE_DAYS;
  const n = Number(v);
  return n >= MIN_TRIAL_GRACE_DAYS && n <= MAX_TRIAL_GRACE_DAYS ? n : DEFAULT_TRIAL_GRACE_DAYS;
}

export type GeneralSettings = {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  registrationOpen: boolean;
  defaultTrialDays: number;
  trialGraceDays: number;
};
