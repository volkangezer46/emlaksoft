import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseVariants, SITE_MEDIA_ID_RE, VARIANT_FILE_RE, type MediaVariant, type SiteMediaRow, type SiteMediaView } from "./types";

/**
 * Site medya deposu (yalnız sunucu, service_role): `site_media` tablosu + ÖZEL `site-media` kovası (migration 20261013003500).
 * Tablo platform düzeyidir (kiracı verisi yok); erişim kapısı çağıranda (`requirePlatformModule("sitecontent")`) ve
 * genel sunumda yalnız kayıtlı varyant adıyla (/medya/<id>/<dosya>). Tablo/kova yokken okuyucular "missing" döner:
 * Medya ekranı "kurulum bekliyor" gösterir, ana sayfa görselsiz çizilir.
 */
export const SITE_MEDIA_BUCKET = "site-media";
export const SITE_MEDIA_CACHE_TAG = "site-media";

const COLUMNS = "id, path, alt, title, w, h, bytes, mime, variants, lqip, used_by, created_at";

/** Tek service_role giriş noktası (kabul listesi: src/lib/admin-client-allowlist.ts). */
function db() {
  return createAdminClient();
}

type DbError = { code?: string; message?: string } | null;

export function isMissingSchema(error: DbError): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /site_media|does not exist|schema cache/i.test(error.message ?? "");
}

type Raw = {
  id: string;
  path: string;
  alt: string;
  title: string | null;
  w: number;
  h: number;
  bytes: number | string;
  mime: string;
  variants: unknown;
  lqip: string | null;
  used_by: string[] | null;
  created_at: string;
};

function toRow(r: Raw): SiteMediaRow {
  return {
    id: r.id,
    alt: r.alt,
    title: r.title,
    w: Number(r.w),
    h: Number(r.h),
    bytes: Number(r.bytes),
    mime: r.mime,
    variants: parseVariants(r.variants),
    lqip: r.lqip ?? "",
    usedBy: r.used_by ?? [],
    createdAt: r.created_at,
  };
}

export type SiteMediaList = { status: "ok"; items: SiteMediaRow[] } | { status: "missing" } | { status: "error"; error: string };

/** Tüm medya (yeni önce). Kütüphane küçük tutulur (1 GB kota); sayfalama gerekmez, üst sınır 500 satır. */
export async function listSiteMedia(): Promise<SiteMediaList> {
  const { data, error } = await db().from("site_media").select(COLUMNS).order("created_at", { ascending: false }).limit(500);
  if (error) return isMissingSchema(error) ? { status: "missing" } : { status: "error", error: "Medya listesi okunamadı." };
  return { status: "ok", items: ((data ?? []) as Raw[]).map(toRow) };
}

export async function readSiteMedia(id: string): Promise<SiteMediaRow | null> {
  if (!SITE_MEDIA_ID_RE.test(id)) return null;
  const { data, error } = await db().from("site_media").select(COLUMNS).eq("id", id).maybeSingle();
  if (error || !data) return null;
  return toRow(data as Raw);
}

/** Var olan medya kimlikleri (site içeriği doğrulaması için); tablo yoksa boş küme (görsel seçilemez). */
export async function listSiteMediaIds(): Promise<Set<string>> {
  const { data, error } = await db().from("site_media").select("id").limit(1000);
  if (error) return new Set();
  return new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
}

/** Kota için toplam saklanan bayt. */
export async function usedBytes(): Promise<number | null> {
  const { data, error } = await db().from("site_media").select("bytes").limit(1000);
  if (error) return null;
  const rows = (data ?? []) as Array<{ bytes: number | string }>;
  // Okuma üst sınırına (1000 görsel) ulaşıldıysa toplam eksik kalabilir: kütüphane dolu sayılır (kota reddi).
  if (rows.length >= 1000) return Number.MAX_SAFE_INTEGER;
  return rows.reduce((s, r) => s + Number(r.bytes || 0), 0);
}

export type MediaWrite = { alt: string; title: string | null; w: number; h: number; bytes: number; mime: string; variants: MediaVariant[]; lqip: string };

