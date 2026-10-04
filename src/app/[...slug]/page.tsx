import { notFound, permanentRedirect, redirect } from "next/navigation";
import { headers } from "next/headers";
import { now } from "@/lib/clock";
import { isProtectedFrom, resolveRedirect } from "@/lib/seo/redirects";
import { getRedirectMap, logNotFound } from "@/lib/seo/store";

/**
 * Hiçbir sayfayla eşleşmeyen yolların tek durağı (Next, daha özgül rotaları önce eşler; bu yalnız 404'e düşecek
 * yollarda çalışır — mevcut sayfaların performansına dokunmaz).
 *  1) /admin/seo "Yönlendirmeler" kuralı varsa 308/307 ile yönlendirir (sayfa akışından önce → doğru HTTP durumu).
 *  2) Yoksa 404'ü sayaçla (yalnız yol; IP/sorgu yok) ve 404 sayfasını gösterir.
 * Kural haritası süreç içi önbellekli (60 sn) ve ayar önbelleğindendir; istek başına veritabanı sorgusu YOKTUR.
 */
export const dynamic = "force-dynamic";

function decodeSeg(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export default async function UnmatchedPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const path = `/${slug.map(decodeSeg).join("/")}`;

  const map = await getRedirectMap(now());
  const hit = resolveRedirect(map, path);
  if (hit) {
    if (hit.status === 308) permanentRedirect(hit.to);
    redirect(hit.to);
  }

  if (!isProtectedFrom(path)) {
    let refHost: string | null = null;
    try {
      const ref = (await headers()).get("referer");
      refHost = ref ? new URL(ref).host.slice(0, 120) : null;
    } catch {
      refHost = null;
    }
    await logNotFound(path, refHost, now());
  }
  notFound();
}
