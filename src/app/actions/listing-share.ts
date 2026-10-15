"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { isClosedListing } from "@/lib/closed-listing";
import { isPublicListingImage, selectWithDocumentFlag } from "@/lib/public-property-media";
import { pickSharePhotoIds, SHARE_MAX_PHOTOS, SHARE_MAX_PROPERTIES } from "@/lib/listing-share";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((v) => String(v ?? "")).filter((v) => UUID_RE.test(v)))].slice(0, SHARE_MAX_PROPERTIES);
}

export type SharePhotosResult = { ok: true; ids: string[] } | { ok: false; error: string };

/**
 * Yerel paylaşım sayfası (MP7) için paylaşılabilir fotoğraf id'leri — YALNIZ public kuralı geçen ilan görselleri
 * (yayında, kapalı olmayan portföy; belge değil; @/lib/public-property-media tek kural). İstemci dosyaları
 * `/api/property-media/<id>` public ucundan çeker; o uç da aynı kuralı uygular (filigranlı, vitrinle aynı görsel).
 * Kapak önce, portföyler arasında sırayla, en çok SHARE_MAX_PHOTOS.
 */
export async function listingSharePhotos(propertyIds: string[]): Promise<SharePhotosResult> {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return { ok: false, error: gate.error };
  const ids = cleanIds(propertyIds);
  if (ids.length === 0) return { ok: true, ids: [] };

  const supabase = await createClient();
  const { data: props, error: propErr } = await supabase
    .from("properties")
    .select("id, status, features")
    .eq("tenant_id", gate.tenantId)
    .in("id", ids)
    .is("deleted_at", null);
  if (propErr) return { ok: false, error: actionErrorMessage(propErr, "Paylaşılacak fotoğraflar okunamadı") };
  const liveIds = ((props ?? []) as { id: string; status: string | null; features: unknown }[])
    .filter((p) => p.status === "live" && !isClosedListing(p.features))
    .map((p) => p.id);
  if (liveIds.length === 0) return { ok: true, ids: [] };

  type MediaRow = { id: string; property_id: string; kind: string; file_type: string | null; file_name: string | null; is_document?: boolean | null };
  const { data: media, error } = await selectWithDocumentFlag<MediaRow[]>(
    "id, property_id, kind, file_type, file_name",
    (columns) =>
      supabase
        .from("property_media")
        .select(columns)
        .in("property_id", liveIds)
        .eq("kind", "image")
        .order("is_cover", { ascending: false })
        .order("sort_order", { ascending: true })
        .limit(SHARE_MAX_PHOTOS * 4),
  );
  if (error) return { ok: false, error: actionErrorMessage(error, "Paylaşılacak fotoğraflar okunamadı") };
  const publicRows = (media ?? []).filter((m) => isPublicListingImage(m));
  return { ok: true, ids: pickSharePhotoIds(publicRows, ids) };
}

/** Paylaşım tamamlandı: portföy geçmişine iz (kaç fotoğraf, hangi yüzeyden). Hata kullanıcıya yansımaz. */
export async function recordListingShare(
  propertyIds: string[],
  info: { photos: number; surface: "portfoy" | "sunum" },
): Promise<{ ok: boolean }> {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return { ok: false };
  const ids = cleanIds(propertyIds);
  const photos = Math.max(0, Math.min(SHARE_MAX_PHOTOS, Math.trunc(Number(info?.photos) || 0)));
  const surface = info?.surface === "sunum" ? "sunum" : "portfoy";
  await Promise.all(
    ids.slice(0, 5).map((id) =>
      logActivity({
        tenantId: gate.tenantId,
        actorId: gate.userId,
        action: "property.share",
        entityType: "property",
        entityId: id,
        newValue: { photos, surface },
      }),
    ),
  );
  return { ok: true };
}
