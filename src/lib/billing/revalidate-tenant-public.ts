import { revalidatePath } from "next/cache";

/**
 * Ofis durumu/paketi değişince (askı, iptal, yeniden etkinleştirme, paket) PUBLIC önbellek tazelemesi: vitrin, ilan
 * detayı, değerleme, favoriler, danışman sayfası ve sitemap. Eski `updateTenantPlanStatus` (actions/platform.ts) ile
 * AYNI liste; Ofis 360 > Abonelik konsolu bunu kullanır ki iptal edilen ofisin sayfaları önbellekte yayında kalmasın.
 */
export function revalidateTenantPublicPaths(tenantSlug?: string | null): void {
  revalidatePath("/vitrin/[slug]", "page");
  revalidatePath("/vitrin/[slug]/[id]", "page");
  revalidatePath("/vitrin/[slug]/degerleme", "page");
  revalidatePath("/vitrin/[slug]/favoriler", "page");
  revalidatePath("/danisman/[slug]", "page");
  revalidatePath("/sitemap.xml");
  if (typeof tenantSlug === "string" && tenantSlug) revalidatePath(`/vitrin/${tenantSlug}`);
}
