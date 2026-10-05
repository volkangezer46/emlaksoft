import { unstable_cache } from "next/cache";
import { createVersionedStore } from "@/lib/versioned-config/store";
import { defaultSiteContent } from "./defaults";
import { parseSiteContent, type SiteContent } from "./schema";

/**
 * Site içeriği depolama: ortak taslak/yayın/geçmiş kalıbı (src/lib/versioned-config/store.ts), anahtarlar
 *   sitecontent.live | sitecontent.draft | sitecontent.history  (platform_settings, yeni migration yok).
 */
export const SITE_CONTENT_CACHE_TAG = "site-content";

export const SITE_CONTENT_STORAGE_UNAVAILABLE =
  "Site içeriği kaydedilemedi: platform ayarları tablosuna yazılamadı. Veritabanı bağlantısını ve platform_settings tablosunu kontrol edin.";

export const siteContentStore = createVersionedStore<SiteContent>({
  prefix: "sitecontent",
  parseValue: parseSiteContent,
  unavailableMessage: SITE_CONTENT_STORAGE_UNAVAILABLE,
});

/**
 * Yayındaki içerik (önbellekli, etiketli; yazımda updateTag). Ayar yok/bozuk/okunamıyorsa varsayılan içerik:
 * site bugünkü metinle çalışır. Genel okuyucu SUNUCU bileşenlerde çağrılır; istemciye yalnız gereken metin gider.
 */
export const getLiveSiteContent = unstable_cache(
  async (): Promise<SiteContent> => (await siteContentStore.readLive()) ?? defaultSiteContent(),
  ["site-content-live-v1"],
  { tags: [SITE_CONTENT_CACHE_TAG], revalidate: 300 },
);
