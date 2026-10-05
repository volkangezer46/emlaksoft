"use server";

import { revalidatePath } from "next/cache";
import { guardPlatformAction } from "@/lib/platform-guards";
import { logPlatformActivity } from "@/lib/platform-activity";
import { setPlatformSetting } from "@/lib/platform-settings";
import { getGeneralSettings } from "@/lib/platform-flags";
import {
  MAX_MAINTENANCE_MESSAGE,
  MAX_TRIAL_DAYS,
  MAX_TRIAL_GRACE_DAYS,
  MIN_TRIAL_DAYS,
  MIN_TRIAL_GRACE_DAYS,
  PLATFORM_SETTING_KEYS,
} from "@/lib/platform-setting-keys";

export type GeneralSettingsResult = { ok?: boolean; error?: string; changed?: string[] };

/**
 * Platform genel ayarları (bakım modu, kayıt açık/kapalı, varsayılan deneme süresi).
 * Yalnız süper admin; yazma hız sınırlıdır. Okuyucu `lib/platform-flags.ts` (middleware ve kayıt
 * akışı bu ayarları oradan okur). Eski/yeni değer farkı denetim kaydına yazılır.
 */
export async function saveGeneralSettings(fd: FormData): Promise<GeneralSettingsResult> {
  const gate = await guardPlatformAction({
    module: "sistem",
    roles: ["super_admin"],
    rate: { key: "platform-settings", limit: 20, windowSec: 600 },
  });
  if ("error" in gate) return { error: gate.error };

  const maintenance = fd.get("maintenance_mode") === "on";
  const registrationOpen = fd.get("registration_open") === "on";
  const message = String(fd.get("maintenance_message") ?? "").trim();
  const trialRaw = String(fd.get("default_trial_days") ?? "").trim();

  if (message.length > MAX_MAINTENANCE_MESSAGE) {
    return { error: `Bakım mesajı en fazla ${MAX_MAINTENANCE_MESSAGE} karakter olabilir.` };
  }
  if (!/^[0-9]{1,3}$/.test(trialRaw) || Number(trialRaw) < MIN_TRIAL_DAYS || Number(trialRaw) > MAX_TRIAL_DAYS) {
    return { error: `Deneme süresi ${MIN_TRIAL_DAYS} ile ${MAX_TRIAL_DAYS} gün arasında bir sayı olmalıdır.` };
  }
  const trialDays = Number(trialRaw);
  const graceRaw = String(fd.get("trial_grace_days") ?? "").trim();
  if (!/^[0-9]{1,2}$/.test(graceRaw) || Number(graceRaw) < MIN_TRIAL_GRACE_DAYS || Number(graceRaw) > MAX_TRIAL_GRACE_DAYS) {
    return { error: `Tolerans süresi ${MIN_TRIAL_GRACE_DAYS} ile ${MAX_TRIAL_GRACE_DAYS} gün arasında bir sayı olmalıdır.` };
  }
  const graceDays = Number(graceRaw);

  const before = await getGeneralSettings();
  const writes: [string, string][] = [
    [PLATFORM_SETTING_KEYS.maintenanceMode, maintenance ? "on" : "off"],
    [PLATFORM_SETTING_KEYS.maintenanceMessage, message],
    [PLATFORM_SETTING_KEYS.registrationOpen, registrationOpen ? "on" : "off"],
    [PLATFORM_SETTING_KEYS.defaultTrialDays, String(trialDays)],
    [PLATFORM_SETTING_KEYS.trialGraceDays, String(graceDays)],
  ];
  for (const [key, value] of writes) {
    const ok = await setPlatformSetting(key, value, gate.staff.id);
    if (!ok) return { error: "Ayarlar kaydedilemedi. Lütfen tekrar deneyin." };
  }

  const changed: string[] = [];
  if (before.maintenanceMode !== maintenance) changed.push("Bakım modu");
  if (before.maintenanceMessage !== message) changed.push("Bakım mesajı");
  if (before.registrationOpen !== registrationOpen) changed.push("Kayıt");
  if (before.defaultTrialDays !== trialDays) changed.push("Deneme süresi");
  if (before.trialGraceDays !== graceDays) changed.push("Askı toleransı");

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "platform_settings.general_update",
    entityType: "platform_settings",
    meta: {
      old: before,
      new: { maintenanceMode: maintenance, maintenanceMessage: message, registrationOpen, defaultTrialDays: trialDays, trialGraceDays: graceDays },
      changed,
    },
  });

  revalidatePath("/admin/ayarlar");
  return { ok: true, changed };
}
