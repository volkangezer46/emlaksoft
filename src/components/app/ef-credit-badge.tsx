import Link from "next/link";
import { unstable_cache } from "next/cache";
import { Coins } from "lucide-react";
import { lowBalanceState } from "@/lib/billing/credit-pack-purchase-core";
import { getEfCatalog, readEfBalance } from "@/lib/ef-credits/credit-reader";
import { getEfPublicState } from "@/lib/ef-credits/public-state";
import { shouldShowEfBadge } from "@/lib/ef-credits/visibility";

/**
 * Uygulama başlığındaki KONTÖR ROZETİ (sunucu bileşeni). Yalnız: owner/gm veya valuation yetkisi olan kullanıcı,
 * valuation modülü açık, EmlakFiyati "live". Okuma ~30 sn önbellekli ve tenant anahtarlı; HER hata rozeti gizler (başlık kırılmaz).
 * Yeni service_role kullanımı yok: mevcut allowlist'li `readEfBalance` / `getEfCatalog` okuyucuları.
 */

type BadgeData = { available: number; state: "ok" | "low" | "empty" } | null;

const cachedBadgeData = unstable_cache(
  async (tenantId: string): Promise<BadgeData> => {
    try {
      const [balance, catalog] = await Promise.all([readEfBalance(tenantId), getEfCatalog()]);
      if (!balance) return null;
      return { available: balance.available, state: lowBalanceState(balance.available, catalog.tariff).state };
    } catch {
      return null;
    }
  },
  ["ef-credit-badge-v1"],
  { revalidate: 30 },
);

const fmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

const TONE: Record<"ok" | "low" | "empty", string> = {
  ok: "border-mint-500/20 bg-mint-500/10 text-mint-600 hover:border-mint-500/45",
  low: "border-amber-400/40 bg-amber-400/15 text-amber-700 hover:border-amber-400/70",
  empty: "border-danger-500/40 bg-danger-500/10 text-danger-600 hover:border-danger-500/70",
};

export async function EfCreditBadge({
  tenantId,
  role,
  canAccessValuation,
  valuationClosed,
  impersonating = false,
}: {
  tenantId: string;
  role: string | null | undefined;
  canAccessValuation: boolean;
  valuationClosed: boolean;
  impersonating?: boolean;
}) {
  try {
    // Ucuz kapılar önce: yetkisiz kullanıcı için hiçbir okuma yapılmaz.
    if (!shouldShowEfBadge({ role, canAccessValuation, valuationClosed, efLive: true, impersonating })) return null;
    const state = await getEfPublicState();
    if (!shouldShowEfBadge({ role, canAccessValuation, valuationClosed, efLive: state.live, impersonating })) return null;
    const data = await cachedBadgeData(tenantId);
    if (!data) return null;
    const label =
      data.state === "empty" ? "Kontör bitti" : data.state === "low" ? `Kontör azalıyor: ${fmt.format(data.available)}` : `${fmt.format(data.available)} kontör`;
    return (
      <Link
        href="/app/abonelik?sekme=kontor"
        title="EmlakFiyati kontör bakiyeniz. Ayrıntı, aylık hak ve paketler için tıklayın."
        aria-label={`${label}. Kontör merkezini aç`}
        className={`focus-ring press inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition ${TONE[data.state]}`}
      >
        <Coins className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="numeric">{label}</span>
      </Link>
    );
  } catch {
    return null;
  }
}
