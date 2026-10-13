import { now } from "@/lib/clock";
import { readPlatformFlagsCached, SECURITY_SETTING_KEYS } from "@/lib/platform-flags-cache";

/**
 * PERSONEL MFA POLİTİKASI — tek kaynak (saf karar + önbellekli okuyucu).
 *
 * Girdiler:
 *  - env `PLATFORM_MFA_ENFORCEMENT`: "on" = zorunlu (DB'den bağımsız), "force-off" = ACİL KAPATMA, diğer = DB'ye bırak.
 *  - DB 'platform.mfa_enforced' ("on"/"off"): yönetimden (Personel > Güvenlik politikası) yazılır. SQL kapıları
 *    (`growth_staff_super_admin()` vb.) AAL2'yi YALNIZ bu ayara bakarak ister; bu yüzden anahtar hep DB'ye yazılır.
 *  - DB 'platform.mfa_grace_until' (ISO): geçiş süresi. Bitmeden, doğrulayıcısı OLMAYAN personel parolayla girer
 *    (üstte sarı geri sayım şeridi); doğrulayıcısı olan personelden AAL2 hemen istenir.
 *
 * KİLİTLENME KURTARMASI (belgeli): tüm süper adminler doğrulayıcısını kaybederse
 *   1) `.env.production` içinde PLATFORM_MFA_ENFORCEMENT=force-off + yeniden yayın → uygulama katmanı MFA istemez;
 *   2) SQL kapıları için ayarı da kapatın (sunucuda):
 *      update platform_settings set value='off' where key='platform.mfa_enforced';
 *   3) girip Hesabım > Güvenlik'ten doğrulayıcı kurun, sonra force-off'u kaldırıp yeniden yayınlayın.
 */

export const MFA_ENFORCED_SETTING_KEY = SECURITY_SETTING_KEYS.mfaEnforced;
export const MFA_GRACE_SETTING_KEY = SECURITY_SETTING_KEYS.mfaGraceUntil;
export const MFA_GRACE_DAYS = [0, 7] as const;

export type MfaEnvMode = "on" | "force-off" | "unset";

export function mfaEnvMode(raw: string | null | undefined): MfaEnvMode {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "on") return "on";
  if (v === "force-off") return "force-off";
  return "unset";
}

export function isMfaSettingOn(raw: string | null | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "on" || v === "true" || v === "1";
}

/** Zorunluluk ilan edilmiş mi (geçiş süresinden bağımsız). force-off her şeyi ezer. */
export function isMfaEnforced(envRaw: string | null | undefined, dbRaw: string | null | undefined): boolean {
  const env = mfaEnvMode(envRaw);
  if (env === "force-off") return false;
  return env === "on" || isMfaSettingOn(dbRaw);
}

export function mfaGraceActive(graceUntil: string | null | undefined, nowMs: number): boolean {
  if (!graceUntil) return false;
  const t = new Date(graceUntil).getTime();
  return Number.isFinite(t) && t > nowMs;
}

/**
 * Bu personelden şu an AAL2 istenmeli mi?
 * env/DB "on" → zorunlu; env "force-off" → asla; geçiş süresi sürüyorsa ve doğrulayıcısı yoksa → serbest.
 */
export function effectiveMfaRequired(
  envRaw: string | null | undefined,
  dbRaw: string | null | undefined,
  graceUntil: string | null | undefined,
  hasVerifiedFactor: boolean,
  nowMs: number,
): boolean {
  if (!isMfaEnforced(envRaw, dbRaw)) return false;
  if (mfaGraceActive(graceUntil, nowMs) && !hasVerifiedFactor) return false;
  return true;
}

/**
 * Proxy kararı (faktör bilgisi yok): geçiş süresinde proxy yönlendirmez; faktörü olan personeli
 * sunucu kimlik kapısı (`getPlatformStaffIdentity`) AAL2'ye yollar.
 */
export function mfaRequiredAtEdge(
  envRaw: string | null | undefined,
  dbRaw: string | null | undefined,
  graceUntil: string | null | undefined,
  nowMs: number,
): boolean {
  return isMfaEnforced(envRaw, dbRaw) && !mfaGraceActive(graceUntil, nowMs);
}

export type MfaPolicyNow = {
  envMode: MfaEnvMode;
  dbRaw: string | null;
  dbOn: boolean;
  enforced: boolean;
  graceUntil: string | null;
  graceActive: boolean;
  nowMs: number;
};

/** Şu anki politika (bayrak önbelleğinden). */
export async function getPlatformMfaPolicyNow(): Promise<MfaPolicyNow> {
  const flags = await readPlatformFlagsCached();
  const envRaw = process.env.PLATFORM_MFA_ENFORCEMENT;
  const nowMs = now();
  return {
    envMode: mfaEnvMode(envRaw),
    dbRaw: flags.mfaEnforcedRaw,
    dbOn: isMfaSettingOn(flags.mfaEnforcedRaw),
    enforced: isMfaEnforced(envRaw, flags.mfaEnforcedRaw),
    graceUntil: flags.mfaGraceUntil,
    graceActive: mfaGraceActive(flags.mfaGraceUntil, nowMs),
    nowMs,
  };
}

/** Politikadan bu kişi için karar (faktör bilgisi verilmezse proxy kuralı). */
export function mfaRequiredFor(policy: MfaPolicyNow, hasVerifiedFactor?: boolean): boolean {
  if (!policy.enforced) return false;
  if (hasVerifiedFactor === undefined) return !policy.graceActive;
  return !(policy.graceActive && !hasVerifiedFactor);
}
