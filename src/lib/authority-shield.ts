/**
 * Yazılı yetki belgesi kalkanı — pazarlık ve kaparo öncesi kontrol.
 *
 * Adlandırma (karıştırmayın): Ticaret Bakanlığı sistemi TTBS = Taşınmaz Ticareti Bilgi Sistemi.
 * EİDS = Elektronik İlan Doğrulama Sistemi (ilan yetki doğrulaması) AYRI bir sistemdir.
 * Harici TTBS/EİDS erişimi gelene kadar ofis onayı (checkbox / meta) ile çalışır.
 *
 * EİDS ölçümü: `eidsNoPresent` (portföyde EİDS taşınmaz numarası var mı) ve `authorityShort` (yetki 3 aydan kısa mı)
 * verilirse `notes` içinde YUMUŞAK uyarılar döner; bunlar işlemi ENGELLEMEZ (resmî doğrulama yapılmaz, yalnız ofis kaydı ölçülür).
 */
export function checkAuthorityShield(input: {
  hasWrittenAuthority: boolean;
  force?: boolean;
  /** true/false = portföyde EİDS taşınmaz no var/yok; null/undefined = ölçülemedi (uyarı üretilmez). */
  eidsNoPresent?: boolean | null;
  /** true = yetki süresi EİDS en az 3 ay kuralının altında. */
  authorityShort?: boolean;
}): { ok: boolean; warning?: string; notes?: string[] } {
  const notes: string[] = [];
  if (input.eidsNoPresent === false) {
    notes.push("Portföyde EİDS taşınmaz numarası yok; portal ilanı yetki doğrulamasına takılabilir.");
  }
  if (input.authorityShort) {
    notes.push("Yetki süresi 3 aydan kısa görünüyor; EİDS yetki en az 3 ay olmalıdır.");
  }
  const extra = notes.length > 0 ? { notes } : {};
  if (input.force) return { ok: true, ...extra };
  if (!input.hasWrittenAuthority) {
    return {
      ok: false,
      warning:
        "Yazılı yetki belgesi onaylanmadan deal veya kaparo riskli. Yazılı yetkiyi işaretleyin veya uyum merkezinden kaydedin.",
      ...extra,
    };
  }
  return { ok: true, ...extra };
}