export async function insertSiteMedia(id: string, row: MediaWrite, actorId: string): Promise<boolean> {
  const { error } = await db()
    .from("site_media")
    .insert({ id, path: `${id}/`, alt: row.alt, title: row.title, w: row.w, h: row.h, bytes: row.bytes, mime: row.mime, variants: row.variants, lqip: row.lqip || null, created_by: actorId });
  return !error;
}

/** "Değiştir": kimlik sabit, dosyalar/ölçüler yenilenir (alt metin isteğe bağlı güncellenir). */
export async function replaceSiteMediaFiles(id: string, row: MediaWrite): Promise<boolean> {
  const { error } = await db()
    .from("site_media")
    .update({ alt: row.alt, title: row.title, w: row.w, h: row.h, bytes: row.bytes, mime: row.mime, variants: row.variants, lqip: row.lqip || null })
    .eq("id", id);
  return !error;
}

export async function updateSiteMediaText(id: string, alt: string, title: string | null): Promise<boolean> {
  const { error } = await db().from("site_media").update({ alt, title }).eq("id", id);
  return !error;
}

export async function deleteSiteMediaRow(id: string): Promise<boolean> {
  const { error } = await db().from("site_media").delete().eq("id", id);
  return !error;
}

/** Varyantları kovaya yazar (<id>/<dosya>); biri başarısızsa yazılanlar geri silinir. */
export async function uploadVariants(id: string, variants: ReadonlyArray<MediaVariant & { data: Buffer }>): Promise<boolean> {
  const bucket = db().storage.from(SITE_MEDIA_BUCKET);
  const done: string[] = [];
  for (const v of variants) {
    const path = `${id}/${v.file}`;
    const { error } = await bucket.upload(path, v.data, { contentType: `image/${v.format}`, upsert: false, cacheControl: "31536000" });
    if (error) {
      if (done.length) await bucket.remove(done);
      return false;
    }
    done.push(path);
  }
  return true;
}

export async function removeVariantFiles(id: string, files: readonly string[]): Promise<void> {
  const paths = files.filter((f) => VARIANT_FILE_RE.test(f)).map((f) => `${id}/${f}`);
  if (paths.length) await db().storage.from(SITE_MEDIA_BUCKET).remove(paths);
}

/** Tek varyantın baytı (yalnız doğrulanmış kimlik + kayıtlı ad ile çağrılır). */
export async function downloadVariant(id: string, file: string): Promise<Buffer | null> {
  if (!SITE_MEDIA_ID_RE.test(id) || !VARIANT_FILE_RE.test(file)) return null;
  const { data, error } = await db().storage.from(SITE_MEDIA_BUCKET).download(`${id}/${file}`);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** Hesaplanan kullanım yerlerini `used_by` sütununa yazar (yalnız değişen satırlar). */
export async function syncUsedBy(rows: ReadonlyArray<Pick<SiteMediaRow, "id" | "usedBy">>, usage: Map<string, string[]>): Promise<void> {
  const client = db();
  for (const r of rows) {
    const next = usage.get(r.id) ?? [];
    if (next.join("|") === [...r.usedBy].sort().join("|")) continue;
    await client.from("site_media").update({ used_by: next }).eq("id", r.id);
  }
}

/**
 * Ana sayfada çizim için medya görünümü (önbellekli, etiketli; yazımda `updateTag(SITE_MEDIA_CACHE_TAG)`).
 * Yoksa/okunamazsa null: hero görselsiz (bugünkü haliyle) çizilir.
 */
export const getSiteMediaView = unstable_cache(
  async (id: string): Promise<SiteMediaView | null> => {
    const row = await readSiteMedia(id).catch(() => null);
    if (!row || row.variants.length === 0) return null;
    return { id: row.id, alt: row.alt, w: row.w, h: row.h, variants: row.variants, lqip: row.lqip };
  },
  ["site-media-view-v1"],
  { tags: [SITE_MEDIA_CACHE_TAG], revalidate: 3600 },
);
