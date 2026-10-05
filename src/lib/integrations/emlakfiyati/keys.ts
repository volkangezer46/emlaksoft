import "server-only";

import { createHash } from "node:crypto";
import { DAY_MS, now } from "@/lib/clock";
import { getPlatformSettingsMany, setPlatformSetting } from "@/lib/platform-settings";
import { openPlatformSecret, sealPlatformSecret } from "@/lib/platform-secrets";
import { EMLAKFIYATI_PREVIOUS_KEY_DAYS } from "./policy";

/**
 * EmlakFiyati API anahtarı çözümleme + saklama (TEK yer).
 * Öncelik: admin'de kayıtlı (şifreli) anahtar > ortam değişkeni EMLAKFIYATI_API_KEY (yedek) > yok.
 * Anahtar değeri bu modülün dışına yalnız adaptör çağrısı için çıkar; log/hata/sonuç nesnesine ASLA girmez.
 */

export const EF_SETTING = {
  current: "emlakfiyati_key_current",
  previous: "emlakfiyati_key_previous",
  previousUntil: "emlakfiyati_key_previous_until",
  changedAt: "emlakfiyati_key_changed_at",
  lastOkAt: "emlakfiyati_last_ok_at",
  lastErrorClass: "emlakfiyati_last_error_class",
  lastErrorAt: "emlakfiyati_last_error_at",
  alarmNotifiedAt: "emlakfiyati_alarm_notified_at",
  previousUsedAt: "emlakfiyati_previous_used_at",
  ortakEnabled: "emlakfiyati_ortak_enabled",
  /** Son BAŞARILI ortak yoklaması (ISO); bayrağı açmanın ön koşulu. config.ts EF_ORTAK_PROBE_OK_SETTING_KEY ile aynı. */
  ortakProbeOkAt: "emlakfiyati_ortak_probe_ok_at",
  /** Son yoklamanın özeti (JSON: sınırlar + tarife sürümü; anahtar/kişisel veri yok). */
  ortakProbeInfo: "emlakfiyati_ortak_probe_info",
} as const;

export type KeySource = "admin" | "env" | "none";

export type ResolvedKeys = {
  current: string | null;
  /** Yalnız admin kaynağında ve süresi dolmamışsa dolu. */
  previous: string | null;
  source: KeySource;
  /** Anahtardan türeyen kısa parmak izi (geri döndürülemez); yalnız bellek içi karşılaştırma için. */
  fingerprint: string;
  /** Admin'de şifreli kayıt var ama çözülemedi (PLATFORM_SECRETS_KEY kayıp/yanlış). */
  decryptFailed: boolean;
};

const RESOLVE_TTL_MS = 30_000;
let cached: { at: number; value: ResolvedKeys } | null = null;

export function invalidateEmlakFiyatiKeyCache(): void {
  cached = null;
}

function fingerprintOf(key: string | null): string {
  return key ? createHash("sha256").update(key).digest("hex").slice(0, 12) : "";
}

function envKey(): string | null {
  const key = process.env.EMLAKFIYATI_API_KEY?.trim();
  return key ? key : null;
}

export async function resolveEmlakFiyatiKeys(): Promise<ResolvedKeys> {
  const t = now();
  if (cached && t - cached.at < RESOLVE_TTL_MS) return cached.value;

  const s = await getPlatformSettingsMany([EF_SETTING.current, EF_SETTING.previous, EF_SETTING.previousUntil]);
  const sealedCurrent = s[EF_SETTING.current];
  const adminCurrent = sealedCurrent ? openPlatformSecret(EF_SETTING.current, sealedCurrent) : null;
  const decryptFailed = Boolean(sealedCurrent) && !adminCurrent;

  let value: ResolvedKeys;
  if (adminCurrent) {
    const until = s[EF_SETTING.previousUntil] ? new Date(s[EF_SETTING.previousUntil] as string).getTime() : 0;
    const previousValid = Boolean(s[EF_SETTING.previous]) && until > t;
    const adminPrevious = previousValid ? openPlatformSecret(EF_SETTING.previous, s[EF_SETTING.previous]) : null;
    if (s[EF_SETTING.previous] && !previousValid) {
      // Süresi dolan eski anahtar: yok sayılır ve (en iyi çabayla) silinir.
      void Promise.all([
        setPlatformSetting(EF_SETTING.previous, null),
        setPlatformSetting(EF_SETTING.previousUntil, null),
      ]).catch(() => undefined);
    }
    value = {
      current: adminCurrent,
      previous: adminPrevious,
      source: "admin",
      fingerprint: fingerprintOf(adminCurrent),
      decryptFailed: false,
    };
  } else {
    const fromEnv = envKey();
    value = {
      current: fromEnv,
      previous: null,
      source: fromEnv ? "env" : "none",
      fingerprint: fingerprintOf(fromEnv),
      decryptFailed,
    };
  }
  cached = { at: t, value };
  return value;
}

