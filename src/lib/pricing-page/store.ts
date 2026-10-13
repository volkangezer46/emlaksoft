import { unstable_cache } from "next/cache";
import { createVersionedStore } from "@/lib/versioned-config/store";
import { parsePricingPage, type PricingPageContent } from "./schema";

/**
 * /fiyatlar metinleri depolama: ortak taslak/yayın/geçmiş kalıbı, anahtarlar
 *   pricingpage.live | pricingpage.draft | pricingpage.history  (platform_settings, yeni migration yok).
 * Yayın yoksa (null) sayfa bugünkü metinle çizilir (defaults.ts + buildFaq).
 */
export const PRICING_PAGE_CACHE_TAG = "pricing-page";

export const PRICING_PAGE_STORAGE_UNAVAILABLE =
  "Fiyatlar sayfası metinleri kaydedilemedi: platform ayarları tablosuna yazılamadı. Veritabanı bağlantısını ve platform_settings tablosunu kontrol edin.";

export const pricingPageStore = createVersionedStore<PricingPageContent>({
  prefix: "pricingpage",
  parseValue: parsePricingPage,
  unavailableMessage: PRICING_PAGE_STORAGE_UNAVAILABLE,
});

/** Yayındaki metin (önbellekli, etiketli; yazımda updateTag). Yayın yok/bozuk/okunamıyorsa null. */
export const getLivePricingPage = unstable_cache(
  async (): Promise<PricingPageContent | null> => {
    try {
      return await pricingPageStore.readLive();
    } catch {
      return null;
    }
  },
  ["pricing-page-live-v1"],
  { tags: [PRICING_PAGE_CACHE_TAG], revalidate: 300 },
);
