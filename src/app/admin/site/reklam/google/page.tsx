import { daysAgoIso } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { platformModuleMode } from "@/lib/platform-access";
import { buildAdsDashboard } from "@/lib/google/ads-dashboard";
import { adsRecommendations } from "@/lib/google/ads-rules";
import { attributedSignups, readAdsRows } from "@/lib/google/db";
import { readConnectionView } from "@/lib/google/read";
import { serviceCard } from "@/lib/google/view-model";
import { AdsView, type AdsPeriod } from "./ads-view";

export const metadata = { title: "Google Ads" };

type SP = { donem?: string };

/**
 * Google Ads panosu (modül `reklam`: super_admin + ops salt okur; billing/support göremez). Render sırasında Google API
 * çağrılmaz: yalnız `ads_daily_metrics` ve `signup_attributions` okunur. Bağlı değilse tablolar sorgulanmaz.
 */
export default async function GoogleAdsPage({ searchParams }: { searchParams?: Promise<SP> }) {
  const staff = await requirePlatformModule("reklam");
  const readonly = platformModuleMode(staff.role, "reklam") !== "write";
  const sp = (await searchParams) ?? {};
  const period: AdsPeriod = sp.donem === "90" ? 90 : 30;

  const view = await readConnectionView({ adsCustomerId: true });
  const card = serviceCard(view, "ads");
  const linked = card.status !== "bagli_degil";

  const since = daysAgoIso(period);
  const since30 = daysAgoIso(30);
  const [rows, signups, recentRows] = linked
    ? await Promise.all([
        readAdsRows(since.slice(0, 10)),
        attributedSignups(since),
        period === 30 ? Promise.resolve(null) : readAdsRows(since30.slice(0, 10)),
      ])
    : [null, null, null];

  const dashboard = rows ? buildAdsDashboard(rows, signups ?? []) : null;
  const recRows = period === 30 ? rows : recentRows;
  const customerId = view.adsCustomerId;
  const recommendations = recRows ? adsRecommendations(recRows, customerId) : [];

  return <AdsView data={{ card, period, customerId, dashboard, recommendations, readonly }} />;
}
