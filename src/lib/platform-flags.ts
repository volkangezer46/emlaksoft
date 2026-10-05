import { getPlatformSetting } from "@/lib/platform-settings";
import {
  PLATFORM_SETTING_KEYS,
  parseSettingBool,
  parseTrialDays,
  parseTrialGraceDays,
  type GeneralSettings,
} from "@/lib/platform-setting-keys";

/**
 * Platform genel ayarlarının SUNUCU okuyucusu (middleware / kayıt akışı bunu çağırabilir).
 * Okunamazsa güvenli varsayılan: bakım kapalı, kayıt açık, deneme 14 gün.
 */
export async function getGeneralSettings(): Promise<GeneralSettings> {
  const [maint, msg, reg, trial, grace] = await Promise.all([
    getPlatformSetting(PLATFORM_SETTING_KEYS.maintenanceMode),
    getPlatformSetting(PLATFORM_SETTING_KEYS.maintenanceMessage),
    getPlatformSetting(PLATFORM_SETTING_KEYS.registrationOpen),
    getPlatformSetting(PLATFORM_SETTING_KEYS.defaultTrialDays),
    getPlatformSetting(PLATFORM_SETTING_KEYS.trialGraceDays),
  ]);
  return {
    maintenanceMode: parseSettingBool(maint, false),
    maintenanceMessage: (msg ?? "").trim(),
    registrationOpen: parseSettingBool(reg, true),
    defaultTrialDays: parseTrialDays(trial),
    trialGraceDays: parseTrialGraceDays(grace),
  };
}

export async function isMaintenanceMode(): Promise<boolean> {
  return parseSettingBool(await getPlatformSetting(PLATFORM_SETTING_KEYS.maintenanceMode), false);
}

export async function isRegistrationOpen(): Promise<boolean> {
  return parseSettingBool(await getPlatformSetting(PLATFORM_SETTING_KEYS.registrationOpen), true);
}

export async function getDefaultTrialDays(): Promise<number> {
  return parseTrialDays(await getPlatformSetting(PLATFORM_SETTING_KEYS.defaultTrialDays));
}