export type StoreResult = { ok: true; rotated: boolean } | { ok: false; error: "secrets_disabled" | "same_key" | "write_failed" };

/** Yeni anahtarı şifreli yazar; varsa eski `current` -> `previous` (7 gün). Anahtar değeri sonuca/loga girmez. */
export async function storeNewEmlakFiyatiKey(plain: string, staffId: string): Promise<StoreResult> {
  const sealedNew = sealPlatformSecret(EF_SETTING.current, plain);
  if (!sealedNew) return { ok: false, error: "secrets_disabled" };

  const existing = await getPlatformSettingsMany([EF_SETTING.current]);
  const oldPlain = existing[EF_SETTING.current] ? openPlatformSecret(EF_SETTING.current, existing[EF_SETTING.current]) : null;
  if (oldPlain && oldPlain === plain) return { ok: false, error: "same_key" };

  const writes: Array<Promise<boolean>> = [];
  let rotated = false;
  if (oldPlain) {
    const sealedOld = sealPlatformSecret(EF_SETTING.previous, oldPlain);
    if (!sealedOld) return { ok: false, error: "secrets_disabled" };
    const until = new Date(now() + EMLAKFIYATI_PREVIOUS_KEY_DAYS * DAY_MS).toISOString();
    writes.push(
      setPlatformSetting(EF_SETTING.previous, sealedOld, staffId),
      setPlatformSetting(EF_SETTING.previousUntil, until, staffId),
    );
    rotated = true;
  } else {
    writes.push(
      setPlatformSetting(EF_SETTING.previous, null, staffId),
      setPlatformSetting(EF_SETTING.previousUntil, null, staffId),
    );
  }
  writes.push(
    setPlatformSetting(EF_SETTING.current, sealedNew, staffId),
    setPlatformSetting(EF_SETTING.changedAt, new Date(now()).toISOString(), staffId),
    // Yeni anahtar: eski hata/alarm durumu temizlenir.
    setPlatformSetting(EF_SETTING.lastErrorClass, null, staffId),
    setPlatformSetting(EF_SETTING.lastErrorAt, null, staffId),
    setPlatformSetting(EF_SETTING.previousUsedAt, null, staffId),
  );
  const results = await Promise.all(writes);
  invalidateEmlakFiyatiKeyCache();
  if (results.some((ok) => !ok)) return { ok: false, error: "write_failed" };
  return { ok: true, rotated };
}

/** Eski (previous) anahtarı hemen siler. */
export async function dropPreviousEmlakFiyatiKey(staffId: string): Promise<boolean> {
  const r = await Promise.all([
    setPlatformSetting(EF_SETTING.previous, null, staffId),
    setPlatformSetting(EF_SETTING.previousUntil, null, staffId),
  ]);
  invalidateEmlakFiyatiKeyCache();
  return r.every(Boolean);
}

/** Admin'deki kayıtlı anahtarları (current + previous) siler; ortam değişkeni yedeği etkilenmez. */
export async function clearStoredEmlakFiyatiKeys(staffId: string): Promise<boolean> {
  const r = await Promise.all([
    setPlatformSetting(EF_SETTING.current, null, staffId),
    setPlatformSetting(EF_SETTING.previous, null, staffId),
    setPlatformSetting(EF_SETTING.previousUntil, null, staffId),
    setPlatformSetting(EF_SETTING.changedAt, new Date(now()).toISOString(), staffId),
    setPlatformSetting(EF_SETTING.lastErrorClass, null, staffId),
    setPlatformSetting(EF_SETTING.lastErrorAt, null, staffId),
  ]);
  invalidateEmlakFiyatiKeyCache();
  return r.every(Boolean);
}
