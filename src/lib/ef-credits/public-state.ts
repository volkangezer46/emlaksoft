import { unstable_cache } from "next/cache";
import { now } from "@/lib/clock";
import { EF_ORTAK_FLAG_SETTING_KEY, EF_ORTAK_PROBE_OK_SETTING_KEY } from "@/lib/ef-credits/config";
import { getEfCreditReady } from "@/lib/ef-credits/credit-reader";
import { decideEfPublicState, efPublicStatusOf, type EfPublicStatus } from "@/lib/ef-credits/public-state-core";
import { resolveEmlakFiyatiKeys } from "@/lib/integrations/emlakfiyati/keys";
import { getPlatformSettingsMany } from "@/lib/platform-settings";

export * from "@/lib/ef-credits/public-state-core";

/** Mevcut önbellek etiketi (ef-status.ts ve admin eylemlerinin revalidate ettiği etiket ile aynı). */
export const EF_PUBLIC_STATE_CACHE_TAG = "ef-valuation-status";

/**
 * Tek durum kaynağı (önbellekli, ~60 sn). Hata/okunamama = "soon" (para alan yollar kapalı kalır, hata fırlatmaz).
 */
export const getEfPublicState = unstable_cache(
  async (): Promise<EfPublicStatus> => {
    try {
      const [s, keys] = await Promise.all([
        getPlatformSettingsMany([EF_ORTAK_FLAG_SETTING_KEY, EF_ORTAK_PROBE_OK_SETTING_KEY]),
        resolveEmlakFiyatiKeys(),
      ]);
      const flag = s[EF_ORTAK_FLAG_SETTING_KEY];
      const key = Boolean(keys.current);
      const walletReady = key && Boolean(flag) ? await getEfCreditReady() : false;
      return efPublicStatusOf(
        decideEfPublicState({ key, flag, probeAt: s[EF_ORTAK_PROBE_OK_SETTING_KEY], now: now(), walletReady }),
      );
    } catch (e) {
      console.error("getEfPublicState", e);
      return efPublicStatusOf("soon");
    }
  },
  ["ef-public-state-v1"],
  { tags: [EF_PUBLIC_STATE_CACHE_TAG], revalidate: 60 },
);
