/**
 * Tapusor (TUVİMER) entegrasyonu — ada/parsel sorgulama, yapay zeka "EDİ" değerlemesi,
 * yatırım puanı ve hukuki/teknik uyarılar. API anahtarı yoksa isTapusorConfigured()
 * false döner ve çağıran taraf (valuation.ts) bu kaynağı sessizce atlar.
 * Prod anahtar / kurumsal erişim: https://tapusor.com
 *
 * Öncelik: platform_settings DB → ortam değişkeni → yapılandırılmamış
 */

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

export type TapusorConfig = { apiKey: string; baseUrl: string };

const TAPUSOR_DEFAULT_BASE_URL = "https://api.tapusor.com";
const TAPUSOR_MAX_RESPONSE_BYTES = 512 * 1024;

function tapusorBaseUrl(raw?: string | null): string | null {
  return normalizeProviderBaseUrl(
    raw?.trim() || TAPUSOR_DEFAULT_BASE_URL,
    providerAllowedHosts(
      [new URL(TAPUSOR_DEFAULT_BASE_URL).hostname],
      process.env.TAPUSOR_ALLOWED_HOSTS,
    ),
  );
}

/** Ortam değişkenlerinden config okur (DB'siz hızlı kontrol). */
export function getTapusorConfig(): TapusorConfig | null {
  const apiKey = process.env.TAPUSOR_API_KEY?.trim();
  const baseUrl = tapusorBaseUrl(process.env.TAPUSOR_BASE_URL);
  if (!apiKey || !baseUrl) return null;
  return { apiKey, baseUrl };
}

/** DB platform_settings öncelikli tam config (async). */
export async function getTapusorConfigFull(): Promise<TapusorConfig | null> {
  const { getPlatformSetting } = await import("@/lib/platform-settings");
  const [dbApiKey, dbBaseUrl] = await Promise.all([
    getPlatformSetting("tapusor_api_key"),
    getPlatformSetting("tapusor_base_url"),
  ]);

  const apiKey = dbApiKey?.trim() || process.env.TAPUSOR_API_KEY?.trim();
  const baseUrl = tapusorBaseUrl(
    dbBaseUrl?.trim() ||
    process.env.TAPUSOR_BASE_URL?.trim() ||
    TAPUSOR_DEFAULT_BASE_URL,
  );

  if (!apiKey || !baseUrl) return null;
  return { apiKey, baseUrl };
}

export function isTapusorConfigured(): boolean {
  return getTapusorConfig() != null;
}

/** DB dahil tam kontrol. */
export async function isTapusorConfiguredFull(): Promise<boolean> {
  return (await getTapusorConfigFull()) != null;
}

export type TapusorParcelInsight = {
  investmentScore: number | null;
  estimatedValue: number | null;
  rentYieldMonths: number | null;
  priceChange12m: number | null;
  legalFlags: string[];
};

function optionalProviderNumber(
  value: unknown,
  field: string,
  predicate: (candidate: number) => boolean = () => true,
): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || !predicate(parsed)) {
    throw new SyntaxError(`Tapusor ${field} alanı geçersiz.`);
  }
  return parsed;
}

/** Provider JSON is untrusted input; only bounded, meaningful evidence survives. */
export function parseTapusorParcelInsightResponse(
  data: Record<string, unknown>,
): TapusorParcelInsight {
  const legalFlags = data.legalFlags == null
    ? []
    : Array.isArray(data.legalFlags)
      ? data.legalFlags
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 50)
          .map((value) => value.slice(0, 500))
      : (() => { throw new SyntaxError("Tapusor legalFlags alanı geçersiz."); })();

  return {
    investmentScore: optionalProviderNumber(
      data.investmentScore,
      "investmentScore",
      (value) => value >= 0 && value <= 100,
    ),
    estimatedValue: optionalProviderNumber(
      data.estimatedValue,
      "estimatedValue",
      (value) => value > 0,
    ),
    rentYieldMonths: optionalProviderNumber(
      data.rentYieldMonths,
      "rentYieldMonths",
      (value) => value > 0,
    ),
    priceChange12m: optionalProviderNumber(data.priceChange12m, "priceChange12m"),
    legalFlags,
  };
}

/** Ada/parsel veya bölge bazlı EDİ (yapay zeka) değerlemesi + yatırım puanı */
export async function getTapusorParcelInsight(input: {
  provinceName: string;
  districtName?: string | null;
  neighborhoodName?: string | null;
  ada?: string | null;
  parsel?: string | null;
}): Promise<TapusorParcelInsight> {
  const config = (await getTapusorConfigFull()) ?? getTapusorConfig();
  if (!config) throw new Error("Tapusor yapılandırılmamış.");

  try {
    const res = await fetchExternal(`${config.baseUrl}/v1/parcel-inquiry`, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        province: input.provinceName,
        district: input.districtName || undefined,
        neighborhood: input.neighborhoodName || undefined,
        ada: input.ada || undefined,
        parsel: input.parsel || undefined,
      }),
    }, { timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS });
    await requireExternalSuccess(res);
    const data = await readExternalJson<Record<string, unknown>>(
      res,
      TAPUSOR_MAX_RESPONSE_BYTES,
    );

    return parseTapusorParcelInsightResponse(data);
  } catch (error) {
    console.error("Tapusor provider request failed", externalErrorMetadata(error));
    throw new Error("Tapusor sağlayıcısına erişilemedi.");
  }
}
