import { uploadSiteMedia } from "@/app/actions/site-media";
import { SITE_MEDIA_LIMITS } from "@/lib/site-media/quota";

/**
 * Medya yükleme ucu (POST multipart): sunucu eylemi gövde sınırı (4 MB) 8 MB giriş için yetmediğinden dosya bu rotayla
 * gelir; tüm kapı ve iş `uploadSiteMedia` eylemindedir (sitecontent modülü + süper admin, sniff, sharp, kota, denetim).
 * Sunucu eylemlerinin köken korumasının karşılığı: Origin başlığı istek sunucusuyla aynı olmalı (CSRF).
 */
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host.split(",")[0]!.trim();
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Geçersiz istek kaynağı." }, 403);
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > SITE_MEDIA_LIMITS.inputBytes + 256 * 1024) return json({ error: "Dosya en fazla 8 MB olabilir." }, 413);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Yükleme okunamadı." }, 400);
  }
  const res = await uploadSiteMedia(form);
  return json(res, res.error ? 400 : 200);
}
