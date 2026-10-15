import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRowsKeepError } from "@/lib/supabase/fetch-all";
import { DEPOSIT_CATEGORY, OWNER_PAYOUT_CATEGORY, TRANSFER_CATEGORY, expenseCategoryFor } from "@/lib/finance/cash/categories";

/**
 * Ofis GİDERİ okuyucusu (WP5): toplamlar defterden (`cash_entries`) gelir; eski `expenses` tablosu DONDURULMUŞTUR
 * (yeni yazma yok) ve yalnız deftere taşınmamış geçmiş satırları için okunur. Kâr/zarar (`finance_pnl`) ile aynı taban:
 *  - tutar = hareket tutarı + stopaj − KDV (belge matrahı; KDV gider değildir);
 *  - yalnız OFİS hesapları, iptal edilmemiş, TRY, örnek veri hariç;
 *  - transfer, mülk sahibi ödemesi (emanet), depozito (emanet) ve `owner_payout` kaynaklı çıkışlar gider değildir;
 *  - kilitli dönem ters kaydı (`reversal_of` dolu, `kind = 'adjust'`, giriş yönü) asıl gideri düşer;
 *  - eski gider satırı, kendisine bağlı (iptal edilmemiş) defter hareketi varsa İKİNCİ KEZ sayılmaz.
 * Bu dosya istemci OLUŞTURMAZ; çağıran oturum (RLS) ya da içgörü motorunun admin istemcisini verir.
 */

export const LEDGER_EXPENSE_EXCLUDED_CATEGORIES: ReadonlySet<string> = new Set([TRANSFER_CATEGORY, OWNER_PAYOUT_CATEGORY, DEPOSIT_CATEGORY]);

/** `cash_entries` okuma satırı (gevşek: numeric metin gelebilir). */
export type LedgerExpenseEntry = {
  id: string;
  entry_date: string;
  direction: string;
  kind: string;
  amount: number | string;
  vat_amount?: number | string | null;
  withholding_amount?: number | string | null;
  category: string | null;
  expense_id?: string | null;
  reversal_of?: string | null;
  source_type?: string | null;
  property_id?: string | null;
  advisorId?: string | null;
};

/** Eski `expenses` satırı (deftere taşınmamışsa sayılır). */
export type LegacyExpense = {
  id: string;
  expense_date: string;
  amount: number | string;
  category: string | null;
  property_id?: string | null;
  advisorId?: string | null;
};

export type LedgerExpenseRow = {
  /** YYYY-MM-DD */
  date: string;
  /** İşaretli matrah (ters kayıt negatif). */
  amount: number;
  /** Defter kategorisi (eski satırda null). */
  cashCategory: string | null;
  /** Gider (bütçe v1 / gider tanımı) kategorisi; maaş null. */
  expenseCategory: string | null;
  propertyId: string | null;
  advisorId: string | null;
  /** Bağlı eski gider kimliği (mülk sahibine yansıtma eşlemesi için). */
  expenseId: string | null;
  source: "ledger" | "legacy";
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Hareketin gider katkısı (SAF): gider değilse null; gider ise işaretli matrah (+ gider, − kilitli dönem ters kaydı).
 */
export function ledgerExpenseAmount(e: LedgerExpenseEntry): number | null {
  if (e.source_type === "owner_payout") return null;
  if (e.category && LEDGER_EXPENSE_EXCLUDED_CATEGORIES.has(e.category)) return null;
  const net = num(e.amount) + num(e.withholding_amount) - num(e.vat_amount);
  if (e.kind === "expense" && e.direction === "out") return round2(net);
  // Kilitli dönemde geri alınan giderin aynası: aynı kategori, giriş yönü, `adjust`.
  if (e.kind === "adjust" && e.reversal_of && e.direction === "in") return round2(-net);
  return null;
}

/**
 * Defter + deftere taşınmamış eski giderler (SAF). Eski satır, `expense_id` ile bağlı CANLI bir hareket varsa atlanır
 * (gider kaydı üreten hareket ya da `finance_adopt_legacy_expenses` ile taşınan satır).
 */
export function mergeLedgerExpenses(entries: readonly LedgerExpenseEntry[], legacy: readonly LegacyExpense[]): LedgerExpenseRow[] {
  const out: LedgerExpenseRow[] = [];
  const linked = new Set<string>();
  for (const e of entries) {
    if (e.expense_id) linked.add(e.expense_id);
    const amount = ledgerExpenseAmount(e);
    if (amount === null || amount === 0) continue;
    const cat = e.category ?? "diger_gider";
    out.push({
      date: String(e.entry_date).slice(0, 10),
      amount,
      cashCategory: cat,
      expenseCategory: expenseCategoryFor(cat),
      propertyId: e.property_id ?? null,
      advisorId: e.advisorId ?? null,
      expenseId: e.expense_id ?? null,
      source: "ledger",
    });
  }
  for (const x of legacy) {
    if (linked.has(x.id)) continue;
    const amount = round2(num(x.amount));
    if (!(amount > 0)) continue;
    out.push({
      date: String(x.expense_date).slice(0, 10),
      amount,
      cashCategory: null,
      expenseCategory: x.category || "diger",
      propertyId: x.property_id ?? null,
      advisorId: x.advisorId ?? null,
      expenseId: x.id,
      source: "legacy",
    });
  }
  return out;
}

/** Gider (v1) kategorisine göre toplam (SAF; maaş ve kategorisiz satır dışarıda). */
export function sumLedgerExpensesByCategory(rows: readonly LedgerExpenseRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.expenseCategory) continue;
    out.set(r.expenseCategory, round2((out.get(r.expenseCategory) ?? 0) + r.amount));
  }
  return out;
}

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
type DbErr = { message: string; code?: string };

