import { aggregateAds, type AdsMetricRow } from "./ads-rules";

/**
 * Google Ads panosu modeli (SAF). Kampanya başına harcama, tıklama, dönüşüm, CPA ve EmlakSoft'taki GERÇEK kayıtlar:
 * `signup_attributions.utm_campaign` kampanya adı ya da kimliğiyle (büyük/küçük harf duyarsız) eşleşir.
 * CAC = harcama / atıflı kayıt; kayıt yoksa null (sıfıra bölme ya da uydurma değer yok). Dönüşüm yoksa CPA null.
 */

export type AdsCampaignRow = {
  campaignId: string;
  campaign: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpa: number | null;
  signups: number;
  cac: number | null;
};

export type AdsDashboard = {
  campaigns: AdsCampaignRow[];
  total: Omit<AdsCampaignRow, "campaignId" | "campaign">;
  /** Hiçbir kampanyayla eşleşmeyen atıflı (Google kaynaklı) kayıt sayısı. */
  unmatchedSignups: number;
};

const norm = (s: string) => s.trim().toLocaleLowerCase("tr-TR");

export function buildAdsDashboard(rows: readonly AdsMetricRow[], signups: ReadonlyArray<{ utm_campaign: string; count: number }>): AdsDashboard {
  const { campaigns } = aggregateAds(rows);
  const byKey = new Map<string, number>();
  for (const s of signups) byKey.set(norm(s.utm_campaign), (byKey.get(norm(s.utm_campaign)) ?? 0) + s.count);
  const used = new Set<string>();

  const out: AdsCampaignRow[] = [];
  for (const [id, c] of campaigns) {
    let matched = 0;
    for (const key of new Set([norm(c.name), norm(id)])) {
      if (key && byKey.has(key) && !used.has(key)) {
        matched += byKey.get(key)!;
        used.add(key);
      }
    }
    out.push({
      campaignId: id,
      campaign: c.name,
      spend: c.cost,
      clicks: c.clicks,
      impressions: c.impressions,
      conversions: c.conversions,
      cpa: c.conversions > 0 ? c.cost / c.conversions : null,
      signups: matched,
      cac: matched > 0 ? c.cost / matched : null,
    });
  }
  out.sort((a, b) => b.spend - a.spend);

  const spend = out.reduce((n, r) => n + r.spend, 0);
  const conversions = out.reduce((n, r) => n + r.conversions, 0);
  const signupsTotal = out.reduce((n, r) => n + r.signups, 0);
  let unmatched = 0;
  for (const [k, v] of byKey) if (!used.has(k)) unmatched += v;
  return {
    campaigns: out,
    total: {
      spend,
      clicks: out.reduce((n, r) => n + r.clicks, 0),
      impressions: out.reduce((n, r) => n + r.impressions, 0),
      conversions,
      cpa: conversions > 0 ? spend / conversions : null,
      signups: signupsTotal,
      cac: signupsTotal > 0 ? spend / signupsTotal : null,
    },
    unmatchedSignups: unmatched,
  };
}
