/**
 * Endeksa API entegrasyonu — bölgesel fiyat endeksi + AVM (otomatik değerleme).
 * OAuth2 client-credentials + REST/JSON. Anahtar yoksa isEndeksaConfigured() false
 * döner ve çağıran taraf (valuation.ts) sessizce bu kaynağı atlar.
 * Prod anahtar: https://www.endeksa.com/tr/urunler/api-widget
 *
 * Öncelik: platform_settings DB → ortam değişkeni → yapılandırılmamış
 */

import { createHash } from "node:crypto";
import {
  normalizeProviderBaseUrl,
  providerAllowedHosts,
  PROVIDER_REQUEST_TIMEOUT_MS,
} from "@/lib/integrations/provider-url";
import {
  externalErrorMetadata,
  fetchExternal,
  readExternalJson,
  requireExternalSuccess,
} from "@/lib/external-fetch";

export type EndeksaConfig = { clientId: string; clientSecret: string; baseUrl: string };

const ENDEKSA_DEFAULT_BASE_URL = "https://api.endeksa.com";
const ENDEKSA_TOKEN_MAX_RESPONSE_BYTES = 256 * 1024;
const ENDEKSA_VALUATION_MAX_RESPONSE_BYTES = 512 * 1024;

function endeksaBaseUrl(raw?: string | null): string | null {
  return normalizeProviderBaseUrl(
    raw?.trim() || ENDEKSA_DEFAULT_BASE_URL,
    providerAllowedHosts(
      [new URL(ENDEKSA_DEFAULT_BASE_URL).hostname],
      process.env.ENDEKSA_ALLOWED_HOSTS,
    ),
  );
}

/** Ortam değişkenlerinden config okur (sunucu tarafı — DB'siz hızlı kontrol). */
export function getEndeksaConfig(): EndeksaConfig | null {
  const clientId = process.env.ENDEKSA_CLIENT_ID?.trim();
  const clientSecret = process.env.ENDEKSA_CLIENT_SECRET?.trim();
  const baseUrl = endeksaBaseUrl(process.env.ENDEKSA_BASE_URL);
  if (!clientId || !clientSecret || !baseUrl) return null;
  return { clientId, clientSecret, baseUrl };
}

/** DB platform_settings öncelikli tam config (async — istek sırasında kullan). */
export async function getEndeksaConfigFull(): Promise<EndeksaConfig | null> {
  // Dinamik import: bu dosya "server-only" değil ama DB'ye yalnızca sunucudan erişilir
  const { getPlatformSetting } = await import("@/lib/platform-settings");
  const [dbClientId, dbClientSecret, dbBaseUrl] = await Promise.all([
    getPlatformSetting("endeksa_client_id"),
    getPlatformSetting("endeksa_client_secret"),
    getPlatformSetting("endeksa_base_url"),
  ]);

  const clientId = dbClientId?.trim() || process.env.ENDEKSA_CLIENT_ID?.trim();
  const clientSecret = dbClientSecret?.trim() || process.env.ENDEKSA_CLIENT_SECRET?.trim();
  const baseUrl = endeksaBaseUrl(
    dbBaseUrl?.trim() ||
    process.env.ENDEKSA_BASE_URL?.trim() ||
    ENDEKSA_DEFAULT_BASE_URL,
  );

  if (!clientId || !clientSecret || !baseUrl) return null;
  return { clientId, clientSecret, baseUrl };
}

export function isEndeksaConfigured(): boolean {
  return getEndeksaConfig() != null;
}

/** DB dahil tam kontrol — sistem sayfası ve değerleme akışı için. */
export async function isEndeksaConfiguredFull(): Promise<boolean> {
  return (await getEndeksaConfigFull()) != null;
}

let cachedToken: { token: string; expiresAt: number; configKey: string } | null = null;

function configKey(config: EndeksaConfig): string {
  return createHash("sha256")
    .update(`${config.baseUrl}\0${config.clientId}\0${config.clientSecret}`)
    .digest("hex");
}

