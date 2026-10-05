import { lowBalanceState } from "@/lib/billing/credit-pack-purchase-core";
import { getEfCatalog, readEfBalance } from "@/lib/ef-credits/credit-reader";
import { getEfPublicState } from "@/lib/ef-credits/public-state";
import { canManageEfCredits, shouldShowLowBalanceBanner } from "@/lib/ef-credits/visibility";
import { KontorBandiKutu } from "./kontor-bandi-client";
import type { HomeCtx } from "./data";

const fmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

/**
 * Pano düşük kontör bandı: YALNIZ owner/gm, valuation modülü açık, EmlakFiyati canlı ve bakiye gerçekten düşük/boş iken.
 * Kapatılabilir (durum başına; boş -> düşük geçişinde yeniden çıkar). Hata/okunamama = band yok (sahte uyarı yok).
 */
export async function KontorBandi({ ctx, valuationClosed }: { ctx: HomeCtx; valuationClosed: boolean }) {
  if (!ctx.tenantId || ctx.tvMode || !canManageEfCredits(ctx.role) || valuationClosed) return null;
  try {
    const efState = await getEfPublicState();
    if (!efState.live) return null;
    const [balance, catalog] = await Promise.all([readEfBalance(ctx.tenantId), getEfCatalog()]);
    if (!balance) return null;
    const low = lowBalanceState(balance.available, catalog.tariff);
    if (!shouldShowLowBalanceBanner({ role: ctx.role, valuationClosed, efLive: efState.live, state: low.state })) return null;
    const empty = low.state === "empty";
    return (
      <KontorBandiKutu
        storageKey={`es:ef-low-banner:${ctx.tenantId}:${ctx.userId}:${low.state}`}
        empty={empty}
        href="/app/abonelik?sekme=kontor#paketler"
        actionLabel="Kontör paketlerini gör"
      >
        {empty ? (
          <>
            <span className="font-bold">Kontörünüz bitti.</span> Ada/parsel değerleme ve PDF rapor için kontör gerekir.
          </>
        ) : (
          <>
            <span className="font-bold">Kontörünüz azalıyor:</span> kalan {fmt.format(balance.available)} kontör.
          </>
        )}
      </KontorBandiKutu>
    );
  } catch {
    return null;
  }
}
