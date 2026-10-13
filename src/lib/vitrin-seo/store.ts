import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlatformSetting } from "@/lib/platform-settings";
import { SEO_CACHE_TAG } from "@/lib/seo/store";
import { vitrinRobots } from "@/lib/seo/patterns";
import {
  DEFAULT_NEVER_INDEX_SLUGS,
  VITRIN_NEVER_INDEX_KEY,
  isNeverIndexTenant,
  resolveNeverIndexList,
  type NeverIndexTenant,
} from "./never-index";

/**
 * Vitrin kalıcı noindex listesinin sunucu okuyucusu. Ayar (`seo.vitrin.never_index`) 300 sn önbellekli okunur
 * (SEO ayar etiketiyle düşer); okuma hatasında varsayılan liste (güvenli taraf: noindex).
 */
const readNeverIndexList = unstable_cache(
  async (): Promise<string[]> => resolveNeverIndexList(await getPlatformSetting(VITRIN_NEVER_INDEX_KEY)),
  ["vitrin-never-index-v1"],
  { revalidate: 300, tags: [SEO_CACHE_TAG] },
);

export async function loadNeverIndexList(): Promise<string[]> {
  try {
    return await readNeverIndexList();
  } catch (e) {
    console.error("vitrin noindex listesi okunamadı", e);
    return [...DEFAULT_NEVER_INDEX_SLUGS];
  }
}

/**
 * Vitrin/ilan/danışman robots kararı: kalıcı noindex kuralı ÖNCE, sonra ofisin arama onayı (`vitrinRobots`).
 * Tenant satırı `slug, sample_seeded_at, sample_cleared_at` taşımalıdır.
 */
export async function resolveVitrinRobots(optin: boolean, tenant: NeverIndexTenant): Promise<{ index: boolean; follow: boolean }> {
  const list = await loadNeverIndexList();
  return vitrinRobots(optin, isNeverIndexTenant(tenant, list));
}

/**
 * Sitemap uyumu (SP2 `sitemap-data.ts` dikişi için): vitrin girişi dışlanacak slug'lar için yüklem.
 * İstemci çağırandan gelir (service_role yalnız sitemap yükleyicisinde). Örnek veri sorgusu başarısızsa yalnız liste
 * uygulanır (örnek kiracılar zaten varsayılan olarak opt-in vermez).
 */
export async function loadVitrinSitemapExclusions(client: SupabaseClient): Promise<(slug: string) => boolean> {
  const list = await loadNeverIndexList();
  const sample = new Set<string>();
  const { data, error } = await client
    .from("tenants")
    .select("slug, sample_seeded_at, sample_cleared_at")
    .not("sample_seeded_at", "is", null)
    .is("sample_cleared_at", null)
    .limit(5000);
  if (!error) for (const r of (data ?? []) as { slug: string | null }[]) if (r.slug) sample.add(r.slug);
  return (slug: string) => sample.has(slug) || isNeverIndexTenant({ slug }, list);
}
