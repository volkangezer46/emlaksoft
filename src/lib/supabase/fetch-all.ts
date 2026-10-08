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
