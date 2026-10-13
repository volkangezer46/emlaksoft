import { downloadVariant, getSiteMediaView } from "@/lib/site-media/store";
import { SITE_MEDIA_ID_RE, VARIANT_FILE_RE } from "@/lib/site-media/types";

/**
 * Site medyası sunumu (public, aynı köken): /medya/<uuid>/<varyant>. Kova ÖZELDİR; bayt service_role ile sunucuda okunur.
 * `file` YALNIZ kayıtlı varyant adıyla eşleşir (desen + kayıt listesi); `..`, eğik çizgi ve bilinmeyen ad 404.
 * Dosya adı içerik sürümü taşıdığı için içerik DEĞİŞMEZ: kalıcı önbellek. site-menu-asset deseni: nosniff + CSP sandbox
 * (doğrudan açılsa bile betik çalışmaz). Varyantlar sunucuda yeniden kodlanmış AVIF/WebP'tir; tür adından belirlenir.
 */

const SAFE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  // Önizleme iframe'i sandbox'lı (opak köken): same-origin olsaydı görsel orada yüklenmezdi.
  "Cross-Origin-Resource-Policy": "cross-origin",
} as const;

const notFound = () =>
  new Response("Not found", { status: 404, headers: { ...SAFE_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=60" } });

export async function GET(_request: Request, ctx: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await ctx.params;
  if (typeof id !== "string" || typeof file !== "string" || file.includes("..") || file.includes("/") || file.includes("\\")) return notFound();
  if (!SITE_MEDIA_ID_RE.test(id) || !VARIANT_FILE_RE.test(file)) return notFound();

  const media = await getSiteMediaView(id).catch(() => null);
  const variant = media?.variants.find((v) => v.file === file);
  if (!variant) return notFound();

  const body = await downloadVariant(id, variant.file).catch(() => null);
  if (!body) return notFound();
  return new Response(new Uint8Array(body), {
    headers: {
      ...SAFE_HEADERS,
      "Content-Type": `image/${variant.format}`,
      "Content-Length": String(body.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
