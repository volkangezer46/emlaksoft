/**
 * Google Ads KURAL TABANLI öneriler (SAF; DB/ağ yok). Girdi: son N günün reklam grubu satırları (`ads_daily_metrics`).
 * Her öneri Türkçe açıklama ve Google Ads arayüzüne derin bağlantı taşır; değişikliği sahip orada yapar (burada yazma yok).
 *
 * Kurallar:
 *  - ads-spend-no-conversion: harcaması olan (en az eşik) ama dönüşümü 0 olan kampanya.
 *  - ads-adgroup-high-cpa: CPA'sı hesap ortalamasının 2 katını aşan reklam grubu (dönüşümü olan).
 *  - ads-budget-limited-efficient: bütçesi kısıtlı ama CPA'sı ortalamanın altında/eşit kampanya (bütçe artırılabilir).
 * Veri yoksa öneri yok; dönüşüm hiç yoksa ortalama CPA tanımsız → CPA kuralları çalışmaz (sahte ortalama YOK).
 */

export type AdsMetricRow = {
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
  budget_limited?: boolean;
};

/** Reklam grubu olmayan kampanyanın (PMax vb.) kampanya düzeyi satırı için yer tutucu reklam grubu kimliği. */
export const CAMPAIGN_ONLY_AD_GROUP_ID = "-";
export const CAMPAIGN_ONLY_AD_GROUP_LABEL = "(reklam grubu yok)";

export type AdsRecommendationCode = "ads-spend-no-conversion" | "ads-adgroup-high-cpa" | "ads-budget-limited-efficient";

export type AdsRecommendation = {
  code: AdsRecommendationCode;
  severity: "kritik" | "uyari" | "bilgi";
  campaignId: string;
  campaign: string;
  adGroupId: string | null;
  adGroup: string | null;
  title: string;
  explain: string;
  /** Google Ads arayüzü derin bağlantısı. */
  adsUrl: string;
  evidence: Record<string, number | string | null>;
};

export const ADS_RULES = {
  /** Dönüşümsüz harcama eşiği (hesap para birimi; mikro değil). */
  minSpendNoConversion: 250,
  /** En az tıklama: tesadüfi düşük veriyle öneri üretilmez. */
  minClicksNoConversion: 20,
  highCpaMultiplier: 2,
  /** Yüksek CPA için reklam grubunun en az harcaması (ortalama CPA cinsinden değil, mutlak). */
  minSpendHighCpa: 100,
} as const;

export const MICROS = 1_000_000;

export function adsCampaignUrl(campaignId: string, customerId?: string | null): string {
  const q = new URLSearchParams({ campaignId });
  if (customerId) q.set("__e", customerId);
  return `https://ads.google.com/aw/adgroups?${q.toString()}`;
}

export function adsAdGroupUrl(campaignId: string, adGroupId: string, customerId?: string | null): string {
  const q = new URLSearchParams({ campaignId, adGroupId });
  if (customerId) q.set("__e", customerId);
  return `https://ads.google.com/aw/keywords?${q.toString()}`;
}

type Agg = { cost: number; clicks: number; impressions: number; conversions: number; value: number; name: string; budgetLimitedLatest: boolean; latestDay: string };

function emptyAgg(name: string): Agg {
  return { cost: 0, clicks: 0, impressions: 0, conversions: 0, value: 0, name, budgetLimitedLatest: false, latestDay: "" };
}

function add(a: Agg, r: AdsMetricRow) {
  a.cost += r.cost_micros / MICROS;
  a.clicks += r.clicks;
  a.impressions += r.impressions;
  a.conversions += r.conversions;
  a.value += r.conv_value;
  if (r.day > a.latestDay) {
    a.latestDay = r.day;
    a.budgetLimitedLatest = Boolean(r.budget_limited);
  } else if (r.day === a.latestDay && r.budget_limited) {
    a.budgetLimitedLatest = true;
  }
}

const money = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
const round2 = (n: number) => Math.round(n * 100) / 100;

