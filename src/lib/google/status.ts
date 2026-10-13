import type { GoogleService } from "./keys";
import { GOOGLE_QUOTAS, stopAt, type QuotaName } from "./quotas";
import type { QuotaRecord, TokenRecord } from "./token-store";

/**
 * Hizmet durumu (SAF). Ekran kartı, toplayıcı ve cron aynı kuralı kullanır:
 *  - bagli_degil: yenileme belirteci yok (ya da hizmetin ön koşulu eksik: mülk / Ads hesabı)
 *  - yeniden_bagla: Google `invalid_grant` döndü (iptal/7 gün Testing kipi/parola değişimi) ya da kayıt açılamadı
 *  - kota: bugünkü sayaç %80 eşiğine ulaştı (yarın kendiliğinden düzelir)
 *  - bagli: veri akıyor
 */

export type ServiceStatus = "bagli_degil" | "bagli" | "yeniden_bagla" | "kota";

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  bagli_degil: "Bağlı değil",
  bagli: "Bağlı",
  yeniden_bagla: "Yeniden bağla",
  kota: "Kota",
};

export const SERVICE_STATUS_TONE: Record<ServiceStatus, "info" | "ok" | "danger" | "warn"> = {
  bagli_degil: "info",
  bagli: "ok",
  yeniden_bagla: "danger",
  kota: "warn",
};

/** Günlük kotalar (Search Console analitiği dakikalıktır; günlük durum için URL Inspection sayacı esas alınır). */
const DAILY_LIMITS: Record<Exclude<QuotaName, "gsc">, number> = {
  inspection: GOOGLE_QUOTAS.inspectionPerDay,
  ads: GOOGLE_QUOTAS.adsPerDay,
};

export function quotaReached(name: Exclude<QuotaName, "gsc">, record: QuotaRecord | null, today: string): boolean {
  if (!record || record.day !== today) return false;
  return record.used >= stopAt(DAILY_LIMITS[name]);
}

export function computeServiceStatus(input: {
  token: TokenRecord | null;
  /** Kayıt var ama açılamadı / düz metin bulundu. */
  unreadable?: boolean;
  quotaReached?: boolean;
}): ServiceStatus {
  if (input.unreadable) return "yeniden_bagla";
  if (!input.token) return "bagli_degil";
  if (input.token.needsReconnect) return "yeniden_bagla";
  if (input.quotaReached) return "kota";
  return "bagli";
}

/** Toplayıcının "bağlantı kopuk" bulgusu yalnız yeniden bağlama durumunda üretilir (bağlı değil ≠ kopuk). */
export function isBroken(status: ServiceStatus): boolean {
  return status === "yeniden_bagla";
}

export function areaOf(service: GoogleService): "seo" | "reklam" {
  return service === "gsc" ? "seo" : "reklam";
}

/** Maskeli kimlik: ilk 4 + son 4 karakter ("1234…7890"); kısa değerler tamamen gizlenir. */
export function maskId(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (v.length <= 8) return "••••";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}
