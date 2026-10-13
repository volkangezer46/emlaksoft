import { getPlatformMfaPolicyNow, isMfaSettingOn, mfaEnvMode, mfaRequiredFor } from "@/lib/platform-security/mfa-policy";

export { isMfaSettingOn };

/**
 * Platform (süper admin / ops) için iki adımlı doğrulama (TOTP, AAL2) anahtarı.
 *
 * TEK KAYNAK artık yönetimdedir: Personel > Güvenlik politikası 'platform.mfa_enforced' (+ geçiş süresi
 * 'platform.mfa_grace_until') yazar; uygulama katmanı (proxy, kimlik kapısı, giriş) ve SQL kapıları aynı ayarı okur.
 * Ortam değişkeni `PLATFORM_MFA_ENFORCEMENT` (sunucu ortamı `.env.production` + yeniden yayın) yalnız
 *   "on"        → yönetimden bağımsız zorunlu,
 *   "force-off" → acil kapatma (kilitlenme kurtarması; ayrıntı platform-security/mfa-policy.ts)
 * anlamı taşır. Varsayılan: ikisi de kapalı = MFA zorunlu değil (sahip kararı; davranış değişmez).
 */

/** Senkron env okuyucu (yalnız env "on"; geriye dönük uyum ve env tavanı gösterimi için). */
export function isPlatformMfaRequired(): boolean {
  return mfaEnvMode(process.env.PLATFORM_MFA_ENFORCEMENT) === "on";
}

/**
 * Asıl karar (env + DB + geçiş süresi; bayrak önbelleğinden). `hasVerifiedFactor` verilmezse proxy kuralı:
 * geçiş süresinde yönlendirme yok. Verilirse kişiye özel karar (faktörü olan personel geçişte de AAL2'ye gider).
 */
export async function isPlatformMfaRequiredNow(hasVerifiedFactor?: boolean): Promise<boolean> {
  return mfaRequiredFor(await getPlatformMfaPolicyNow(), hasVerifiedFactor);
}

/**
 * DB katmanı (`platform_settings` 'platform.mfa_enforced') SQL kapılarında AAL2'yi belirler. Yönetim anahtarı hep bu
 * ayarı yazdığı için ayrışma yalnız env "on" iken DB ayarı kapalıysa olur (personel RPC'leri MFA'sız çalışır) ya da
 * env "force-off" iken DB açıksa (uygulama gevşek, SQL sıkı). Bu yardımcılar yalnız TUTARSIZLIĞI saptar.
 */
export const PLATFORM_MFA_DB_SETTING_KEY = "platform.mfa_enforced";

/**
 * env ve DB ayarı ayrışıyor mu? "env_on_db_off": env açık ama DB kapalı (SQL kapıları MFA istemiyor — tehlikeli).
 * "env_off_db_on": DB açık ama env acil kapatmada (force-off; uygulama katmanı gevşek). env boşken DB açık olması
 * artık NORMALDİR (yönetim anahtarı tek kaynak).
 */
export function platformMfaSyncIssue(
  envOn: boolean,
  dbRaw: string | null | undefined,
  envForceOff: boolean = mfaEnvMode(process.env.PLATFORM_MFA_ENFORCEMENT) === "force-off",
): "env_on_db_off" | "env_off_db_on" | null {
  const dbOn = isMfaSettingOn(dbRaw);
  if (envOn && !dbOn) return "env_on_db_off";
  if (envForceOff && dbOn) return "env_off_db_on";
  return null;
}
