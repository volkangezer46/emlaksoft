/**
 * Cron/toplu okumalar için SAYFALI "hepsini oku" yardımcısı.
 *
 * PostgREST `max_rows` (varsayılan 1000) yüzünden yüksek `limit` gibi çağrılar sessizce 1000 satırda kesilir.
 * Bu yardımcı `range` ile sayfalar, ÜST SINIRI AÇIKTIR (`maxRows`) ve sınıra ulaşılırsa `truncated: true` döner;
 * çağıran heartbeat'e `error` yazmalıdır (kısmi veri sessizce "ok" sayılmaz).
 *
 * `fetchPage(from, to)` DAİMA deterministik sıralı olmalıdır (`.order("id")`), aksi hâlde sayfalar arasında satır kayar.
 */
export const READ_ALL_PAGE_SIZE = 1000;
/** Varsayılan açık üst sınır (satır). */
export const READ_ALL_MAX_ROWS = 50_000;

export type ReadAllPagedResult<T> = {
  rows: T[];
  /** Sorgu hatası (ilk hata); varsa `rows` kısmidir. */
  error: string | null;
  /** Üst sınıra ulaşıldı: daha fazla satır olabilir, liste TAM DEĞİL. */
  truncated: boolean;
};

export async function readAllPaged<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<ReadAllPagedResult<T>> {
  const pageSize = Math.max(1, opts.pageSize ?? READ_ALL_PAGE_SIZE);
  const maxRows = Math.max(pageSize, opts.maxRows ?? READ_ALL_MAX_ROWS);
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const res = await fetchPage(from, from + pageSize - 1);
    if (res.error) return { rows, error: res.error.message, truncated: false };
    const got = res.data ?? [];
    rows.push(...got);
    if (got.length < pageSize) return { rows, error: null, truncated: false };
  }
  // Son sayfa tam doluydu ve sınıra geldik: devamı olabilir.
  return { rows, error: null, truncated: true };
}
