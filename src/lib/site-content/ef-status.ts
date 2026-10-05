import { unstable_cache } from "next/cache";
import { EF_ORTAK_FLAG_SETTING_KEY, EF_ORTAK_PROBE_OK_SETTING_KEY } from "@/lib/ef-credits/config";
import { parseSettingBool } from "@/lib/platform-setting-keys";
import { getPlatformSettingsMany } from "@/lib/platform-settings";

/**
 * EmlakFiyati değerleme özelliği CANLI mı? Dürüst gösterim: yalnız ortak bayrak AÇIK ve son ortak yoklaması (probe) başarılı
 * kaydedilmişse "live"; aksi halde "soon" (ana sayfada "Yakında" rozeti, "şimdi deneyin" denmez). Saf karar `efValuationStatus`.
 */
export type EfValuationStatus = "live" | "soon";

export function efValuationStatus(flagRaw: string | null | undefined, probeOkAt: string | null | undefined): EfValuationStatus {
  const enabled = parseSettingBool(flagRaw, false);
  const probed = typeof probeOkAt === "string" && probeOkAt.trim() !== "";
  return enabled && probed ? "live" : "soon";
}

export const EF_STATUS_CACHE_TAG = "ef-valuation-status";

/** Sunucuda, kısa süreli etiketli önbellekten okunur: ana sayfa statik kalır (dinamik render yok), durum ~1 dk içinde güncellenir. */
export const getEfValuationStatus = unstable_cache(
  async (): Promise<EfValuationStatus> => {
    const v = await getPlatformSettingsMany([EF_ORTAK_FLAG_SETTING_KEY, EF_ORTAK_PROBE_OK_SETTING_KEY]);
    return efValuationStatus(v[EF_ORTAK_FLAG_SETTING_KEY], v[EF_ORTAK_PROBE_OK_SETTING_KEY]);
  },
  ["ef-valuation-status-v1"],
  { tags: [EF_STATUS_CACHE_TAG], revalidate: 60 },
);
