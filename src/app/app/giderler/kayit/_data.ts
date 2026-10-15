import "server-only";
import { createClient } from "@/lib/supabase/server";
import { now as nowMs, trDayKey } from "@/lib/clock";
import { CASH_CATEGORIES } from "@/lib/finance/cash/categories";
import { loadAccountsWithBalances } from "@/lib/finance/cash/load";
import { loadBudgetVsActual, loadCategories, loadSettings } from "@/lib/finance/ledger/load";
import { DEFAULT_FINANCE_SETTINGS, type Budget, type FinanceCategory } from "@/lib/finance/ledger/types";
import type { RecentEntry } from "@/lib/finance/entry-workspace";
import { shiftDayKey } from "@/lib/finance/smart-entry";
import type { AccountOption, EntryCategoryOption } from "../quick-entry";

/**
 * Kayıt çalışma alanının (yeni + düzenle) sunucu verisi. Bağımsız sorgular TEK turda (Promise.all; şelale yok), hepsi
 * kullanıcı oturumuyla (RLS): kişisel hesaplar yalnız sahibine, maaş hareketleri yalnız owner/gm'ye gelir.
 * `personal`: Kasam kipi — yalnız kullanıcının kendi kişisel hesapları; ofis kategorisi/bütçesi/ayarı okunmaz.
 */

export type WorkspaceAccount = AccountOption & { balance: number };
export type WorkspaceBudget = Pick<Budget, "direction" | "category" | "budget" | "actual">;

export type EntryContext = {
  today: string;
  accounts: WorkspaceAccount[];
  categories: EntryCategoryOption[];
  recent: RecentEntry[];
  budgets: WorkspaceBudget[];
  vatIncludedDefault: boolean;
  ocrEnabled: boolean;
};

/** Son kayıt penceresi: mükerrer (30 gün), benzer kayıt ve cariden kategori önerisi için. */
const RECENT_DAYS = 90;
const RECENT_LIMIT = 500;

/** Sistem + ofis kategorileri → seçim çipleri (ofis kategorileri `x_…`; varsayılan KDV/stopaj oranlarıyla). */
export function toEntryCategories(list: readonly FinanceCategory[]): EntryCategoryOption[] {
  const out = list
    .filter((c) => !c.archived && c.key && c.label)
    .map((c) => ({ value: c.key, label: c.label, direction: c.direction, custom: c.source === "custom", vatRate: c.defaultVatRate, withholdingRate: c.defaultWithholdingRate, expenseCategory: c.expenseCategory }));
  return out.length > 0 ? out : systemCategories();
}

function systemCategories(): EntryCategoryOption[] {
  return CASH_CATEGORIES.map((c) => ({ value: c.value, label: c.label, direction: c.direction, expenseCategory: c.direction === "out" ? (c.expenseCategory ?? null) : null }));
}

type RecentRow = {
  id: string;
  account_id: string;
  direction: string;
  amount: number | string;
  entry_date: string;
  category: string | null;
  title: string | null;
  counterparty: string | null;
  party: { name: string | null } | { name: string | null }[] | null;
};

export async function loadEntryContext(opts: { personal: boolean; userId: string; canOffice: boolean }): Promise<EntryContext> {
  const supabase = await createClient();
  const today = trDayKey(nowMs());
  const office = !opts.personal && opts.canOffice;
  const [cash, categories, budgets, settings, recentRes] = await Promise.all([
    loadAccountsWithBalances(supabase),
    office ? loadCategories() : Promise.resolve([] as FinanceCategory[]),
    office ? loadBudgetVsActual(today.slice(0, 7)) : Promise.resolve([] as Budget[]),
    office ? loadSettings() : Promise.resolve(DEFAULT_FINANCE_SETTINGS),
    supabase
      .from("cash_entries")
      .select("id, account_id, direction, amount, entry_date, category, title, counterparty, party:finance_parties!cash_entries_party_id_fkey(name)")
      .is("voided_at", null)
      .in("kind", ["income", "expense"])
      .gte("entry_date", shiftDayKey(today, -RECENT_DAYS))
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT),
  ]);

  // Kişisel kip: yalnız kendi kişisel hesapları. Ofis kipi: ofis hesapları (yazma yetkisi varsa) + kendi kişisel hesapları.
  const accounts: WorkspaceAccount[] = cash.accounts
    .filter((a) => !a.archived_at)
    .filter((a) => (a.owner_scope === "user" ? a.owner_user_id === opts.userId : !opts.personal && opts.canOffice))
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind, currency: a.currency, scope: a.owner_scope, balance: a.balance }));
  const visible = new Set(accounts.map((a) => a.id));

  const recent: RecentEntry[] = ((recentRes.error ? [] : recentRes.data ?? []) as unknown as RecentRow[])
    .filter((r) => visible.has(r.account_id))
    .map((r) => {
      const party = Array.isArray(r.party) ? r.party[0] : r.party;
      return {
        id: r.id,
        accountId: r.account_id,
        direction: r.direction === "in" ? "in" : "out",
        amount: Number(r.amount),
        date: String(r.entry_date).slice(0, 10),
        category: r.category,
        title: r.title ?? "",
        counterparty: party?.name ?? r.counterparty ?? null,
      };
    });

  return {
    today,
    accounts,
    categories: office ? toEntryCategories(categories) : systemCategories(),
    recent,
    budgets: budgets.map((b) => ({ direction: b.direction, category: b.category, budget: b.budget, actual: b.actual })),
    vatIncludedDefault: settings.vatIncludedDefault,
    ocrEnabled: settings.ocrEnabled,
  };
}
