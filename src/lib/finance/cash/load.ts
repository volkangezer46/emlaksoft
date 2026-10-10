import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Finans hesapları + hareket defteri okuyucuları (kullanıcı oturumu, RLS). Şema (migration 20261010000600) yoksa
 * `available:false` döner ve çağıran eski Giderler akışına düşer. Bu dosya istemci OLUŞTURMAZ.
 * Kişisel hesaplar yalnız sahibine, maaş hareketleri yalnız owner/gm'ye RLS ile gelir; burada ek süzme gerekmez.
 */

type DbError = { code?: string | null; message?: string | null } | null | undefined;

export function isMissingCashSchema(error: DbError): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" || error.code === "42883" || error.code === "42703" ||
    error.code === "PGRST202" || error.code === "PGRST204" || error.code === "PGRST205" ||
    msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("could not find")
  );
}

export type FinanceAccount = {
  id: string;
  owner_scope: "office" | "user";
  owner_user_id: string | null;
  kind: "cash" | "bank" | "card";
  name: string;
  iban_last4: string | null;
  currency: "TRY" | "USD" | "EUR";
  opening_balance: number;
  opening_date: string;
  archived_at: string | null;
};

export type AccountWithBalance = FinanceAccount & {
  balance: number;
  total_in: number;
  total_out: number;
  entry_count: number;
  last_entry_date: string | null;
};

export type CashEntry = {
  id: string;
  account_id: string;
  direction: "in" | "out";
  amount: number;
  currency: string;
  entry_date: string;
  kind: "income" | "expense" | "transfer" | "adjust";
  category: string | null;
  title: string;
  counterparty: string | null;
  document_url: string | null;
  note: string | null;
  transfer_group_id: string | null;
  expense_id: string | null;
  source_type: string;
  source_id: string | null;
  created_at: string;
  voided_at: string | null;
};

const ACCOUNT_COLUMNS = "id, owner_scope, owner_user_id, kind, name, iban_last4, currency, opening_balance, opening_date, archived_at";
const ENTRY_COLUMNS =
  "id, account_id, direction, amount, currency, entry_date, kind, category, title, counterparty, document_url, note, transfer_group_id, expense_id, source_type, source_id, created_at, voided_at";

export const ENTRY_PAGE_SIZE = 50;

/** Görünür hesaplar + türetilmiş bakiyeler (finance_account_balances). */
export async function loadAccountsWithBalances(
  supabase: SupabaseClient,
): Promise<{ available: boolean; accounts: AccountWithBalance[] }> {
  const [accRes, balRes] = await Promise.all([
    supabase.from("finance_accounts").select(ACCOUNT_COLUMNS).order("owner_scope", { ascending: true }).order("created_at", { ascending: true }),
    supabase.rpc("finance_account_balances"),
  ]);
  if (accRes.error || balRes.error) {
    const err = accRes.error ?? balRes.error;
    if (!isMissingCashSchema(err)) console.error("loadAccountsWithBalances", { code: err?.code });
    return { available: false, accounts: [] };
  }
  const balances = new Map<string, { balance: number; total_in: number; total_out: number; entry_count: number; last_entry_date: string | null }>();
  for (const b of (balRes.data ?? []) as Record<string, unknown>[]) {
    balances.set(String(b.account_id), {
      balance: Number(b.balance ?? 0),
      total_in: Number(b.total_in ?? 0),
      total_out: Number(b.total_out ?? 0),
      entry_count: Number(b.entry_count ?? 0),
      last_entry_date: (b.last_entry_date as string | null) ?? null,
    });
  }
  const accounts = ((accRes.data ?? []) as Record<string, unknown>[]).map((a) => {
    const bal = balances.get(String(a.id));
    return {
      ...(a as unknown as FinanceAccount),
      opening_balance: Number(a.opening_balance ?? 0),
      balance: bal?.balance ?? Number(a.opening_balance ?? 0),
      total_in: bal?.total_in ?? 0,
      total_out: bal?.total_out ?? 0,
      entry_count: bal?.entry_count ?? 0,
      last_entry_date: bal?.last_entry_date ?? null,
    } satisfies AccountWithBalance;
  });
  return { available: true, accounts };
}

