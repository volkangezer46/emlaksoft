import "server-only";
import { getPlatformSettingsMany } from "@/lib/platform-settings";
import { siteContentStore } from "@/lib/site-content/store";
import { listSiteMedia, syncUsedBy } from "./store";
import { computeUsage } from "./usage";

/**
 * Medya kullanımının sunucu tarafı (yalnız sunucu): yayın + taslak yapılandırmasından SIKI okuma ve `used_by` eşitleme.
 * Sıkı okuma: platform_settings okunamazsa FIRLATIR. "Okunamadı" "kullanılmıyor" sayılırsa yayındaki görsel silinebilirdi
 * (silme kapısı hata anında açık kalırdı); çağıran hatada silmeyi reddeder.
 */
const parseRaw = (raw: string | null): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export async function readSiteMediaUsageStrict(): Promise<Map<string, string[]>> {
  const { live, draft } = siteContentStore.keys;
  const values = await getPlatformSettingsMany([live, draft], { strict: true });
  // Ham JSON'dan (şema doğrulaması olmadan): şemaya uymayan ama görsel başvurusu taşıyan değer de "kullanımda" sayılır.
  return computeUsage({ live: parseRaw(values[live] ?? null) as never, draft: parseRaw(values[draft] ?? null) as never });
}

/**
 * `used_by` sütununu yayın/taslaktan yeniden hesaplar. Site içeriği (taslak, yayın, geri dönüş, sıfırlama) ve medya
 * yazmalarının sonunda çağrılır. En iyi çaba: sütun bilgi amaçlıdır (silme kapısı her zaman anlık hesaplar), hata yutulur.
 */
export async function syncSiteMediaUsage(): Promise<void> {
  try {
    const list = await listSiteMedia();
    if (list.status !== "ok" || list.items.length === 0) return;
    await syncUsedBy(list.items, await readSiteMediaUsageStrict());
  } catch (e) {
    console.error("syncSiteMediaUsage", e);
  }
}
