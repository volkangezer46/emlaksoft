import { hasValidStaticRewrite } from "@/lib/static-home/internal-token";
import { respondStatic, staticNotFound } from "@/lib/static-home/render";
import { staticRouteById } from "@/lib/static-home/registry";

/**
 * ESKİ ADRES (geriye uyum): ana sayfa artık `/api/statik/sayfa/home` üzerinden sunulur (proxy oraya yeniden yazar).
 * Bu rota aynı iç jeton kapısıyla korunur ve aynı önbelleği kullanır; jetonsuz (doğrudan) istek 404 alır.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await hasValidStaticRewrite(request.headers))) return staticNotFound();
  return respondStatic(staticRouteById("home")!, request);
}

export const HEAD = GET;
