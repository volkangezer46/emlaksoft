/**
 * Platform (süper admin / ops) için zorunlu iki adımlı doğrulama (TOTP, AAL2) anahtarı.
 *
 * GELİŞTİRME SÜRECİNDE KAPALI: sahibin kararıyla, geliştirme bitene kadar platform paneline
 * yalnız parola ile girilir. Geliştirme bittiğinde tek ortam değişkeniyle yeniden açılır:
 *   PLATFORM_MFA_ENFORCEMENT=on   (Vercel Production env + redeploy)
 *
 * Kapalıyken: middleware /giris/mfa'ya zorlamaz, getPlatformStaffIdentity AAL2 aramaz,
 * girişte MFA sayfasına yönlendirilmez. Açıkken davranış önceki gibidir (zorunlu AAL2).
 * Platform sayfaları ayrıca requirePlatformStaff ile korunur; bu anahtar yalnız AAL2 şartını yönetir.
 */
export function isPlatformMfaRequired(): boolean {
  return process.env.PLATFORM_MFA_ENFORCEMENT === "on";
}

/**
 * TEK KAYNAK UYUMU: MFA iki yerde uygulanır — uygulama katmanı (bu env bayrağı: middleware/getPlatformStaffIdentity)
 * ve DB katmanı (`platform_settings` 'platform.mfa_enforced'; `growth_staff_super_admin()` ve benzeri SQL kapıları AAL2'yi
 * yalnız bu AYARA bakarak ister, env'e BAKAMAZ). İkisi ayrışırsa personel RPC'leri MFA'sız çalışır (env on, ayar yok).
 * Yayın runbook'unda ZORUNLU adım: env'i açtığınız anda ayarı da açın (docs/DEPLOY.md "Platform MFA tek kaynak").
 * Bu yardımcılar yalnız TUTARSIZLIĞI saptar; ayarı kendiliğinden YAZMAZ ve MFA'yı AÇMAZ.
 */
export const PLATFORM_MFA_DB_SETTING_KEY = "platform.mfa_enforced";

export function isMfaSettingOn(raw: string | null | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "on" || v === "true" || v === "1";
}

/** env ve DB ayarı ayrışıyor mu? (env açık ama DB ayarı kapalı = tehlikeli; tersi = uygulama katmanı gevşek.) */
export function platformMfaSyncIssue(envOn: boolean, dbRaw: string | null | undefined): "env_on_db_off" | "env_off_db_on" | null {
  const dbOn = isMfaSettingOn(dbRaw);
  if (envOn && !dbOn) return "env_on_db_off";
  if (!envOn && dbOn) return "env_off_db_on";
  return null;
}
