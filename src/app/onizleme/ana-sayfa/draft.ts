import "server-only";
import { draftHash } from "@/lib/preview-token";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { SiteContent } from "@/lib/site-content/schema";
import { siteContentStore } from "@/lib/site-content/store";

/**
 * Önizlenen içerik: kayıtlı taslak; taslak yoksa canlı; o da yoksa kod içi varsayılan (yönetim ekranıyla aynı sıra).
 * Önbelleksiz okunur (taslak değiştiği anda eski bağlantı geçersiz olsun). Özet, belirteçteki `draftHash` ile karşılaştırılır.
 */
export async function readPreviewDraft(): Promise<{ content: SiteContent; hash: string }> {
  const state = await siteContentStore.readState();
  const content = state.draft ?? state.live ?? defaultSiteContent();
  return { content, hash: draftHash(content) };
}
