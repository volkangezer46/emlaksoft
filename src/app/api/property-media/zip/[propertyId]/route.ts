import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { checkRateLimit } from "@/lib/rate-limit";
import { logActivity } from "@/lib/activity";
import { log } from "@/lib/log";
import { errorFields } from "@/lib/log-error";
import { buildContentDisposition, isSafeTenantObjectPath } from "@/lib/file-validation";
import { isDocumentMedia, isPublicListingImage } from "@/lib/public-property-media";
import { selectWithMediaMeta } from "@/lib/media/meta-query";
import { splitFloorPlans } from "@/lib/media/room-tags";
import { buildZipEntryNames, createZipStream, zipDownloadName, type ZipStreamEntry } from "@/lib/media/zip-stream";
import { sanitizeWatermarkSettings } from "@/lib/watermark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** En çok bu kadar görsel paketlenir (fazlası OKUBENI.txt ile bildirilir). */
const ZIP_MAX_ITEMS = 60;
/** Toplam ham boyut sınırı (ilan görselleri 2048 px'e küçültülüyor; 60 görsel tipik olarak < 60 MB). */
const ZIP_MAX_TOTAL_BYTES = 250 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOGO_PATH_RE = /\/tenant-logos\/([0-9a-f-]{36})\/(logo\.(?:png|jpg|webp))(?:\?.*)?$/i;

type ZipMediaRow = {
  id: string;
  kind: string;
  storage_path: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  is_cover: boolean;
  has_watermark: boolean | null;
  is_document?: boolean | null;
  room_tag?: string | null;
  caption?: string | null;
};

function textResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Portföy fotoğraflarını SIRALI ZIP olarak indirir (PF-09). Ofis içi uç: `properties:view` + satırların kiracı
 * doğrulaması (RLS'li kullanıcı istemcisi), depo indirmesi admin istemcisiyle (bucket private).
 *   - Yalnız ilan görselleri: belge (tapu, yetki belgesi; KVKK P0-9), video ve tur bağlantıları ZIP'e girmez.
 *   - Sıra galeriyle aynı: kapak önce, sonra sürükle/oklarla verilen sıra; kat planları en sonda. Adlar "01-salon.jpg".
 *   - `?filigran=1`: yüklenirken damgalanmamış görsellere ofis filigranı basılır (depodaki dosya değişmez).
 *   - Akışla yazılır (bellekte tek dosya), en çok 60 görsel / 250 MB; hız sınırı ve denetim kaydı vardır.
 */
export async function GET(req: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return textResponse(gate.error ?? "Bu işlem için yetkiniz yok.", 403);
  const { tenantId, userId } = gate;

  const { propertyId } = await params;
  if (!UUID_RE.test(propertyId ?? "")) return textResponse("Portföy bulunamadı.", 404);

  const rate = await checkRateLimit(`property-media-zip:${gate.userId}`, { limit: 12, windowSec: 600, failurePolicy: "allow" });
  if (!rate.allowed) return textResponse("Kısa sürede çok fazla indirme yapıldı. Birkaç dakika sonra yeniden deneyin.", 429);

  const watermarkRequested = new URL(req.url).searchParams.get("filigran") === "1";
  const supabase = await createClient();

  const [{ data: property }, mediaRes, tenantRes] = await Promise.all([
    supabase
      .from("properties")
      .select("id, property_code, title")
      .eq("id", propertyId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle(),
    selectWithMediaMeta<ZipMediaRow[]>(
      "id, kind, storage_path, file_name, file_type, file_size, is_cover, has_watermark",
      (columns) =>
        supabase
          .from("property_media")
          .select(columns)
          .eq("property_id", propertyId)
          .eq("tenant_id", gate.tenantId)
          .eq("kind", "image")
          .order("is_cover", { ascending: false })
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true })
          .limit(500),
    ),
    watermarkRequested
      ? supabase.from("tenants").select("name, logo_url, watermark_settings").eq("id", gate.tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!property) return textResponse("Portföy bulunamadı.", 404);
  if (mediaRes.error) {
    log.error("property_media_zip_query_failed", { route: "/api/property-media/zip/[propertyId]", ...errorFields(mediaRes.error) });
    return textResponse("Fotoğraflar okunamadı. Lütfen yeniden deneyin.", 500);
  }

  const publicRows = (mediaRes.data ?? []).filter(
    (m) =>
      isPublicListingImage(m) &&
      !isDocumentMedia(m) &&
      Boolean(m.storage_path) &&
      isSafeTenantObjectPath(m.storage_path, gate.tenantId, propertyId),
  );
  const { photos, floorPlans } = splitFloorPlans(publicRows);
  const ordered = [...photos, ...floorPlans];
  if (ordered.length === 0) return textResponse("Bu portföyde indirilecek fotoğraf yok.", 404);

  // Sınırlar: sayı ve toplam boyut (file_size bilinmiyorsa indirme sırasında sayılır).
  const notes: string[] = [];
  let selected = ordered.slice(0, ZIP_MAX_ITEMS);
  if (ordered.length > ZIP_MAX_ITEMS) {
    notes.push(`Portföyde ${ordered.length} görsel var; ZIP en çok ${ZIP_MAX_ITEMS} görsel içerir. İlk ${ZIP_MAX_ITEMS} görsel eklendi.`);
  }
  let declared = 0;
  const withinSize: ZipMediaRow[] = [];
  for (const m of selected) {
    declared += Math.max(0, Number(m.file_size) || 0);
    if (declared > ZIP_MAX_TOTAL_BYTES) break;
    withinSize.push(m);
  }
  if (withinSize.length < selected.length) {
    notes.push(`Toplam boyut ${Math.round(ZIP_MAX_TOTAL_BYTES / 1024 / 1024)} MB sınırını aştığı için ${selected.length - withinSize.length} görsel eklenmedi.`);
    selected = withinSize;
  }
  const names = buildZipEntryNames(selected);

  const admin = createAdminClient();

  // Filigran (isteğe bağlı): ofis ayarı + logo bir kez hazırlanır; damgasız görsellere basılır.
  let stamp: ((data: Uint8Array, fileType: string | null) => Promise<Uint8Array>) | null = null;
  if (watermarkRequested) {
    const brand = (tenantRes.data ?? null) as { name: string | null; logo_url: string | null; watermark_settings: unknown } | null;
    const settings = { ...sanitizeWatermarkSettings(brand?.watermark_settings ?? null), enabled: true };
    const { buildWatermarkMark, prepareLogo, stampImage } = await import("@/lib/media/server-watermark");
    let logo = null;
    const logoMatch = settings.mode !== "text" ? LOGO_PATH_RE.exec(brand?.logo_url ?? "") : null;
    if (logoMatch && logoMatch[1].toLowerCase() === gate.tenantId.toLowerCase()) {
      const { data: logoBlob } = await admin.storage.from("tenant-logos").download(`${gate.tenantId}/${logoMatch[2]}`);
      if (logoBlob) logo = await prepareLogo(Buffer.from(await logoBlob.arrayBuffer()));
    }
    const mark = await buildWatermarkMark(settings, { text: settings.text || brand?.name || "", logo }).catch((e: unknown) => {
      log.warn("property_media_zip_mark_failed", { route: "/api/property-media/zip/[propertyId]", ...errorFields(e) });
      return null;
    });
    if (mark) {
      stamp = async (data, fileType) => (await stampImage(data, fileType, mark, settings)) ?? data;
    } else {
      notes.push("Filigran hazırlanamadı (ofis adı ya da logo bulunamadı); görseller filigransız eklendi.");
    }
  }

  let delivered = 0;
  const failed: string[] = [];
  async function load(index: number): Promise<ZipStreamEntry | null> {
    const m = selected[index];
    try {
      const { data: blob, error } = await admin.storage.from("property-media").download(m.storage_path as string);
      if (error || !blob) throw error ?? new Error("blob yok");
      let data: Uint8Array = new Uint8Array(await blob.arrayBuffer());
      if (stamp && !m.has_watermark) data = await stamp(data, m.file_type);
      return { name: names[index], data };
    } catch (e) {
      log.warn("property_media_zip_item_failed", { route: "/api/property-media/zip/[propertyId]", ...errorFields(e) });
      failed.push(names[index]);
      return null;
    }
  }

  async function* entries(): AsyncGenerator<ZipStreamEntry> {
    // Bir sonraki dosya, mevcut dosya yazılırken indirilir (tek dosya ileri okuma; bellek sınırlı kalır).
    let pending: Promise<ZipStreamEntry | null> | null = selected.length > 0 ? load(0) : null;
    for (let i = 0; i < selected.length; i += 1) {
      const current = await pending;
      pending = i + 1 < selected.length ? load(i + 1) : null;
      if (current) {
        delivered += 1;
        yield current;
      }
    }
    if (failed.length > 0) notes.push(`Okunamayan görseller atlandı: ${failed.join(", ")}`);
    if (notes.length > 0) {
      yield { name: "OKUBENI.txt", data: new TextEncoder().encode(`${notes.join("\r\n")}\r\n`) };
    }
    void logActivity({
      tenantId,
      actorId: userId,
      action: "property_media.zip_download",
      entityType: "property",
      entityId: propertyId,
      newValue: { count: delivered, watermark: Boolean(stamp), skipped: failed.length },
    });
  }

  const fileName = zipDownloadName(property.property_code as string | null, property.title as string | null, Boolean(stamp));
  return new Response(createZipStream(entries(), { modifiedAt: new Date() }), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": buildContentDisposition("attachment", fileName),
      "Cache-Control": "private, no-store, max-age=0",
      "CDN-Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
