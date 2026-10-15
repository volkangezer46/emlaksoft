"use server";

import { previewImportChunk, type ChunkResult, type ImportOptions } from "@/app/actions/import-data";
import { requireActiveTenant } from "@/lib/tenant-guard";
import type { ImportRow, ImportTarget } from "@/lib/import-rows";
import { IMPORT_CHUNK_SIZE } from "./import-config";
import { mapLimit, PREVIEW_BATCH_MAX, PREVIEW_CONCURRENCY } from "./preview-parallel";

/**
 * İçe aktarma önizlemesi — PARÇA DEMETİ (B049). Next.js istemcisi sunucu eylemlerini TEK TEK sıraya koyar (Promise.all
 * istemcide paralellik sağlamaz); bu yüzden eşzamanlılık SUNUCUDA kurulur: demetteki parçalar en çok 4 eşzamanlı
 * `previewImportChunk` ile önizlenir (her parça kendi yetki kapısından, hız sınırından ve mükerrer planından geçer;
 * yazma YOK). `seen[i]`, i. parçaya taşınacak "önceki parçalarda görülen" anahtarlardır (yalnız uzlaştırma turunda dolu).
 */
export async function previewImportChunks(
  target: ImportTarget,
  chunks: ImportRow[][],
  options: Omit<ImportOptions, "seen"> = {},
  seen: string[][] = [],
): Promise<ChunkResult[]> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return [{ error: gate.error }];
  if (!Array.isArray(chunks) || chunks.length === 0) return [{ error: "İçe aktarılacak satır bulunamadı." }];
  if (chunks.length > PREVIEW_BATCH_MAX || chunks.some((c) => !Array.isArray(c) || c.length > IMPORT_CHUNK_SIZE)) {
    return [{ error: "Önizleme parçası çok büyük. Sayfayı yenileyip tekrar deneyin." }];
  }
  return mapLimit(chunks, PREVIEW_CONCURRENCY, (rows, i) =>
    previewImportChunk(target, rows, { ...options, seen: Array.isArray(seen[i]) ? seen[i]!.slice(0, 10_000) : [] }),
  );
}
