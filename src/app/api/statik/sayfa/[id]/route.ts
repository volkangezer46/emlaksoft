import { hasValidStaticRewrite } from "@/lib/static-home/internal-token";
import { respondStatic, staticNotFound } from "@/lib/static-home/render";
import { staticRouteById } from "@/lib/static-home/registry";

/**
 * STATİK SAYFA UÇ NOKTASI: proxy (src/lib/supabase/middleware.ts) kayıt defterindeki AÇIK bir sayfanın belge isteğini
 * buraya yeniden yazar ve `x-static-rewrite` iç jetonunu ekler (src/lib/static-home/internal-token.ts).
 *  - Jeton yok/uyuşmuyor → 404 (doğrudan erişim kapalı).
 *  - Yalnız kayıt kimliği kabul edilir (serbest yol parametresi yok); bilinmeyen ya da kalıcı kapalı kimlik → 404.
 *  - Kaynak `${origin}${kayıt.yol}` (sorgu dizesi atılır), önbellek anahtarı kimliktir (src/lib/static-home/render.ts).
 * Kapatma: Hız ekranındaki anahtar (≤60 sn, yeniden başlatmasız) ya da env `STATIC_HOME=off` / `STATIC_PAGES=off`.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await hasValidStaticRewrite(request.headers))) return staticNotFound();
  const { id } = await ctx.params;
  const route = staticRouteById(id);
  if (!route || route.disabled) return staticNotFound();
  return respondStatic(route, request);
}

export const HEAD = GET;
