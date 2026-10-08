import { fetchAllPaged } from "@/lib/cron-run";

/**
 * PostgREST `max_rows` (varsayılan 1000) sınırını aşan okumalar için sayfalı toplayıcı (kullanıcı oturumu / RLS ile uyumlu).
 * `fetchPage(from, to)` aralığı DAİMA deterministik sıralı (`order("id")`) çekmeli ve tenant/RLS süzgeçlerini kendisi taşır.
 * Sonuç Supabase biçimindedir (`{ data, error }`) — `assertQueryBatchSucceeded` ile doğrudan denetlenir; hata
 * ya da sayfa üst sınırı aşımında `error` doludur ve sayfa eksik veriyi sessizce göstermez.
 */
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
  maxPages = 100,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const { rows, error } = await fetchAllPaged<T>(fetchPage, pageSize, maxPages);
  return { data: rows, error: error ? { message: error } : null };
}

/**
 * `fetchAllRows` ile aynı sayfalama; ancak ilk hatayı OLDUĞU GİBİ (kod/ayrıntı dahil) döndürür.
 * Çağıran hata koduna göre dallanıyorsa (ör. şema yok = 42P01/PGRST205) bunu kullanır.
 * Sayfa üst sınırı aşılırsa `error` doludur (kısmi veri sessizce kullanılmaz).
 */
export async function fetchAllRowsKeepError<T, E extends { message: string; code?: string }>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: E | null }>,
  pageSize = 1000,
  maxPages = 100,
): Promise<{ data: T[]; error: E | { message: string; code?: string } | null }> {
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const res = await fetchPage(from, from + pageSize - 1);
    if (res.error) return { data: rows, error: res.error };
    const got = res.data ?? [];
    rows.push(...got);
    if (got.length < pageSize) return { data: rows, error: null };
  }
  return { data: rows, error: { message: `sayfa üst sınırı (${maxPages}) aşıldı` } };
}
