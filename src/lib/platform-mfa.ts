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
