import { getBrandAsset, getBrandMeta } from "@/lib/brand/store";
import { DEFAULT_BRAND_ASSETS, isBrandSlot, type BrandSlot } from "@/lib/brand/slots";

/**
 * Süper admin'in yüklediği platform markası (public, tenant bağımsız).
 * SVG yalnız <img>/favicon olarak kullanılır; doğrudan açılsa bile CSP sandbox ve
 * `nosniff` ile betik çalıştıramaz (yükleme anında zaten katı izin listesinden geçer).
 * Yüklenmiş dosya yoksa varsayılan marka dosyasına yönlendirir.
 */

const FALLBACK: Record<BrandSlot, string> = {
  "logo-light": DEFAULT_BRAND_ASSETS.horizontalLight,
  "logo-dark": DEFAULT_BRAND_ASSETS.horizontalDark,
  mark: DEFAULT_BRAND_ASSETS.markLight,
  favicon: DEFAULT_BRAND_ASSETS.favicon,
};

const SAFE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

export async function GET(request: Request, ctx: { params: Promise<{ slot: string }> }) {
  const { slot } = await ctx.params;
  if (!isBrandSlot(slot)) return new Response("Not found", { status: 404 });

  const [meta, asset] = await Promise.all([getBrandMeta(), getBrandAsset(slot)]);
  const info = meta.slots[slot];
  if (!info || !asset || asset.type !== info.type) {
    return new Response(null, {
      status: 307,
      headers: { Location: FALLBACK[slot], "Cache-Control": "public, max-age=60" },
    });
  }

  const versioned = new URL(request.url).searchParams.has("v");
  const cache = versioned
    ? "public, max-age=31536000, immutable"
    : "public, max-age=300, stale-while-revalidate=3600";

  if (asset.type === "svg") {
    return new Response(asset.data, {
      headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": cache, ...SAFE_HEADERS },
    });
  }
  return new Response(new Uint8Array(Buffer.from(asset.data, "base64")), {
    headers: { "Content-Type": "image/png", "Cache-Control": cache, ...SAFE_HEADERS },
  });
}
