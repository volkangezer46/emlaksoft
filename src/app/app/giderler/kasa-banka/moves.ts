import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
import type { DayMove } from "./account-sparkline";

/** Hesap başına tavan: bunu aşan hesabın çizgisi çizilmez (null). */
export const MOVES_CAP = 2000;
/** Tek sorgunun toplam tavanı (sayfalı; olağan ofiste tek sayfa = tek istek). */
export const MOVES_TOTAL_CAP = 5000;
const PAGE = 1000;

export type MoveRow = { account_id: string; direction: string; amount: number | string | null; entry_date: string };

/**
 * Tek sorgunun satırlarını hesaplara dağıtır. Satırlar `account_id` sırasıyla gelir; toplam tavan kesildiyse
 * (`truncated`) son görülen hesap ve sırada ondan sonra gelen hesaplar eksik olabilir → null (yanlış çizgi çizilmez).
 * Hesap başına tavanı aşan hesap da null. Hareketi olmayan hesap boş dizi alır.
 */
export function groupMovesByAccount(
  accountIds: readonly string[],
  rows: readonly MoveRow[],
  truncated: boolean,
): Map<string, DayMove[] | null> {
  const out = new Map<string, DayMove[] | null>();
  const byAccount = new Map<string, DayMove[]>();
  for (const r of rows) {
    const list = byAccount.get(r.account_id) ?? [];
    list.push({ date: String(r.entry_date), direction: r.direction === "in" ? "in" : "out", amount: Number(r.amount ?? 0) });
    byAccount.set(r.account_id, list);
  }
  const lastSeen = truncated && rows.length > 0 ? rows[rows.length - 1]!.account_id : null;
  for (const id of accountIds) {
    if (truncated && (lastSeen === null || id >= lastSeen)) {
      out.set(id, null);
      continue;
    }
    const list = byAccount.get(id) ?? [];
    out.set(id, list.length > MOVES_CAP ? null : list);
  }
  return out;
}

/**
 * Son 30 günün (ve ileri tarihli) hareketleri, çizgi için: hesap sayısından bağımsız TEK sorgu (`account_id in (...)`),
 * gruplama JS'te. Eskiden hesap başına ayrı sorgu atılıyordu (10 hesap = 10 istek).
 * İleri tarihli hareketler de gelir: bakiye onları içerir, seri onları başlangıçtan düşer (dailyBalanceSeries).
 * Hata → `error` dolu döner; çağıran tüm hesapları null sayar (çizgi çizilmez).
 */
export async function loadMovesForAccounts(
  supabase: SupabaseClient,
  accountIds: readonly string[],
  since: string,
): Promise<{ moves: Map<string, DayMove[] | null>; error: { code?: string; message: string } | null }> {
  if (accountIds.length === 0) return { moves: new Map(), error: null };
  const ids = [...new Set(accountIds)];
  const res = await readAllPaged<MoveRow>(
    (from, to) =>
      supabase
        .from("cash_entries")
        .select("account_id, direction, amount, entry_date")
        .in("account_id", ids)
        .is("voided_at", null)
        .gte("entry_date", since)
        .order("account_id", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: MoveRow[] | null; error: { message: string; code?: string } | null }>,
    { pageSize: PAGE, maxRows: MOVES_TOTAL_CAP },
  );
  if (res.error) {
    return { moves: new Map(ids.map((id) => [id, null])), error: { message: res.error } };
  }
  return { moves: groupMovesByAccount(ids, res.rows, res.truncated), error: null };
}