const ENTRY_COLS =
  "id, entry_date, direction, kind, amount, vat_amount, withholding_amount, category, expense_id, reversal_of, source_type, property_id, account:finance_accounts!cash_entries_account_fk!inner(owner_scope)";

/**
 * Tarih aralığındaki ofis giderleri: defter + taşınmamış eski satırlar. `withAdvisor` portföyün sorumlu danışmanını da getirir
 * (danışman kârlılığı doğrudan maliyeti). Hata kodu korunur (çağıran şema eksikliğine göre dallanabilir).
 */
export async function loadLedgerExpenses(
  db: SupabaseClient,
  tenantId: string,
  range: { from: string; to?: string; withAdvisor?: boolean },
): Promise<{ rows: LedgerExpenseRow[]; error: DbErr | null }> {
  const withAdvisor = range.withAdvisor === true;
  const entryCols = withAdvisor ? `${ENTRY_COLS}, property:properties!cash_entries_property_id_fkey(assigned_to)` : ENTRY_COLS;
  const legacyCols = withAdvisor
    ? "id, expense_date, amount, category, property_id, property:properties!expenses_property_id_fkey(assigned_to)"
    : "id, expense_date, amount, category, property_id";
  type EntryRaw = LedgerExpenseEntry & { property?: Rel<{ assigned_to: string | null }> };
  type LegacyRaw = LegacyExpense & { property?: Rel<{ assigned_to: string | null }> };
  const [entryRes, legacyRes] = await Promise.all([
    fetchAllRowsKeepError<EntryRaw, DbErr>((from, to) => {
      let qb = db
        .from("cash_entries")
        .select(entryCols)
        .eq("tenant_id", tenantId)
        .eq("is_sample", false)
        .eq("currency", "TRY")
        .is("voided_at", null)
        .in("kind", ["expense", "adjust"])
        .eq("account.owner_scope", "office")
        .gte("entry_date", range.from);
      if (range.to) qb = qb.lte("entry_date", range.to);
      return qb.order("id", { ascending: true }).range(from, to) as unknown as PromiseLike<{ data: EntryRaw[] | null; error: DbErr | null }>;
    }),
    fetchAllRowsKeepError<LegacyRaw, DbErr>((from, to) => {
      let qb = db
        .from("expenses")
        .select(legacyCols)
        .eq("tenant_id", tenantId)
        .eq("is_sample", false)
        .gte("expense_date", range.from);
      if (range.to) qb = qb.lte("expense_date", range.to);
      return qb.order("id", { ascending: true }).range(from, to) as unknown as PromiseLike<{ data: LegacyRaw[] | null; error: DbErr | null }>;
    }),
  ]);
  const error = entryRes.error ?? legacyRes.error;
  if (error) return { rows: [], error };
  const entries = entryRes.data.map((e) => ({ ...e, advisorId: withAdvisor ? (one(e.property ?? null)?.assigned_to ?? null) : null }));
  const legacy = legacyRes.data.map((x) => ({ ...x, advisorId: withAdvisor ? (one(x.property ?? null)?.assigned_to ?? null) : null }));
  return { rows: mergeLedgerExpenses(entries, legacy), error: null };
}

// ---------------------------------------------------------------------------------------------------------------------
// Portal giderleri (yatırım getirisi): defterde portal eşlemesi düzenli ödeme kuralındadır (`recurring_rules.portal_key`);
// kuralın işlenmiş dönemi (`recurring_occurrences.entry_id`) hareketi taşır. Eski `expenses.portal_key` satırları yalnız
// deftere bağlı CANLI hareketi yoksa sayılır.
// ---------------------------------------------------------------------------------------------------------------------

export type PortalLedgerExpense = { portalKey: string; amount: number; date: string; recurrence: "monthly" | "quarterly" | "yearly" | null };

const FREQUENCIES: ReadonlySet<string> = new Set(["monthly", "quarterly", "yearly"]);

