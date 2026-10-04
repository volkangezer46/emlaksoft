import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluatePhotoQuality, isPhotoGap, type PhotoMedia, type PhotoQualityReport } from "./evaluate";

/**
 * Foto kalite denetimi — sunucu okuyucuları. Oturumlu istemci (RLS) kullanılır; service_role yok.
 * `property_media` tablosu/kolonları yoksa ya da okunamıyorsa denetim "etkin değil" döner (uydurma sonuç yok).
 * Mevcut property_media yönetim/public sorgularına dokunulmaz; burada yalnız yeni salt-okunur sorgular vardır.
 */

const BASE_COLS = "id, kind, is_cover, file_size, file_type, file_name, sort_order";

type MediaRow = Omit<PhotoMedia, "is_document"> & { is_document?: boolean | null };

/** is_document kolonu bazı ortamlarda henüz yok: önce onunla dener, hata olursa onsuz tekrar eder. */
async function readPropertyMedia(supabase: SupabaseClient, propertyId: string): Promise<MediaRow[] | null> {
  const run = async (cols: string) => {
    const res = await supabase
      .from("property_media")
      .select(cols)
      .eq("property_id", propertyId)
      .eq("kind", "image")
      .order("sort_order", { ascending: true })
      .limit(300);
    return { rows: res.error ? null : ((res.data ?? []) as unknown as MediaRow[]), error: res.error };
  };
  const withDoc = await run(`${BASE_COLS}, is_document`);
  if (withDoc.rows) return withDoc.rows;
  const plain = await run(BASE_COLS);
  return plain.rows;
}

export type PhotoQualityLoad = { enabled: false } | { enabled: true; report: PhotoQualityReport };

export async function loadPhotoQuality(supabase: SupabaseClient, propertyId: string): Promise<PhotoQualityLoad> {
  const rows = await readPropertyMedia(supabase, propertyId);
  if (!rows) return { enabled: false };
  return { enabled: true, report: evaluatePhotoQuality(rows as PhotoMedia[]) };
}

/** "Foto eksik" filtresinin listeye verdiği en çok id (PostgREST URL sınırı). */
export const PHOTO_GAP_ID_CAP = 150;
const PROPERTY_SCAN = 2000;
const MEDIA_SCAN = 20000;

export type PhotoGap = { enabled: boolean; ids: string[]; total: number; truncated: boolean };

/**
 * Fotoğrafı eksik (az sayıda veya kapaksız) portföy kimlikleri. Mevcut portföylerin sayı + kapak
 * durumundan hesaplanır; liste sorgusuna `id in (...)` olarak iner.
 */
export async function fetchPhotoGapIds(supabase: SupabaseClient): Promise<PhotoGap> {
  const [props, media] = await Promise.all([
    supabase.from("properties").select("id").is("deleted_at", null).order("created_at", { ascending: false }).limit(PROPERTY_SCAN),
    supabase.from("property_media").select("property_id, is_cover").eq("kind", "image").limit(MEDIA_SCAN),
  ]);
  if (props.error || media.error) return { enabled: false, ids: [], total: 0, truncated: false };

  const counts = new Map<string, { n: number; cover: boolean }>();
  for (const m of (media.data ?? []) as { property_id: string; is_cover: boolean }[]) {
    const cur = counts.get(m.property_id) ?? { n: 0, cover: false };
    cur.n += 1;
    cur.cover = cur.cover || Boolean(m.is_cover);
    counts.set(m.property_id, cur);
  }
  const gaps = ((props.data ?? []) as { id: string }[])
    .filter((p) => {
      const c = counts.get(p.id);
      return isPhotoGap(c?.n ?? 0, c?.cover ?? false);
    })
    .map((p) => p.id);
  return {
    enabled: true,
    ids: gaps.slice(0, PHOTO_GAP_ID_CAP),
    total: gaps.length,
    truncated: gaps.length > PHOTO_GAP_ID_CAP,
  };
}
