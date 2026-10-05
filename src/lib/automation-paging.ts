/**
 * Otomasyon motoru için SAF sayfalama/dedupe yardımcıları (DB yok, test edilebilir).
 *
 * Sorun: aday sorguları sırasız `.limit(200)` idi; koşul sürekli doğruysa hep aynı ilk 200 aday gelir ve
 * 201+ hiç işlenmezdi. Çözüm: `order(id)` + imleç (`id > son_id`) sayfalama, dedupe'ı her sayfanın id'leriyle
 * `automation_logs`'a SQL'de sormak (tavanlı bellek kümesi yok).
 */

/** Tek sayfadaki aday sayısı (PostgREST varsayılan 1000 satır sınırının çok altında). */
export const AUTOMATION_PAGE_SIZE = 200;
/** Bir otomasyon için tek çalışmada en fazla taranacak sayfa (sonsuz döngü / bütçe emniyeti). */
export const MAX_PAGES_PER_AUTOMATION = 50;
/** Otomasyon listesi sayfa boyutu. */
export const AUTOMATION_LIST_PAGE = 500;

export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  if (size <= 0) return [items.slice()];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type PageInfo = {
  /** Sayfadaki ham satır sayısı (filtre öncesi). */
  rawCount: number;
  /** Sayfadaki son satırın id'si (bir sonraki imleç). */
  lastId: string | null;
};

/** Sayfa tükendi mi? Ham satır sayısı sayfa boyutundan azsa evet. */
export function isLastPage(rawCount: number, pageSize: number = AUTOMATION_PAGE_SIZE): boolean {
  return rawCount < pageSize;
}

/** Bir sonraki imleç: sayfa tükendiyse veya id yoksa null. */
export function nextCursor(page: PageInfo, pageSize: number = AUTOMATION_PAGE_SIZE): string | null {
  if (isLastPage(page.rawCount, pageSize)) return null;
  return page.lastId;
}

/** Ham satırlardan imleç bilgisi (id'ye göre sıralı gelmiş satırlar varsayılır). */
export function pageInfoOf(rows: readonly { id: unknown }[]): PageInfo {
  const last = rows.length > 0 ? rows[rows.length - 1].id : null;
  return { rawCount: rows.length, lastId: last == null ? null : String(last) };
}

/**
 * Aday listesini "son N günde başarılı loglanmış" kümesine göre böler.
 * Küme küçük harf id'ler içerir (log tarafında normalize edilir).
 */
export function splitFired<T extends { entityId: string }>(
  candidates: readonly T[],
  firedLowerIds: ReadonlySet<string>,
): { fresh: T[]; skipped: number } {
  const fresh: T[] = [];
  let skipped = 0;
  for (const c of candidates) {
    if (firedLowerIds.has(c.entityId.toLowerCase())) skipped += 1;
    else fresh.push(c);
  }
  return { fresh, skipped };
}

/** automation_logs satırlarından dedupe kümesi: 'error' sonuçlar dedupe'a girmez (yeniden denenir). */
export function firedIdsFromLogs(rows: readonly { entity_id?: unknown; result?: unknown }[]): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    if (row.result !== "error" && row.entity_id) out.add(String(row.entity_id).toLowerCase());
  }
  return out;
}
