import { createHash, randomInt } from "node:crypto";

/**
 * AKTARIM KODU (yalnız SUNUCU; node:crypto). Kısa ömürlü (varsayılan 2 saat), TEK KULLANIMLIK, oturum sahibine bağlı.
 * Ham kod DB'ye yazılmaz: SHA-256 özeti saklanır (`portal_transfer_sessions.code_hash`). Tüketim `pt_consume_code` RPC'sinde
 * atomiktir (ikinci kullanım "used", süre dolmuşsa "expired"). Alfabe: karışan karakterler (0/O, 1/I/L) yok.
 */

export const TRANSFER_CODE_TTL_MIN = 120;
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GROUP = 5;
const GROUPS = 2;

/** "ABCDE-FGHJK" biçiminde 10 karakterlik kod (≈ 49 bit). */
export function generateTransferCode(): string {
  let s = "";
  for (let i = 0; i < GROUP * GROUPS; i += 1) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, GROUP)}-${s.slice(GROUP)}`;
}

/** Kullanıcı girdisini kanonik hale getirir (küçük harf, boşluk, tire serbest). Geçersizse null. */
export function normalizeTransferCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.toUpperCase().replace(/[\s-]+/g, "");
  if (s.length !== GROUP * GROUPS) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return `${s.slice(0, GROUP)}-${s.slice(GROUP)}`;
}

export function hashTransferCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

export function hashPayloadSource(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export type CodeOutcome = "ok" | "invalid" | "used" | "expired" | "forbidden" | "property_not_found" | "invalid_input";

/** RPC sonucunu kullanıcıya gösterilecek Türkçe iletiye çevirir (saf). */
export function codeOutcomeMessage(outcome: string): string {
  switch (outcome) {
    case "invalid":
      return "Aktarım kodu bulunamadı. Portföy sayfasından yeniden “Portala aktar” deyin.";
    case "used":
      return "Bu aktarım kodu daha önce kullanıldı. Yeni bir aktarım başlatın.";
    case "expired":
      return "Aktarım kodunun süresi doldu. Yeni bir aktarım başlatın.";
    case "forbidden":
      return "Bu işlem için yetkiniz yok.";
    case "property_not_found":
      return "Portföy bulunamadı ya da size açık değil.";
    default:
      return "Aktarım başlatılamadı.";
  }
}
