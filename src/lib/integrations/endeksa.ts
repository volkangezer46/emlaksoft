/**
 * Endeksa API entegrasyonu — bölgesel fiyat endeksi + AVM (otomatik değerleme).
 * OAuth2 client-credentials + REST/JSON. Anahtar yoksa isEndeksaConfigured() false
 * döner ve çağıran taraf (valuation.ts) sessizce bu kaynağı atlar.
 * Prod anahtar: https://www.endeksa.com/tr/urunler/api-widget
 *
 * Öncelik: platform_settings DB → ortam değişkeni → yapılandırılmamış
 */

export type EndeksaConfig = { clientId: string; clientSecret: string; baseUrl: string };

/** Ortam değişkenlerinden config okur (sunucu tarafı — DB'siz hızlı kontrol). */
export function getEndeksaConfig(): EndeksaConfig | null {
  const clientId = process.env.ENDEKSA_CLIENT_ID?.trim();
  const clientSecret = process.env.ENDEKSA_CLIENT_SECRET?.trim();
  const baseUrl = (process.env.ENDEKSA_BASE_URL?.trim() || "https://api.endeksa.com").replace(/\/$/, "");
  if (!clientId || !clientSecret) return null;
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
  const baseUrl = (
    dbBaseUrl?.trim() ||
    process.env.ENDEKSA_BASE_URL?.trim() ||
    "https://api.endeksa.com"
  ).replace(/\/$/, "");

  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, baseUrl };
}

export function isEndeksaConfigured(): boolean {
  return getEndeksaConfig() != null;
}

/** DB dahil tam kontrol — sistem sayfası ve değerleme akışı için. */
export async function isEndeksaConfiguredFull(): Promise<boolean> {
  return (await getEndeksaConfigFull()) != null;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(config: EndeksaConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const res = await fetch(`${config.baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Endeksa kimlik doğrulama başarısız (${res.status})`);
  const data = await res.json();
  const token = data.access_token as string;
  cachedToken = { token, expiresAt: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000 };
  return token;
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

/** Bölge + tip bazlı otomatik değerleme (AVM) */
export async function getEndeksaValuation(input: {
  provinceName: string;
  districtName?: string | null;
  neighborhoodName?: string | null;
  propertyType?: string;
  sqm?: number | null;
  rooms?: string | null;
}): Promise<EndeksaValuation> {
  const config = getEndeksaConfig();
  if (!config) throw new Error("Endeksa yapılandırılmamış.");
  const token = await getAccessToken(config);

  const res = await fetch(`${config.baseUrl}/v1/valuation`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      province: input.provinceName,
      district: input.districtName || undefined,
      neighborhood: input.neighborhoodName || undefined,
      propertyType: input.propertyType || "residential",
      sqm: input.sqm || undefined,
      rooms: input.rooms || undefined,
    }),
  });
  if (!res.ok) throw new Error(`Endeksa API hatası (${res.status})`);
  const data = await res.json();

  const min = Number(data.valueMin ?? data.ValueMin ?? 0);
  const max = Number(data.valueMax ?? data.ValueMax ?? 0);
  return {
    valueMin: min,
    valueMax: max,
    valueAvg: Number(data.valueAvg ?? data.ValueAvg ?? (min + max) / 2),
    pricePerSqm: data.pricePerSqm != null ? Number(data.pricePerSqm) : null,
    priceChange12m: data.priceChange12m != null ? Number(data.priceChange12m) : null,
    sampleSize: data.sampleSize != null ? Number(data.sampleSize) : null,
    confidence: data.confidence != null ? Number(data.confidence) : 0.75,
  };
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
