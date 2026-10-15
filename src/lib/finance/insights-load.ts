import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isMissingCashSchema } from "@/lib/finance/cash/load";
import { loadPnl, loadVatSummary } from "@/lib/finance/ledger/load";
import { shiftDayKey } from "@/lib/finance/smart-entry";
import { ledgerQueryOps, parseLedgerFilters, type QueryOp } from "@/app/app/giderler/_hareketler/ledger-filters";
import type { MonthCategoryTotals, PaymentRow } from "./anomalies";
import { shiftMonth } from "./profitability";

/**
 * Genel bakış zeka kartlarının sunucu okuyucuları ("Dikkat edilmesi gerekenler" ve "Ay sonu kapanışı").
 * Kullanıcı oturumu + RLS (kiracı süzgeci; maaş satırları yalnız sahip/GM'ye). Sınırsız tarama YOK:
 *  - kategori karşılaştırması tek toplama RPC'si (`finance_pnl`, 4 ay)
 *  - mükerrer ödeme taraması son 45 günün giderleri, en çok 1000 satır (yalnız eşleştirme sütunları)
 *  - sayaçlar `head: true` + `count: exact` (satır taşınmaz)
 * Sayaçlar Hareketler'in süzgeç adımlarıyla (`ledgerQueryOps`) kurulur: karttaki sayı ile tıklanınca açılan liste AYNI kümedir.
 * Okunamayan değer null döner (kart "okunamadı" der, sahte sıfır göstermez).
 */

const DUP_SCAN_DAYS = 45;
const DUP_SCAN_LIMIT = 1000;

type Filterable = {
  eq(column: string, value: unknown): Filterable;
  neq(column: string, value: unknown): Filterable;
  is(column: string, value: null): Filterable;
  gte(column: string, value: unknown): Filterable;
  lte(column: string, value: unknown): Filterable;
  in(column: string, values: readonly unknown[]): Filterable;
  or(filters: string): Filterable;
};

function applyOps<B>(q: B, ops: readonly QueryOp[]): B {
  let out = q as unknown as Filterable;
  for (const o of ops) {
    if (o.op === "or") out = out.or(o.val);
    else if (o.op === "is") out = out.is(o.col, null);
    else if (o.op === "eq") out = out.eq(o.col, o.val);
    else if (o.op === "neq") out = out.neq(o.col, o.val);
    else if (o.op === "in") out = out.in(o.col, o.val);
    else if (o.op === "gte") out = out.gte(o.col, o.val);
    else out = out.lte(o.col, o.val);
  }
  return out as unknown as B;
}

type DbError = { code?: string | null } | null | undefined;
function logError(where: string, error: DbError) {
  if (error && !isMissingCashSchema(error)) console.error(`finance-insights:${where}`, { code: error.code });
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Hareketler süzgeci (URL parametreleri) ile aynı kümenin sayısı; hata → null. */
async function countLedger(supabase: Supabase, params: Record<string, string>, opts: { canSalary: boolean; officeAccountIds?: readonly string[] | null; accountIds?: readonly string[] }): Promise<number | null> {
  const f = parseLedgerFilters(params, { canSalary: opts.canSalary });
  let q = applyOps(supabase.from("finance_ledger_v").select("id", { count: "exact", head: true }), ledgerQueryOps(f, { officeAccountIds: opts.officeAccountIds ?? null }));
  if (opts.accountIds) q = q.in("account_id", [...opts.accountIds]);
  const { count, error } = await q;
  if (error) {
    logError("count", error);
    return null;
  }
  return count ?? 0;
}

export type AttentionSignals = {
  /** Bu ay + önceki 3 ay gider kategorileri (finance_pnl); okunamadıysa boş. */
  expenseMonths: MonthCategoryTotals[];
  /** Son 45 günün gider satırları (mükerrer ödeme taraması). */
  payments: PaymentRow[];
  /** Bu ay belgesi eklenmemiş gider sayısı (Hareketler `tur=gider&belge=yok`). */
  receiptlessThisMonth: number | null;
};

export async function loadAttentionSignals(today: string, canSalary: boolean): Promise<AttentionSignals> {
  const month = today.slice(0, 7);
  const monthFrom = `${month}-01`;
  const supabase = await createClient();
  const [pnl, payRes, receiptless] = await Promise.all([
    loadPnl(`${shiftMonth(month, -3)}-01`, today),
    supabase
      .from("finance_ledger_v")
      .select("id, entry_date, amount, currency, title, counterparty, category")
      .is("voided_at", null)
      .eq("kind", "expense")
      .gte("entry_date", shiftDayKey(today, -DUP_SCAN_DAYS))
      .lte("entry_date", today)
      .order("entry_date", { ascending: false })
      .limit(DUP_SCAN_LIMIT),
    countLedger(supabase, { tur: "gider", belge: "yok", from: monthFrom, to: today }, { canSalary }),
  ]);
  if (payRes.error) logError("payments", payRes.error);
  const payments: PaymentRow[] = ((payRes.error ? [] : payRes.data) ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id ?? ""),
    date: String(r.entry_date ?? "").slice(0, 10),
    amount: Number(r.amount) || 0,
    currency: r.currency === "USD" || r.currency === "EUR" ? r.currency : "TRY",
    title: r.title == null ? null : String(r.title),
    counterparty: r.counterparty == null ? null : String(r.counterparty),
    category: r.category == null ? null : String(r.category),
  }));
  return {
    expenseMonths: pnl.map((p) => ({ month: p.month.slice(0, 7), byCategory: p.expenseByCategory })),
    payments,
    receiptlessThisMonth: receiptless,
  };
}