/** SAF birleştirme: kural hareketleri + bağsız eski portal giderleri. */
export function mergePortalExpenses(
  ledger: readonly { portalKey: string; frequency: string | null; entry: LedgerExpenseEntry }[],
  legacy: readonly { id: string; portal_key: string | null; amount: number | string; expense_date: string; recurrence: string | null }[],
  linkedExpenseIds: ReadonlySet<string>,
): PortalLedgerExpense[] {
  const out: PortalLedgerExpense[] = [];
  for (const l of ledger) {
    const amount = ledgerExpenseAmount(l.entry);
    if (amount === null || amount === 0) continue;
    out.push({
      portalKey: l.portalKey,
      amount,
      date: String(l.entry.entry_date).slice(0, 10),
      recurrence: l.frequency && FREQUENCIES.has(l.frequency) ? (l.frequency as PortalLedgerExpense["recurrence"]) : null,
    });
  }
  for (const x of legacy) {
    if (!x.portal_key || linkedExpenseIds.has(x.id)) continue;
    const amount = round2(num(x.amount));
    if (!(amount > 0)) continue;
    out.push({
      portalKey: x.portal_key,
      amount,
      date: String(x.expense_date).slice(0, 10),
      recurrence: x.recurrence && FREQUENCIES.has(x.recurrence) ? (x.recurrence as PortalLedgerExpense["recurrence"]) : null,
    });
  }
  return out;
}

const chunk = <T,>(list: readonly T[], size = 200): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/** `since` (YYYY-MM-DD) sonrası portala eşlenmiş giderler. Hata kodu korunur. */
export async function loadPortalLedgerExpenses(
  db: SupabaseClient,
  tenantId: string,
  since: string,
): Promise<{ rows: PortalLedgerExpense[]; error: DbErr | null }> {
  const [rulesRes, legacyRes] = await Promise.all([
    fetchAllRowsKeepError<{ id: string; portal_key: string; frequency: string | null }, DbErr>((from, to) =>
      db
        .from("recurring_rules")
        .select("id, portal_key, frequency")
        .eq("tenant_id", tenantId)
        .not("portal_key", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRowsKeepError<{ id: string; portal_key: string | null; amount: number | string; expense_date: string; recurrence: string | null }, DbErr>((from, to) =>
      db
        .from("expenses")
        .select("id, amount, expense_date, recurrence, portal_key")
        .eq("tenant_id", tenantId)
        .eq("is_sample", false)
        .not("portal_key", "is", null)
        .gte("expense_date", since)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  if (legacyRes.error) return { rows: [], error: legacyRes.error };
  if (rulesRes.error) return { rows: [], error: rulesRes.error };
  const rules = new Map(rulesRes.data.map((r) => [r.id, r]));

  const ledger: { portalKey: string; frequency: string | null; entry: LedgerExpenseEntry }[] = [];
  if (rules.size > 0) {
    const occParts = await Promise.all(
      chunk([...rules.keys()]).map((part) =>
        fetchAllRowsKeepError<{ id: string; rule_id: string; entry_id: string }, DbErr>((from, to) =>
          db
            .from("recurring_occurrences")
            .select("id, rule_id, entry_id")
            .eq("tenant_id", tenantId)
            .eq("status", "posted")
            .in("rule_id", part)
            .not("entry_id", "is", null)
            .order("id", { ascending: true })
            .range(from, to),
        ),
      ),
    );
    const ruleOfEntry = new Map<string, string>();
    for (const res of occParts) {
      if (res.error) return { rows: [], error: res.error };
      for (const o of res.data) ruleOfEntry.set(o.entry_id, o.rule_id);
    }
    const entryParts = await Promise.all(
      chunk([...ruleOfEntry.keys()]).map((part) =>
        fetchAllRowsKeepError<LedgerExpenseEntry, DbErr>((from, to) =>
          db
            .from("cash_entries")
            .select("id, entry_date, direction, kind, amount, vat_amount, withholding_amount, category, expense_id, reversal_of, source_type")
            .eq("tenant_id", tenantId)
            .eq("is_sample", false)
            .eq("currency", "TRY")
            .is("voided_at", null)
            .gte("entry_date", since)
            .in("id", part)
            .order("id", { ascending: true })
            .range(from, to),
        ),
      ),
    );
    for (const res of entryParts) {
      if (res.error) return { rows: [], error: res.error };
      for (const e of res.data) {
        const rule = rules.get(ruleOfEntry.get(e.id) ?? "");
        if (rule) ledger.push({ portalKey: rule.portal_key, frequency: rule.frequency, entry: e });
      }
    }
  }

  // Eski satırın canlı defter bağı (gider kaydı üreten hareket / taşınan satır) varsa ikinci kez sayılmaz.
  const linked = new Set<string>();
  const legacyIds = legacyRes.data.map((x) => x.id);
  const linkParts = await Promise.all(
    chunk(legacyIds).map((part) =>
      fetchAllRowsKeepError<{ id: string; expense_id: string }, DbErr>((from, to) =>
        db
          .from("cash_entries")
          .select("id, expense_id")
          .eq("tenant_id", tenantId)
          .is("voided_at", null)
          .in("expense_id", part)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ),
  );
  for (const res of linkParts) {
    if (res.error) return { rows: [], error: res.error };
    for (const r of res.data) linked.add(r.expense_id);
  }
  return { rows: mergePortalExpenses(ledger, legacyRes.data, linked), error: null };
}
