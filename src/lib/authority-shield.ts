/**
 * Yazılı yetki belgesi kalkanı — pazarlık ve kaparo öncesi kontrol.
 *
 * Adlandırma (karıştırmayın): Ticaret Bakanlığı sistemi TTBS = Taşınmaz Ticareti Bilgi Sistemi.
 * EİDS = Elektronik İlan Doğrulama Sistemi (ilan yetki doğrulaması) AYRI bir sistemdir.
 * Harici TTBS/EİDS erişimi gelene kadar ofis onayı (checkbox / meta) ile çalışır.
 */
export function checkAuthorityShield(input: {
  hasWrittenAuthority: boolean;
  force?: boolean;
}): { ok: boolean; warning?: string } {
  if (input.force) return { ok: true };
  if (!input.hasWrittenAuthority) {
    return {
      ok: false,
      warning:
        "Yazılı yetki belgesi onaylanmadan deal veya kaparo riskli. Yazılı yetkiyi işaretleyin veya uyum merkezinden kaydedin.",
    };
  }
  return { ok: true };
}
