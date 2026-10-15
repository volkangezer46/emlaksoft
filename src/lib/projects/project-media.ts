import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * PF-04 — Proje galerisi okuyucusu. Dosyalar ÖZEL `project-media` kovasında (storage politikası yok); satır okuma
 * çağıranın istemcisiyle (panelde RLS, herkese açık sayfada tenant'a bağlı service_role), görsel adresleri yalnız
 * sunucunun ürettiği kısa ömürlü imzalı URL'lerdir. Tablo yoksa (migration bekliyor) `available:false`.
 */
export const PROJECT_MEDIA_BUCKET = "project-media";
export const PROJECT_MEDIA_MAX_BYTES = 3 * 1024 * 1024;
export const PROJECT_MEDIA_LIMIT = 40;
const SIGNED_TTL = 60 * 60;

export type ProjectMediaItem = {
  id: string;
  kind: "image" | "floorplan";
  caption: string | null;
  isCover: boolean;
  url: string | null;
  width: number | null;
  height: number | null;
};

const MISSING = new Set(["42P01", "PGRST205", "42703", "PGRST204"]);

export function isMissingSchemaError(error: { code?: string } | null | undefined): boolean {
  return Boolean(error?.code && MISSING.has(error.code));
}

export async function loadProjectMedia(
  client: SupabaseClient,
  input: { tenantId: string; projectId: string },
): Promise<{ available: boolean; items: ProjectMediaItem[] }> {
  const { data, error } = await client
    .from("project_media")
    .select("id, kind, caption, is_cover, storage_path, width, height, sort_order, created_at")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .order("is_cover", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(PROJECT_MEDIA_LIMIT);
  if (error) {
    if (!isMissingSchemaError(error)) console.error("loadProjectMedia", { code: error.code });
    return { available: !isMissingSchemaError(error), items: [] };
  }
  const rows = (data ?? []) as Array<{
    id: string;
    kind: string;
    caption: string | null;
    is_cover: boolean;
    storage_path: string;
    width: number | null;
    height: number | null;
  }>;
  // Yol mutlaka bu ofisin/projenin klasöründe: başka bir nesneye imza üretilmez.
  const prefix = `${input.tenantId}/${input.projectId}/`;
  const safe = rows.filter((r) => r.storage_path.startsWith(prefix) && !r.storage_path.includes(".."));
  const urlByPath = new Map<string, string>();
  if (safe.length > 0) {
    const { data: signed, error: signError } = await createAdminClient()
      .storage.from(PROJECT_MEDIA_BUCKET)
      .createSignedUrls(
        safe.map((r) => r.storage_path),
        SIGNED_TTL,
      );
    if (signError) console.error("loadProjectMedia sign", { name: signError.name });
    for (const s of signed ?? []) if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }
  return {
    available: true,
    items: safe.map((r) => ({
      id: r.id,
      kind: r.kind === "floorplan" ? "floorplan" : "image",
      caption: r.caption,
      isCover: r.is_cover,
      url: urlByPath.get(r.storage_path) ?? null,
      width: r.width,
      height: r.height,
    })),
  };
}
