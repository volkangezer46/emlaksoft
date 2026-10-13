import { unstable_cache } from "next/cache";
import { getPlatformSetting, setPlatformSetting } from "@/lib/platform-settings";

/**
 * Ölçüm ayarları: `platform_settings["measure.settings"]` (JSON, doğrudan anahtar; ayar kayıt defterine bilerek
 * eklenmedi — `settings/registry/platform.ts` başka paketin dosyası). Varsayılan: sayaç ve hız ölçümü AÇIK,
 * atıf taşıma KAPALI. Atıf taşımayı yalnız süper admin, "Aydınlatma metnine kayıt kaynağı maddesi eklendi" onayıyla
 * açar; onay zamanı `attributionLegalAt` olarak saklanır (P3).
 */
export const MEASURE_SETTINGS_KEY = "measure.settings";
export const MEASURE_CACHE_TAG = "measure-settings";

export type MeasureSettings = {
  pageviews: boolean;
  vitals: boolean;
  attribution: boolean;
  attributionLegalAt: string | null;
};

export const MEASURE_DEFAULTS: MeasureSettings = { pageviews: true, vitals: true, attribution: false, attributionLegalAt: null };

/** Ham değeri güvenle çözer; bozuksa varsayılan. Onay zamanı yoksa atıf taşıma AÇILMAZ (savunma). */
export function parseMeasureSettings(raw: string | null | undefined): MeasureSettings {
  if (!raw) return { ...MEASURE_DEFAULTS };
  let obj: Record<string, unknown>;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return { ...MEASURE_DEFAULTS };
    obj = v as Record<string, unknown>;
  } catch {
    return { ...MEASURE_DEFAULTS };
  }
  const legalAt = typeof obj.attributionLegalAt === "string" && !Number.isNaN(Date.parse(obj.attributionLegalAt)) ? obj.attributionLegalAt : null;
  return {
    pageviews: typeof obj.pageviews === "boolean" ? obj.pageviews : MEASURE_DEFAULTS.pageviews,
    vitals: typeof obj.vitals === "boolean" ? obj.vitals : MEASURE_DEFAULTS.vitals,
    attribution: obj.attribution === true && legalAt !== null,
    attributionLegalAt: legalAt,
  };
}

export async function readMeasureSettingsFresh(): Promise<MeasureSettings> {
  return parseMeasureSettings(await getPlatformSetting(MEASURE_SETTINGS_KEY));
}

/** Önbellekli okuma (public altbilgi, beacon ucu): 5 dk + yazmada etiket düşürme. */
export const getMeasureSettings = unstable_cache(async (): Promise<MeasureSettings> => readMeasureSettingsFresh(), ["measure-settings-v1"], {
  tags: [MEASURE_CACHE_TAG],
  revalidate: 300,
});

export async function writeMeasureSettings(next: MeasureSettings, staffId: string): Promise<boolean> {
  return setPlatformSetting(MEASURE_SETTINGS_KEY, JSON.stringify(next), staffId);
}
