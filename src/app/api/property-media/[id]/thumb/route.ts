import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { isSafeTenantObjectPath } from "@/lib/file-validation";
import { THUMB_CACHE_CONTROL, THUMB_QUALITY, THUMB_SIZES, thumbDigest, thumbSizeOf } from "@/lib/property-media-thumb";
import { log } from "@/lib/log";
import { errorFields } from "@/lib/log-error";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_MIME_RE = /^image\/(?:jpeg|png|webp|avif|gif)$/i;
const SOURCE_MAX_BYTES = 25 * 1024 * 1024;

type StorageBucket = ReturnType<ReturnType<typeof createAdminClient>["storage"]["from"]>;
type TransformOptions = NonNullable<NonNullable<Parameters<StorageBucket["download"]>[1]>["transform"]>;

/**
 * Portföy listesi küçük resmi (B031): 160×120 WebP (`?s=kart` → 480×288), yetkili ve tarayıcıda kalıcı önbellekli.
 *
 * Kapı `/download` ile AYNI: `properties:view` + RLS'li satır okuma + açık tenant eşitliği + güvenli depo yolu.
 * Dönüşüm depo katmanında (Supabase Storage render → imgproxy, `ENABLE_IMAGE_TRANSFORMATION`); render
 * kullanılamazsa sunucuda sharp ile aynı boyuta indirilir. Yanıt `private` (paylaşılan önbelleğe girmez) ama
 * `max-age=31536000, immutable`: URL'deki `v` içerik özetidir (`propertyThumbUrl`), görsel değişince URL değişir.
 * `v` güncel özetle eşleşmezse (bayat bağlantı) uzun önbellek verilmez.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 403 });

  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Dosya bulunamadı" }, { status: 404 });
  const supabase = await createClient();
  const { data: media } = await supabase
    .from("property_media")
    .select("property_id, storage_path, file_type, file_size, has_watermark")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (
    !media?.storage_path ||
    !IMAGE_MIME_RE.test(String(media.file_type ?? "")) ||
    !isSafeTenantObjectPath(media.storage_path, gate.tenantId, media.property_id)
  ) {
    return NextResponse.json({ error: "Dosya bulunamadı" }, { status: 404 });
  }

  const url = new URL(req.url);
  // Kova private: indirme service_role ile, YALNIZ yukarıda tenant + yol doğrulaması geçen nesne için.
  const bucket = createAdminClient().storage.from("property-media");
  const thumb = await renderThumb(bucket, media.storage_path, THUMB_SIZES[thumbSizeOf(url.searchParams.get("s"))]);
  if (!thumb) return NextResponse.json({ error: "Küçük resim üretilemedi" }, { status: 502 });

  const requested = url.searchParams.get("v");
  const fresh = requested != null && requested === thumbDigest(media);
  return new Response(new Uint8Array(thumb.bytes), {
    headers: {
      "Content-Type": thumb.type,
      "Content-Length": String(thumb.bytes.byteLength),
      "Cache-Control": fresh ? THUMB_CACHE_CONTROL : "private, no-cache",
      "CDN-Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function renderThumb(
  bucket: StorageBucket,
  storagePath: string,
  size: { width: number; height: number },
): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  // Depo render ucu `format=webp` kabul eder (storage-api şeması: origin|avif|webp); istemci tipi yalnız 'origin' yazar.
  const transform = {
    width: size.width,
    height: size.height,
    resize: "cover",
    quality: THUMB_QUALITY,
    format: "webp",
  } as unknown as TransformOptions;
  const rendered = await bucket.download(storagePath, { transform });
  if (!rendered.error && rendered.data && rendered.data.size > 0) {
    return { bytes: await rendered.data.arrayBuffer(), type: rendered.data.type || "image/webp" };
  }

  // Yedek yol: render kapalı/hatalıysa özgün görseli indirip sharp ile küçült (EXIF de atılır).
  try {
    const original = await bucket.download(storagePath);
    if (original.error || !original.data || original.data.size > SOURCE_MAX_BYTES) return null;
    const { default: sharp } = await import("sharp");
    const webp = await sharp(Buffer.from(await original.data.arrayBuffer()), { limitInputPixels: 60_000_000 })
      .rotate()
      .resize(size.width, size.height, { fit: "cover" })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
    return { bytes: webp.buffer.slice(webp.byteOffset, webp.byteOffset + webp.byteLength) as ArrayBuffer, type: "image/webp" };
  } catch (e) {
    log.error("property_media_thumb_failed", { route: "/api/property-media/[id]/thumb", ...errorFields(e) });
    return null;
  }
}
