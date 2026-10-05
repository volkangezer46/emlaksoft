import { unstable_cache } from "next/cache";
import { getPlatformSettingsMany } from "@/lib/platform-settings";
import { TRY_DEFAULT_MAX_SHARE, TRY_MAX_SHARE_SETTING_KEY, parseMaxShare } from "./config";

export const TRY_CREDIT_CONFIG_CACHE_TAG = "try-credit-config";

const cachedShare = () =>
  unstable_cache(
    async (): Promise<string | null> => {
      const s = await getPlatformSettingsMany([TRY_MAX_SHARE_SETTING_KEY]);
      return s[TRY_MAX_SHARE_SETTING_KEY] ?? null;
    },
    ["try-credit-max-share-v1"],
    { revalidate: 60, tags: [TRY_CREDIT_CONFIG_CACHE_TAG] },
  );

/**
 * Tek faturada kredinin en yüksek payı (platform_settings `try_credit.max_invoice_share`; varsayılan 0.5).
 * Hata/kayıt yok = varsayılan. Değer `1` yapılırsa TAM kredi ile ödeme (iyzico'suz yol) açılır: sahip kararı.
 */
export async function getTryMaxShare(): Promise<number> {
  try {
    return parseMaxShare(await cachedShare()());
  } catch (e) {
    console.error("getTryMaxShare", e);
    return TRY_DEFAULT_MAX_SHARE;
  }
}