export type MonthCloseSignals = {
  locked: boolean | null;
  /** Tek banka hesabı varsa kimliği (bağlantı o hesabın listesine gider). */
  bankAccountIds: string[];
  /** Banka hesabı yoksa undefined. */
  unreconciledBank: number | null | undefined;
  receiptlessExpenses: number | null;
  noVatEntries: number | null;
  vatPayable: number | null;
};

/** `monthKey` ("YYYY-MM") ayının kapanış sinyalleri; sorgular paralel. */
export async function loadMonthCloseSignals(monthKey: string, canSalary: boolean): Promise<MonthCloseSignals> {
  const from = `${monthKey}-01`;
  const to = shiftDayKey(`${shiftMonth(monthKey, 1)}-01`, -1);
  const supabase = await createClient();
  const [lockRes, accRes, vat] = await Promise.all([
    supabase.from("finance_period_locks").select("period_month").eq("period_month", from).limit(1),
    // Arşivliler dahil: KDV özeti ve "KDV bilgisi yok" kümesi arşivlenmiş ofis hesaplarını da sayar; mutabakat yalnız açık bankalar.
    supabase.from("finance_accounts").select("id, kind, archived_at").eq("owner_scope", "office").limit(500),
    loadVatSummary(from, to),
  ]);
  if (lockRes.error) logError("lock", lockRes.error);
  if (accRes.error) logError("accounts", accRes.error);
  const accounts = ((accRes.error ? [] : accRes.data) ?? []) as { id: string; kind: string; archived_at: string | null }[];
  const officeIds = accRes.error ? null : accounts.map((a) => a.id);
  const bankIds = accounts.filter((a) => a.kind === "bank" && !a.archived_at).map((a) => a.id);

  const range = { from, to };
  const [unreconciled, receiptless, noVat] = await Promise.all([
    bankIds.length > 0 ? countLedger(supabase, { ...range, mutabik: "hayir" }, { canSalary, accountIds: bankIds }) : Promise.resolve(undefined),
    countLedger(supabase, { ...range, tur: "gider", belge: "yok" }, { canSalary }),
    officeIds ? countLedger(supabase, { ...range, kdv: "yok" }, { canSalary, officeAccountIds: officeIds }) : Promise.resolve(null),
  ]);
  const vatRow = vat.find((v) => v.month.slice(0, 7) === monthKey);
  return {
    locked: lockRes.error ? null : (lockRes.data ?? []).length > 0,
    bankAccountIds: bankIds,
    unreconciledBank: unreconciled,
    receiptlessExpenses: receiptless,
    noVatEntries: noVat,
    vatPayable: vatRow ? vatRow.payable : null,
  };
}
