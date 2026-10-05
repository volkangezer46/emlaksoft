import "server-only";

import { derivePlatformHmac } from "@/lib/platform-secrets";
import { getPlatformSetting } from "@/lib/platform-settings";
import { EF_SETTING } from "./keys";
import { isAcceptableOrtakRefInput, isValidOrtakUserRef, makeIdempotencyKey, type OrtakHeaders } from "./policy";

/**
 * "Ortak uçlar" (değerleme / PDF) KAPISI. EmlakFiyati bu uçları HENÜZ yayınlamadı (ortak v1 değerleme ve rapor PDF uçları):
 * şemalar DOĞRULANMADI, bu yüzden hiçbir çağrı yazılmadı.
 *
 * `ORTAK_ENDPOINTS_VERIFIED` EmlakFiyati şemayı teslim edip bu dosya güncellenene kadar false kalır; bayrak açık olsa bile
 * kapı "pending_endpoints" döner ve çağrı ÜRETİLMEZ.
 */
export const ORTAK_ENDPOINTS_VERIFIED = false;

export type OrtakGate =
  | { enabled: false; reason: "flag_off" | "pending_endpoints" }
  | { enabled: true };

export async function isOrtakFlagOn(): Promise<boolean> {
  return (await getPlatformSetting(EF_SETTING.ortakEnabled)) === "1";
}

/** Çağıran, ortak uca gitmeden önce bunu sorar; `enabled:false` ise "etkin değil" gösterir. */
export async function ortakGate(): Promise<OrtakGate> {
  if (!(await isOrtakFlagOn())) return { enabled: false, reason: "flag_off" };
  if (!ORTAK_ENDPOINTS_VERIFIED) return { enabled: false, reason: "pending_endpoints" };
  return { enabled: true };
}

/**
 * Emlaksoft iç kullanıcı UUID'sinden TAKMA, kararlı kullanıcı referansı üretir (HMAC-SHA256, anahtar PLATFORM_SECRETS_KEY'den
 * alan-ayrımlı türetilir; geri çevrilemez). E-posta/telefon/TC/ad gibi UUID olmayan girdi REDDEDİLİR (null).
 * Çıktı biçimi: `u_` + 48 hex (8-64 karakter, [A-Za-z0-9_.:-]).
 */
export function makeOrtakUserRef(internalUserId: string): string | null {
  if (!isAcceptableOrtakRefInput(internalUserId)) return null;
  const digest = derivePlatformHmac("ortak-kullanici-ref-v1", internalUserId.trim().toLowerCase());
  if (!digest) return null;
  const ref = `u_${digest.slice(0, 48)}`;
  return isValidOrtakUserRef(ref) ? ref : null;
}

/** Ortak uç başlık çifti (kullanıcı ref + idempotency). Girdi UUID değilse veya sır anahtarı yoksa null. */
export function makeOrtakHeaders(internalUserId: string, idempotencyKey?: string): OrtakHeaders | null {
  const userRef = makeOrtakUserRef(internalUserId);
  if (!userRef) return null;
  return { userRef, idempotencyKey: idempotencyKey ?? makeIdempotencyKey() };
}
