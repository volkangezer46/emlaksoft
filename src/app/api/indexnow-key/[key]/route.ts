import { indexNowKeyMatches } from "@/lib/seo/store";

/**
 * IndexNow anahtar dosyası. Kökte `/<anahtar>.txt` olarak yayınlanır (next.config.ts rewrite'ı bu yola çevirir).
 * Yalnız IndexNow ETKİNse ve anahtar kayıtlı anahtarla eşleşirse içerik döner; aksi halde 404.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const key = (await ctx.params).key.replace(/\.txt$/i, "");
  if (!/^[a-f0-9]{32}$/.test(key) || !(await indexNowKeyMatches(key))) return new Response("Not found", { status: 404 });
  return new Response(key, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
