import { MEDIA_MIME, type MediaType } from "@/lib/site-menu/media";
import { readStoredMedia } from "@/lib/site-menu/store";

/**
 * Site menüsü medyası (public). Kimlik her yüklemede benzersizdir, bu yüzden içerik DEĞİŞMEZ ve CDN'de
 * kalıcı önbelleklenir. Tür yükleme anında bayt içeriğinden doğrulanmıştır; SVG ayrıca katı izin listesinden geçer
 * ve burada CSP sandbox + nosniff ile sunulur (doğrudan açılsa bile betik çalışmaz). Safari için Range desteği vardır.
 */

const SAFE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Cache-Control": "public, max-age=31536000, immutable",
  "Accept-Ranges": "bytes",
};

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const stored = await readStoredMedia(id);
  if (!stored || !(stored.type in MEDIA_MIME)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=30" } });

  const body = stored.enc === "text" ? Buffer.from(stored.data, "utf8") : Buffer.from(stored.data, "base64");
  const contentType = MEDIA_MIME[stored.type as MediaType];
  const total = body.length;

  const range = request.headers.get("range");
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] !== "" || m[2] !== "")) {
    let start = m[1] === "" ? Math.max(0, total - Number(m[2])) : Number(m[1]);
    let end = m[1] === "" || m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
    if (start >= total || start > end) {
      return new Response(null, { status: 416, headers: { ...SAFE_HEADERS, "Content-Range": `bytes */${total}` } });
    }
    start = Math.max(0, start);
    end = Math.max(start, end);
    const part = body.subarray(start, end + 1);
    return new Response(new Uint8Array(part), {
      status: 206,
      headers: { ...SAFE_HEADERS, "Content-Type": contentType, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(part.length) },
    });
  }

  return new Response(new Uint8Array(body), {
    headers: { ...SAFE_HEADERS, "Content-Type": contentType, "Content-Length": String(total) },
  });
}
