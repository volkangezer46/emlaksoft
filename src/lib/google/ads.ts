import { CAMPAIGN_ONLY_AD_GROUP_ID, CAMPAIGN_ONLY_AD_GROUP_LABEL } from "./ads-rules";
import { googleJson, type GoogleDeps } from "./http";
import { QuotaExceededError } from "./quotas";

/**
 * Google Ads (YALNIZ OKUMA). Bu modül yalnız `googleAds:searchStream` ve `googleAds:search` uç noktalarını çağırabilir;
 * adres yalnız `adsEndpoint()` ile kurulur ve yöntem izin listesi dışındaysa fırlatır (sözleşme testi). Reklam hesabında
 * değişiklik yapan hiçbir uç nokta kodda yoktur: bütçe/teklif değişikliğini sahip Google Ads arayüzünde yapar.
 *
 * Günlük çekim İKİ GAQL sorgusudur: reklam grubu satırları (`FROM ad_group`) + kampanya toplamları (`FROM campaign`).
 * Reklam grubu olmayan kampanyalar (Performance Max vb.) yalnız ikinci sorguda görünür; o kampanya-gün için hiç reklam
 * grubu satırı yoksa kampanya toplamı `CAMPAIGN_ONLY_AD_GROUP_ID` satırı olarak eklenir (çift sayım yok).
 */

export const ADS_HOST = "https://googleads.googleapis.com";
/** Varsayılan API sürümü; Google sürümleri yaklaşık 12 ayda emekliye ayırır, Ads ayarlarından değiştirilebilir. */
export const ADS_DEFAULT_API_VERSION = "v22";
export const ADS_ALLOWED_METHODS = ["searchStream", "search"] as const;
export type AdsMethod = (typeof ADS_ALLOWED_METHODS)[number];

/** Rakam dışı karakterler atılır ("123-456-7890" → "1234567890"); 10 hane değilse null. */
export function normalizeCustomerId(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return /^\d{10}$/.test(digits) ? digits : null;
}

export function isValidApiVersion(v: string | null | undefined): v is string {
  return typeof v === "string" && /^v\d{2,3}$/.test(v);
}

export function adsEndpoint(customerId: string, method: AdsMethod, apiVersion: string = ADS_DEFAULT_API_VERSION): string {
  if (!(ADS_ALLOWED_METHODS as readonly string[]).includes(method)) throw new Error("İzin verilmeyen Google Ads yöntemi.");
  const cid = normalizeCustomerId(customerId);
  if (!cid) throw new Error("Geçersiz Google Ads müşteri kimliği.");
  const version = isValidApiVersion(apiVersion) ? apiVersion : ADS_DEFAULT_API_VERSION;
  return `${ADS_HOST}/${version}/customers/${cid}/googleAds:${method}`;
}

export type AdsDailyRow = {
  day: string;
  campaign_id: string;
  campaign: string;
  ad_group_id: string;
  ad_group: string;
  cost_micros: number;
  clicks: number;
  impressions: number;
  conversions: number;
  conv_value: number;
  /** Kampanya bütçe kısıtlı mı (primary_status_reasons içinde BUDGET_CONSTRAINED). */
  budget_limited: boolean;
};

/** GAQL: reklam grubu + kampanya metrikleri tek sorguda (yalnız SELECT). */
export function buildDailyQuery(startDate: string, endDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error("Geçersiz tarih.");
  return [
    "SELECT segments.date, campaign.id, campaign.name, campaign.primary_status_reasons,",
    "ad_group.id, ad_group.name, metrics.cost_micros, metrics.clicks, metrics.impressions,",
    "metrics.conversions, metrics.conversions_value",
    "FROM ad_group",
    `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
  ].join(" ");
}

/** GAQL: kampanya düzeyi günlük toplamlar (reklam grubu olmayan kampanyalar dahil; yalnız SELECT). */
export function buildCampaignDailyQuery(startDate: string, endDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error("Geçersiz tarih.");
  return [
    "SELECT segments.date, campaign.id, campaign.name, campaign.primary_status_reasons,",
    "metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value",
    "FROM campaign",
    `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
  ].join(" ");
}

type ApiResultRow = {
  segments?: { date?: string };
  campaign?: { id?: string | number; name?: string; primaryStatusReasons?: string[] };
  adGroup?: { id?: string | number; name?: string };
  metrics?: {
    costMicros?: string | number;
    clicks?: string | number;
    impressions?: string | number;
    conversions?: number;
    conversionsValue?: number;
  };
};

const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
};