export function aggregateAds(rows: readonly AdsMetricRow[]) {
  const campaigns = new Map<string, Agg>();
  const groups = new Map<string, Agg & { campaignId: string; campaign: string; adGroupId: string }>();
  const total = emptyAgg("");
  for (const r of rows) {
    const c = campaigns.get(r.campaign_id) ?? emptyAgg(r.campaign);
    add(c, r);
    campaigns.set(r.campaign_id, c);
    const key = `${r.campaign_id}|${r.ad_group_id}`;
    const g = groups.get(key) ?? { ...emptyAgg(r.ad_group), campaignId: r.campaign_id, campaign: r.campaign, adGroupId: r.ad_group_id };
    add(g, r);
    groups.set(key, g);
    add(total, r);
  }
  const avgCpa = total.conversions > 0 ? total.cost / total.conversions : null;
  return { campaigns, groups, total, avgCpa };
}

export function adsRecommendations(rows: readonly AdsMetricRow[], customerId?: string | null): AdsRecommendation[] {
  if (rows.length === 0) return [];
  const { campaigns, groups, avgCpa } = aggregateAds(rows);
  const out: AdsRecommendation[] = [];

  for (const [id, c] of campaigns) {
    if (c.conversions === 0 && c.cost >= ADS_RULES.minSpendNoConversion && c.clicks >= ADS_RULES.minClicksNoConversion) {
      out.push({
        code: "ads-spend-no-conversion",
        severity: "uyari",
        campaignId: id,
        campaign: c.name,
        adGroupId: null,
        adGroup: null,
        title: `"${c.name}" harcıyor ama dönüşüm getirmiyor`,
        explain: `Bu kampanya ${money(c.cost)} harcadı, ${c.clicks} tıklama aldı ve hiç dönüşüm üretmedi. Anahtar kelimeleri ve açılış sayfasını gözden geçirin ya da kampanyayı Google Ads'te duraklatın.`,
        adsUrl: adsCampaignUrl(id, customerId),
        evidence: { harcama: round2(c.cost), tiklama: c.clicks, donusum: 0 },
      });
    }
  }

  if (avgCpa !== null && avgCpa > 0) {
    for (const g of groups.values()) {
      // Reklam grubu olmayan kampanyanın (PMax vb.) toplam satırı reklam grubu önerisi üretmez (derin bağlantısı yok).
      if (g.adGroupId === CAMPAIGN_ONLY_AD_GROUP_ID) continue;
      if (g.conversions <= 0 || g.cost < ADS_RULES.minSpendHighCpa) continue;
      const cpa = g.cost / g.conversions;
      if (cpa > avgCpa * ADS_RULES.highCpaMultiplier) {
        const gid = g.adGroupId;
        out.push({
          code: "ads-adgroup-high-cpa",
          severity: "uyari",
          campaignId: g.campaignId,
          campaign: g.campaign,
          adGroupId: gid,
          adGroup: g.name,
          title: `"${g.name}" reklam grubunda dönüşüm başı maliyet çok yüksek`,
          explain: `Bu reklam grubunda dönüşüm başı maliyet ${money(cpa)}; hesap ortalaması ${money(avgCpa)}. Ortalamanın ${ADS_RULES.highCpaMultiplier} katını aşıyor: teklifleri düşürmeyi ya da zayıf anahtar kelimeleri çıkarmayı Google Ads'te değerlendirin.`,
          adsUrl: adsAdGroupUrl(g.campaignId, gid, customerId),
          evidence: { cpa: round2(cpa), ortalama_cpa: round2(avgCpa), harcama: round2(g.cost), donusum: round2(g.conversions) },
        });
      }
    }

    for (const [id, c] of campaigns) {
      if (!c.budgetLimitedLatest || c.conversions <= 0) continue;
      const cpa = c.cost / c.conversions;
      if (cpa <= avgCpa) {
        out.push({
          code: "ads-budget-limited-efficient",
          severity: "bilgi",
          campaignId: id,
          campaign: c.name,
          adGroupId: null,
          adGroup: null,
          title: `"${c.name}" verimli ama bütçesi yetmiyor`,
          explain: `Bu kampanyanın dönüşüm başı maliyeti (${money(cpa)}) hesap ortalamasının (${money(avgCpa)}) altında, ancak Google bütçe yüzünden gösterimi kısıtlıyor. Günlük bütçeyi Google Ads'te artırmak daha çok kayıt getirebilir.`,
          adsUrl: adsCampaignUrl(id, customerId),
          evidence: { cpa: round2(cpa), ortalama_cpa: round2(avgCpa), donusum: round2(c.conversions) },
        });
      }
    }
  }

  return out;
}
