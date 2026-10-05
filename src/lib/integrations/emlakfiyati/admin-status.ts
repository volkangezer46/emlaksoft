import "server-only";

import { now } from "@/lib/clock";
import { getPlatformSettingsMany } from "@/lib/platform-settings";
import { platformSecretsEnabled, platformSecretsKeySource, type PlatformSecretsKeySource } from "@/lib/platform-secrets";
import { ORTAK_ENDPOINTS_VERIFIED } from "./ortak";
import { EF_SETTING, resolveEmlakFiyatiKeys, type KeySource } from "./keys";
import { maskEmlakFiyatiKey } from "./policy";

/** Admin ekranı için durum özeti. Anahtarın TAMAMI ASLA dönmez: yalnız maskeli (önek + son 4). */
export type EmlakFiyatiAdminStatus = {
  secretsEnabled: boolean;
  secretsKeySource: PlatformSecretsKeySource;
  configured: boolean;
  source: KeySource;
  masked: string | null;
  decryptFailed: boolean;
  changedAt: string | null;
  lastOkAt: string | null;
  lastErrorClass: string | null;
  lastErrorAt: string | null;
  /** 401 alarmı: son hata sınıfı "auth" (başarılı çağrı veya yeni anahtarla temizlenir). */
  authAlarm: boolean;
  previous: { present: boolean; validUntil: string | null };
  previousUsedAt: string | null;
  ortakFlagOn: boolean;
  ortakEndpointsVerified: boolean;
};

export async function getEmlakFiyatiAdminStatus(): Promise<EmlakFiyatiAdminStatus> {
  const keys = await resolveEmlakFiyatiKeys();
  const s = await getPlatformSettingsMany([
    EF_SETTING.changedAt,
    EF_SETTING.lastOkAt,
    EF_SETTING.lastErrorClass,
    EF_SETTING.lastErrorAt,
    EF_SETTING.previousUntil,
    EF_SETTING.previousUsedAt,
    EF_SETTING.ortakEnabled,
  ]);
  const until = s[EF_SETTING.previousUntil];
  const untilValid = Boolean(until) && new Date(until as string).getTime() > now();
  return {
    secretsEnabled: platformSecretsEnabled(),
    secretsKeySource: platformSecretsKeySource(),
    configured: keys.current != null,
    source: keys.source,
    masked: maskEmlakFiyatiKey(keys.current),
    decryptFailed: keys.decryptFailed,
    changedAt: s[EF_SETTING.changedAt],
    lastOkAt: s[EF_SETTING.lastOkAt],
    lastErrorClass: s[EF_SETTING.lastErrorClass],
    lastErrorAt: s[EF_SETTING.lastErrorAt],
    authAlarm: s[EF_SETTING.lastErrorClass] === "auth",
    previous: { present: keys.previous != null, validUntil: keys.previous != null && untilValid ? until : null },
    previousUsedAt: s[EF_SETTING.previousUsedAt],
    ortakFlagOn: s[EF_SETTING.ortakEnabled] === "1",
    ortakEndpointsVerified: ORTAK_ENDPOINTS_VERIFIED,
  };
}
