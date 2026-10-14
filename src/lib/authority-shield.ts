import { eidsDisplayStatus } from "@/lib/eids/authority-status";

/** Ofis sahibinin gerekçeli yayın izni bu süre geçerlidir; sonra engel yeniden devreye girer. */
export const AUTHORITY_OVERRIDE_TTL_HOURS = 24;
export const AUTHORITY_OVERRIDE_MIN_REASON = 10;

export type AuthorityPublishBlock = { code: "revoked" | "expired"; message: string };

/**
 * EİDS yayın ENGELİ (SAF; EP2 kabul ölçütü). Yetkisi İPTAL EDİLMİŞ ya da SÜRESİ DOLMUŞ portföy için portal aktarımı ve
 * yeni yayın engellenir. Engeli yalnız ofis sahibi (owner) gerekçe yazarak, `AUTHORITY_OVERRIDE_TTL_HOURS` saatlik bir
 * izinle aşabilir (`override` olayı, eids_authority_events). Mesaj "ne oldu, ne yapmalı" biçimindedir.
 * `overrideActive` = son durum değişikliğinden SONRA verilmiş, süresi geçmemiş owner izni var.
 */
export function authorityPublishBlock(
  row: {
    authority_eids_status: string | null;
    authorization_start?: string | null;
    authorization_end: string | null;
    eids_exempt_reason?: string | null;
  },
  nowMs: number,
  overrideActive = false,
): AuthorityPublishBlock | null {
  if (overrideActive) return null;
  const display = eidsDisplayStatus(row, nowMs);
  const next = `Ne yapmalı: yetki yenilenene kadar yayınlamayın; yenilendiyse portföydeki "Yetki durumu" kartından güncelleyin. Zorunlu bir durumda yalnız ofis sahibi aynı karttan gerekçe yazarak ${AUTHORITY_OVERRIDE_TTL_HOURS} saatlik izin verebilir.`;
  if (display === "revoked") return { code: "revoked", message: `Ne oldu: malik bu taşınmaz için EİDS yetkisini iptal etmiş; yeni yayın ve portal aktarımı durduruldu. ${next}` };
  if (display === "expired") return { code: "expired", message: `Ne oldu: bu portföyün yetki süresi dolmuş; yeni yayın ve portal aktarımı durduruldu. ${next}` };
  return null;
}

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