export function mapAdsRow(r: ApiResultRow, campaignLevel = false): AdsDailyRow | null {
  const day = r.segments?.date;
  const cid = r.campaign?.id;
  const gid = campaignLevel ? CAMPAIGN_ONLY_AD_GROUP_ID : r.adGroup?.id;
  if (!day || cid == null || gid == null) return null;
  return {
    day,
    campaign_id: String(cid),
    campaign: (r.campaign?.name ?? "").slice(0, 300),
    ad_group_id: String(gid),
    ad_group: (campaignLevel ? CAMPAIGN_ONLY_AD_GROUP_LABEL : (r.adGroup?.name ?? "")).slice(0, 300),
    cost_micros: Math.max(0, Math.round(num(r.metrics?.costMicros))),
    clicks: Math.max(0, Math.round(num(r.metrics?.clicks))),
    impressions: Math.max(0, Math.round(num(r.metrics?.impressions))),
    conversions: Math.max(0, num(r.metrics?.conversions)),
    conv_value: Math.max(0, num(r.metrics?.conversionsValue)),
    budget_limited: (r.campaign?.primaryStatusReasons ?? []).includes("BUDGET_CONSTRAINED"),
  };
}

export type AdsAccess = {
  customerId: string;
  loginCustomerId: string | null;
  developerToken: string;
  accessToken: string;
  apiVersion?: string | null;
};

function headers(a: AdsAccess): Record<string, string> {
  const h: Record<string, string> = {
    authorization: `Bearer ${a.accessToken}`,
    "developer-token": a.developerToken,
    "content-type": "application/json",
  };
  const mcc = normalizeCustomerId(a.loginCustomerId);
  if (mcc) h["login-customer-id"] = mcc;
  return h;
}

/**
 * Reklam grubu satırlarına, hiç reklam grubu satırı olmayan kampanya-günlerin kampanya toplamını ekler (SAF).
 * Reklam grubu satırı olan kampanya-gün kampanya toplamından EKLENMEZ: aynı harcama iki kez sayılmaz.
 */
export function mergeCampaignOnlyRows<T extends { day: string; campaign_id: string }>(adGroupRows: readonly T[], campaignRows: readonly T[]): T[] {
  const covered = new Set(adGroupRows.map((r) => `${r.day}|${r.campaign_id}`));
  const extra = campaignRows.filter((r) => !covered.has(`${r.day}|${r.campaign_id}`));
  return [...adGroupRows, ...extra];
}

/**
 * Günlük metrikler (iki searchStream isteği; yanıt parça dizisidir). Kota kapısı her istekte 1 işlem sayar.
 */
export async function fetchAdsDaily(
  input: AdsAccess & { startDate: string; endDate: string; quota?: { tryConsume(n?: number): boolean } },
  deps: GoogleDeps = {},
): Promise<AdsDailyRow[]> {
  const url = adsEndpoint(input.customerId, "searchStream", input.apiVersion ?? undefined);
  const stream = async (query: string, campaignLevel: boolean): Promise<AdsDailyRow[]> => {
    if (input.quota && !input.quota.tryConsume(1)) throw new QuotaExceededError("ads");
    const batches = await googleJson<Array<{ results?: ApiResultRow[] }>>(
      url,
      { method: "POST", headers: headers(input), body: JSON.stringify({ query }), cache: "no-store" },
      deps,
      32 * 1024 * 1024,
    );
    const rows: AdsDailyRow[] = [];
    for (const b of Array.isArray(batches) ? batches : []) {
      for (const r of b.results ?? []) {
        const row = mapAdsRow(r, campaignLevel);
        if (row) rows.push(row);
      }
    }
    return rows;
  };
  const adGroupRows = await stream(buildDailyQuery(input.startDate, input.endDate), false);
  const campaignRows = await stream(buildCampaignDailyQuery(input.startDate, input.endDate), true);
  return mergeCampaignOnlyRows(adGroupRows, campaignRows);
}

/** Erişilebilir hesap doğrulaması (search, tek satır): kurulum sihirbazındaki "bağlantıyı dene" için. */
export async function probeAdsAccount(input: AdsAccess, deps: GoogleDeps = {}): Promise<{ name: string | null; currency: string | null }> {
  const url = adsEndpoint(input.customerId, "search", input.apiVersion ?? undefined);
  const res = await googleJson<{ results?: Array<{ customer?: { descriptiveName?: string; currencyCode?: string } }> }>(
    url,
    {
      method: "POST",
      headers: headers(input),
      body: JSON.stringify({ query: "SELECT customer.descriptive_name, customer.currency_code FROM customer LIMIT 1" }),
      cache: "no-store",
    },
    deps,
  );
  const c = res.results?.[0]?.customer;
  return { name: c?.descriptiveName ?? null, currency: c?.currencyCode ?? null };
}
