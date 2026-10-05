import { unstable_cache } from "next/cache";
import { now } from "@/lib/clock";
import { decideEfPublicState } from "@/lib/ef-credits/public-state-core";

/**
 * EmlakFiyati değerleme özelliği CANLI mı? Karar TEK KAYNAKTAN gelir (`ef-credits/public-state`): vitrin yalnız "live" iken
 * "canlı" der; stale/maintenance/soon hepsi vitrinde "soon" (Yakında rozeti) görünür, "şimdi deneyin" denmez.
 */
export type EfValuationStatus = "live" | "soon";

/** Saf karar (anahtar ve cüzdan hazır varsayılır; bayrak + TAZE yoklama gerekir). Geriye dönük uyumlu imza. */
export function efValuationStatus(flagRaw: string | null | undefined, probeOkAt: string | null | undefined): EfValuationStatus {
  return decideEfPublicState({ key: true, flag: flagRaw, probeAt: probeOkAt, now: now(), walletReady: true }) === "live" ? "live" : "soon";
}

export const EF_STATUS_CACHE_TAG = "ef-valuation-status";

/** Sunucuda, kısa süreli etiketli önbellekten okunur: ana sayfa statik kalır (dinamik render yok), durum ~1 dk içinde güncellenir. */
export const getEfValuationStatus = unstable_cache(
  async (): Promise<EfValuationStatus> => {
    // Tembel içe aktarma: saf `efValuationStatus` testlerde sunucu modüllerini (server-only, admin client) yüklemesin.
    const { getEfPublicState } = await import("@/lib/ef-credits/public-state");
    return (await getEfPublicState()).live ? "live" : "soon";
  },
  ["ef-valuation-status-v2"],
  { tags: [EF_STATUS_CACHE_TAG], revalidate: 60 },
);
