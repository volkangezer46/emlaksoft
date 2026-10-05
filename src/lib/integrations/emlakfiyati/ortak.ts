import "server-only";

import { EF_ORTAK_FLAG_SETTING_KEY, EF_ORTAK_PROBE_OK_SETTING_KEY } from "@/lib/ef-credits/config";
import { derivePlatformHmac } from "@/lib/platform-secrets";
import { getPlatformSettingsMany } from "@/lib/platform-settings";
import { isPseudonymousUserRef } from "./ortak-contract";
import { isAcceptableOrtakRefInput, makeIdempotencyKey, type OrtakHeaders } from "./policy";

/**
 * "Ortak uçlar" (değerleme / rapor / PDF) KAPISI.
 *
 * Ortak v1 şeması EmlakFiyati'nın KESİN kılavuzuyla yazıldı (ORTAK_ENDPOINTS_VERIFIED = kod sözleşmeye uyar), ama uçlar CANLIDA
 * doğrulanmadı (mevcut anahtar `/kullanim` için 403 "operator veya admin yetkisi gerekli" döndü). Bu yüzden hiçbir ortak çağrı
 * şu ikisi birlikte sağlanmadan yapılmaz: (1) admin bayrağı AÇIK, (2) son ortak yoklaması (GET /kullanim 2xx) BAŞARILI.
 */
export const ORTAK_ENDPOINTS_VERIFIED = true;

export type OrtakGate =
  | { enabled: false; reason: "flag_off" | "pending_endpoints" | "probe_missing" }
  | { enabled: true };

function validIso(value: string | null | undefined): boolean {
  return Boolean(value) && !Number.isNaN(new Date(value as string).getTime());
}

export async function isOrtakFlagOn(): Promise<boolean> {
  const s = await getPlatformSettingsMany([EF_ORTAK_FLAG_SETTING_KEY]);
  return s[EF_ORTAK_FLAG_SETTING_KEY] === "1";
}

/** Çağıran, ortak uca gitmeden önce bunu sorar; `enabled:false` ise "etkin değil" gösterir. */
export async function ortakGate(): Promise<OrtakGate> {
  const s = await getPlatformSettingsMany([EF_ORTAK_FLAG_SETTING_KEY, EF_ORTAK_PROBE_OK_SETTING_KEY]);
  if (s[EF_ORTAK_FLAG_SETTING_KEY] !== "1") return { enabled: false, reason: "flag_off" };
  if (!ORTAK_ENDPOINTS_VERIFIED) return { enabled: false, reason: "pending_endpoints" };
  if (!validIso(s[EF_ORTAK_PROBE_OK_SETTING_KEY])) return { enabled: false, reason: "probe_missing" };
  return { enabled: true };
}

/** Son başarılı ortak yoklamasının ISO zamanı (yoksa null). */
export async function getOrtakProbeOkAt(): Promise<string | null> {
  const s = await getPlatformSettingsMany([EF_ORTAK_PROBE_OK_SETTING_KEY]);
  const v = s[EF_ORTAK_PROBE_OK_SETTING_KEY];
  return validIso(v) ? v : null;
}

/**
 * (tenant, kullanıcı) iç UUID çiftinden TAKMA, kararlı kullanıcı referansı üretir: `u-` + HMAC-SHA256 özetinin 32 hex'i
 * (anahtar sunucu sırrından alan-ayrımlı türetilir; geri çevrilemez; e-posta/telefon/TC/ad ASLA girmez).
 * Girdilerden biri UUID değilse veya sır anahtarı yoksa null. Çıktı en az bir rakam içerir (sözleşme şartı).
 */
export function makeOrtakUserRef(tenantId: string, userId: string): string | null {
  if (!isAcceptableOrtakRefInput(tenantId) || !isAcceptableOrtakRefInput(userId)) return null;
  const digest = derivePlatformHmac("ortak-kullanici-ref-v1", `${tenantId.trim().toLowerCase()}:${userId.trim().toLowerCase()}`);
  if (!digest) return null;
  for (const slice of [digest.slice(0, 32), digest.slice(32, 64)]) {
    const ref = `u-${slice}`;
    if (isPseudonymousUserRef(ref)) return ref;
  }
  return null;
}

/** Ortak uç başlık çifti (kullanıcı ref + idempotency). Girdi UUID değilse veya sır anahtarı yoksa null. */
export function makeOrtakHeaders(tenantId: string, userId: string, idempotencyKey?: string): OrtakHeaders | null {
  const userRef = makeOrtakUserRef(tenantId, userId);
  if (!userRef) return null;
  return { userRef, idempotencyKey: idempotencyKey ?? makeIdempotencyKey() };
}