async function getAccessToken(config: EndeksaConfig): Promise<string> {
  const key = configKey(config);
  if (cachedToken && cachedToken.configKey === key && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  try {
    const res = await fetchExternal(`${config.baseUrl}/oauth/token`, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    }, { timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS });
    await requireExternalSuccess(res);
    const data = await readExternalJson<Record<string, unknown>>(
      res,
      ENDEKSA_TOKEN_MAX_RESPONSE_BYTES,
    );
    const token = typeof data.access_token === "string" ? data.access_token.trim() : "";
    if (!token || token.length > 8_192) {
      throw new SyntaxError("Endeksa token response shape is invalid.");
    }
    const rawTtlSeconds = Number(data.expires_in ?? 3600);
    const ttlSeconds = Number.isFinite(rawTtlSeconds) && rawTtlSeconds > 0
      ? Math.min(rawTtlSeconds, 86_400)
      : 3_600;
    cachedToken = {
      token,
      configKey: key,
      expiresAt: Date.now() + Math.max(0, ttlSeconds - 60) * 1000,
    };
    return token;
  } catch (error) {
    console.error("Endeksa token request failed", externalErrorMetadata(error));
    throw new Error("Endeksa sağlayıcısına erişilemedi.");
  }
}

export type EndeksaValuation = {
  valueMin: number;
  valueMax: number;
  valueAvg: number;
  pricePerSqm: number | null;
  priceChange12m: number | null;
  sampleSize: number | null;
  confidence: number;
};

function finiteNumber(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new SyntaxError(`Endeksa ${field} alanı geçersiz.`);
  }
  return parsed;
}

function optionalFiniteNumber(
  value: unknown,
  field: string,
  predicate: (candidate: number) => boolean = () => true,
): number | null {
  if (value == null) return null;
  const parsed = finiteNumber(value, field);
  if (!predicate(parsed)) throw new SyntaxError(`Endeksa ${field} alanı geçersiz.`);
  return parsed;
}

/** Provider JSON is untrusted input; reject incomplete or impossible evidence. */
export function parseEndeksaValuationResponse(data: Record<string, unknown>): EndeksaValuation {
  const min = finiteNumber(data.valueMin ?? data.ValueMin, "valueMin");
  const max = finiteNumber(data.valueMax ?? data.ValueMax, "valueMax");
  const avg = finiteNumber(data.valueAvg ?? data.ValueAvg, "valueAvg");
  if (min <= 0 || max <= 0 || avg <= 0 || min > max || avg < min || avg > max) {
    throw new SyntaxError("Endeksa değer aralığı geçersiz.");
  }

  const pricePerSqm = optionalFiniteNumber(data.pricePerSqm, "pricePerSqm", (value) => value > 0);
  const priceChange12m = optionalFiniteNumber(data.priceChange12m, "priceChange12m");
  const sampleSize = optionalFiniteNumber(
    data.sampleSize,
    "sampleSize",
    (value) => Number.isInteger(value) && value >= 0,
  );
  const confidence = data.confidence == null
    ? 0
    : finiteNumber(data.confidence, "confidence");
  if (confidence < 0 || confidence > 1) {
    throw new SyntaxError("Endeksa confidence alanı geçersiz.");
  }

  return { valueMin: min, valueMax: max, valueAvg: avg, pricePerSqm, priceChange12m, sampleSize, confidence };
}

/** Bölge + tip bazlı otomatik değerleme (AVM) */
export async function getEndeksaValuation(input: {
  provinceName: string;
  districtName?: string | null;
  neighborhoodName?: string | null;
  propertyType?: string;
  sqm?: number | null;
  rooms?: string | null;
}): Promise<EndeksaValuation> {
  const config = (await getEndeksaConfigFull()) ?? getEndeksaConfig();
  if (!config) throw new Error("Endeksa yapılandırılmamış.");
  try {
    const token = await getAccessToken(config);
    const res = await fetchExternal(`${config.baseUrl}/v1/valuation`, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        province: input.provinceName,
        district: input.districtName || undefined,
        neighborhood: input.neighborhoodName || undefined,
        propertyType: input.propertyType || "residential",
        sqm: input.sqm || undefined,
        rooms: input.rooms || undefined,
      }),
    }, { timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS });
    await requireExternalSuccess(res);
    const data = await readExternalJson<Record<string, unknown>>(
      res,
      ENDEKSA_VALUATION_MAX_RESPONSE_BYTES,
    );

    return parseEndeksaValuationResponse(data);
  } catch (error) {
    console.error("Endeksa valuation request failed", externalErrorMetadata(error));
    throw new Error("Endeksa sağlayıcısına erişilemedi.");
  }
}

/** Bölge fiyat trendi (widget/rapor karşılığı — 12 aylık) */
export async function getEndeksaRegionTrend(input: {
  provinceName: string;
  districtName?: string | null;
}): Promise<{ changePct: number; label: string } | null> {
  try {
    const v = await getEndeksaValuation({ provinceName: input.provinceName, districtName: input.districtName });
    if (v.priceChange12m == null) return null;
    return { changePct: v.priceChange12m, label: `${input.districtName ?? input.provinceName} · 12 aylık` };
  } catch {
    return null;
  }
}
