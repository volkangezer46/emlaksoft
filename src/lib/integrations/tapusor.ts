/**
 * Tapusor (TUVİMER) entegrasyonu — ada/parsel sorgulama, yapay zeka "EDİ" değerlemesi,
 * yatırım puanı ve hukuki/teknik uyarılar. API anahtarı yoksa isTapusorConfigured()
 * false döner ve çağıran taraf (valuation.ts) bu kaynağı sessizce atlar.
 * Prod anahtar / kurumsal erişim: https://tapusor.com
 *
 * Öncelik: platform_settings DB → ortam değişkeni → yapılandırılmamış
 */

export type TapusorConfig = { apiKey: string; baseUrl: string };

/** Ortam değişkenlerinden config okur (DB'siz hızlı kontrol). */
export function getTapusorConfig(): TapusorConfig | null {
  const apiKey = process.env.TAPUSOR_API_KEY?.trim();
  const baseUrl = (process.env.TAPUSOR_BASE_URL?.trim() || "https://api.tapusor.com").replace(/\/$/, "");
  if (!apiKey) return null;
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
  const baseUrl = (
    dbBaseUrl?.trim() ||
    process.env.TAPUSOR_BASE_URL?.trim() ||
    "https://api.tapusor.com"
  ).replace(/\/$/, "");

  if (!apiKey) return null;
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

/** Ada/parsel veya bölge bazlı EDİ (yapay zeka) değerlemesi + yatırım puanı */
export async function getTapusorParcelInsight(input: {
  provinceName: string;
  districtName?: string | null;
  neighborhoodName?: string | null;
  ada?: string | null;
  parsel?: string | null;
}): Promise<TapusorParcelInsight> {
  const config = getTapusorConfig();
  if (!config) throw new Error("Tapusor yapılandırılmamış.");

  const res = await fetch(`${config.baseUrl}/v1/parcel-inquiry`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      province: input.provinceName,
      district: input.districtName || undefined,
      neighborhood: input.neighborhoodName || undefined,
      ada: input.ada || undefined,
      parsel: input.parsel || undefined,
    }),
  });
  if (!res.ok) throw new Error(`Tapusor API hatası (${res.status})`);
  const data = await res.json();

  return {
    investmentScore: data.investmentScore != null ? Number(data.investmentScore) : null,
    estimatedValue: data.estimatedValue != null ? Number(data.estimatedValue) : null,
    rentYieldMonths: data.rentYieldMonths != null ? Number(data.rentYieldMonths) : null,
    priceChange12m: data.priceChange12m != null ? Number(data.priceChange12m) : null,
    legalFlags: Array.isArray(data.legalFlags) ? data.legalFlags.map(String) : [],
  };
}
