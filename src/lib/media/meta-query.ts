import {
  selectWithDocumentFlag,
  type MediaQueryError,
} from "@/lib/public-property-media";

/** Oda etiketi + açıklama sütunları (migration 20261019030000). */
export const MEDIA_META_COLUMNS = "room_tag, caption";

/** "room_tag / caption sütunu yok" hatası mı (migration uygulanmamış)? PG 42703 / PostgREST PGRST204. */
export function isMissingMediaMetaColumnError(error: MediaQueryError | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42703" || code === "PGRST204") return true;
  const msg = (error.message ?? "").toLowerCase();
  return (
    (msg.includes("room_tag") || msg.includes("caption")) &&
    (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("could not find"))
  );
}

/**
 * `property_media` sorgusunu `is_document` + `room_tag` + `caption` ile çalıştırır. Etiket sütunları yoksa (migration
 * öncesi ortam) AYNI sorgu `selectWithDocumentFlag` ile tekrarlanır: satırlarda etiket olmaz, kat planı ayrımı ve
 * açıklama görünmez ama galeri ve KVKK belge kuralı aynen çalışır (fail-safe; sayfa bozulmaz).
 */
export async function selectWithMediaMeta<T>(
  columns: string,
  run: (columns: string) => PromiseLike<{ data: unknown; error: MediaQueryError | null }>,
): Promise<{ data: T | null; error: MediaQueryError | null; hasDocumentColumn: boolean; hasMetaColumns: boolean }> {
  const first = await run(`${columns}, is_document, ${MEDIA_META_COLUMNS}`);
  if (!first.error) {
    return { data: (first.data ?? null) as T | null, error: null, hasDocumentColumn: true, hasMetaColumns: true };
  }
  if (!isMissingMediaMetaColumnError(first.error)) {
    return { data: null, error: first.error, hasDocumentColumn: true, hasMetaColumns: true };
  }
  const fallback = await selectWithDocumentFlag<T>(columns, run);
  return { ...fallback, hasMetaColumns: false };
}
