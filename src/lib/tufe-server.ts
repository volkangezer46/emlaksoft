import "server-only";
import { getPlatformSetting } from "@/lib/platform-settings";
import { TUFE_SETTING_KEY, builtinTufeTable, parseTufeTable, type TufeTable } from "@/lib/tufe";

/**
 * TÜFE tablosunu okur: platform_settings 'tufe.table' (JSON) varsa o, yoksa gömülü (doğrulanmamış) tablo.
 * Okuma mevcut `getPlatformSetting` üzerinden yapılır (yeni service_role kullanımı yok). Hata → gömülü tablo.
 */
export async function loadTufeTable(): Promise<TufeTable> {
  try {
    return parseTufeTable(await getPlatformSetting(TUFE_SETTING_KEY));
  } catch {
    return builtinTufeTable();
  }
}
