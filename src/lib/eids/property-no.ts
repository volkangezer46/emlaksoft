/**
 * EİDS Taşınmaz Kimlik Numarası (SAF — sunucu ve istemci güvenle import eder).
 *
 * Mal sahibi e-Devlet "EİDS Yetki İşlemleri"nde emlak işletmesinin yetki belgesini onayladığında üretilen numaradır;
 * portallar ilanı bu numarayla yayınlar. Resmî biçim kamuya açık kaynaktan DOĞRULANAMADI: bu yüzden yalnız
 * güvenli, gevşek bir biçim uygulanır (harf/rakam/tire, 6-24 karakter; boşluk ve ayraç temizlenir, büyük harfe çevrilir).
 * Bu doğrulama RESMÎ BİR SORGULAMA DEĞİLDİR; numaranın gerçekliğini yalnız EİDS/e-Devlet teyit eder.
 */

export const EIDS_NO_MIN = 6;
export const EIDS_NO_MAX = 24;
/** DB CHECK kısıtıyla birebir aynı desen (migration 20260826002950). */
export const EIDS_NO_PATTERN = /^[A-Z0-9-]{6,24}$/;

export type EidsNoParse = { ok: true; value: string | null } | { ok: false; error: string };

/** Boş girdi geçerlidir (alan isteğe bağlı) ve null döner. */
export function parseEidsPropertyNo(raw: unknown): EidsNoParse {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const normalized = String(raw)
    .normalize("NFKC")
    .replace(/[\s._/\\]+/g, "")
    .replace(/[‐-―−]/g, "-")
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .toUpperCase();
  if (normalized === "") return { ok: true, value: null };
  if (!EIDS_NO_PATTERN.test(normalized)) {
    return {
      ok: false,
      error: `EİDS taşınmaz numarası ${EIDS_NO_MIN}-${EIDS_NO_MAX} karakterli olmalı; yalnız harf, rakam ve tire kullanılabilir.`,
    };
  }
  return { ok: true, value: normalized };
}

/** Sağlık skoru / süzgeç için: numara var ve biçimi geçerli mi. */
export function hasValidEidsNo(value: string | null | undefined): boolean {
  return typeof value === "string" && EIDS_NO_PATTERN.test(value);
}