export type EntryFilters = {
  accountId?: string | null;
  /** gelir | gider | transfer */
  tur?: "gelir" | "gider" | "transfer" | null;
  category?: string | null;
  from?: string | null;
  to?: string | null;
  /** Başlık / karşı taraf araması. */
  q?: string | null;
  /** 1 tabanlı sayfa. */
  page?: number;
  includeVoided?: boolean;
};

export async function loadCashEntries(
  supabase: SupabaseClient,
  filters: EntryFilters,
): Promise<{ available: boolean; entries: CashEntry[]; total: number }> {
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  let q = supabase
    .from("cash_entries")
    .select(ENTRY_COLUMNS, { count: "exact" })
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range((page - 1) * ENTRY_PAGE_SIZE, page * ENTRY_PAGE_SIZE - 1);
  if (!filters.includeVoided) q = q.is("voided_at", null);
  if (filters.accountId) q = q.eq("account_id", filters.accountId);
  if (filters.tur === "gelir") q = q.eq("kind", "income");
  else if (filters.tur === "gider") q = q.eq("kind", "expense");
  else if (filters.tur === "transfer") q = q.eq("kind", "transfer");
  if (filters.category) q = q.eq("category", filters.category);
  if (filters.from) q = q.gte("entry_date", filters.from);
  if (filters.to) q = q.lte("entry_date", filters.to);
  // Serbest arama: PostgREST .or() sözdizimini bozan karakterler atılır (virgül, parantez, joker, ters eğik çizgi).
  const term = (filters.q ?? "").replace(/[,()%*_\\]/g, " ").trim().slice(0, 60);
  if (term) q = q.or(`title.ilike.%${term}%,counterparty.ilike.%${term}%`);
  const { data, error, count } = await q;
  if (error) {
    if (!isMissingCashSchema(error)) console.error("loadCashEntries", { code: error.code });
    return { available: false, entries: [], total: 0 };
  }
  const entries = ((data ?? []) as Record<string, unknown>[]).map((e) => ({ ...(e as unknown as CashEntry), amount: Number(e.amount) }));
  return { available: true, entries, total: count ?? entries.length };
}

export type CashSummaryRow = { account_id: string; direction: "in" | "out"; category: string | null; total: number; entry_count: number };

/** Gelir/gider özeti (transfer hariç; RLS'li). Hesap kapsamı çağıranda süzülür. */
export async function loadCashSummary(
  supabase: SupabaseClient,
  range: { from?: string | null; to?: string | null },
): Promise<CashSummaryRow[]> {
  const { data, error } = await supabase.rpc("finance_cash_summary", { p_from: range.from ?? null, p_to: range.to ?? null });
  if (error) {
    if (!isMissingCashSchema(error)) console.error("loadCashSummary", { code: error.code });
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    account_id: String(r.account_id),
    direction: r.direction as "in" | "out",
    category: (r.category as string | null) ?? null,
    total: Number(r.total ?? 0),
    entry_count: Number(r.entry_count ?? 0),
  }));
}

/** Hesap kartları için hesap başına son hareketler (tek sorgu; hesap başına en çok `perAccount`). */
export async function loadRecentEntriesByAccount(
  supabase: SupabaseClient,
  accountIds: readonly string[],
  perAccount = 3,
): Promise<Map<string, CashEntry[]>> {
  const out = new Map<string, CashEntry[]>();
  if (accountIds.length === 0) return out;
  const { data, error } = await supabase
    .from("cash_entries")
    .select(ENTRY_COLUMNS)
    .in("account_id", accountIds as string[])
    .is("voided_at", null)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(Math.min(accountIds.length * perAccount * 4, 400));
  if (error) {
    if (!isMissingCashSchema(error)) console.error("loadRecentEntriesByAccount", { code: error.code });
    return out;
  }
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const e = { ...(row as unknown as CashEntry), amount: Number(row.amount) };
    const list = out.get(e.account_id) ?? [];
    if (list.length < perAccount) list.push(e);
    out.set(e.account_id, list);
  }
  return out;
}
