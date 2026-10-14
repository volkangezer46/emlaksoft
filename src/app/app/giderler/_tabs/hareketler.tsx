import Link from "@/components/ui/smart-link";
import { Archive, ArrowDownCircle, ArrowLeftRight, ArrowUpCircle, BookOpen, CalendarClock, FileBarChart, Inbox, Paperclip, Scale } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Kbd } from "@/components/ui/kbd";
import { FilterDate, FilterGrid, FilterSelect, KpiStrip, ListPager, ListToolbar, MobileCard, MobileCardList, StatusPill, ViewSwitcher, type KpiItem, type ViewOption } from "@/components/ui/list-kit";
import { Button } from "@/components/ui/button";
import { buildActiveChips, isoDateParam, pageWindow, parsePage, uuidParam } from "@/components/ui/list-kit/list-logic";
import { BulkRowCheckbox, BulkSelectAll, BulkSelectionProvider } from "@/components/app/bulk-selection";
import { buildHref, mergeParams, type ParamRecord } from "@/lib/ui/filter-params";
import { formatDateTr } from "@/lib/format";
import { now, trDayKey } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { loadExpenseReceipts, type ExpenseReceiptFile } from "@/lib/expense-receipts";
import { listExpenses } from "@/app/actions/expenses";
import type { FinanceTabProps } from "@/lib/finance/ledger/types";
import { CASH_CATEGORIES, cashCategoryLabel, isCashCategory, OWNER_PAYOUT_CATEGORY, SALARY_CATEGORY } from "@/lib/finance/cash/categories";
import { ENTRY_PAGE_SIZE, isMissingCashSchema, loadAccountsWithBalances, loadCashEntries, loadCashSummary, type AccountWithBalance, type CashEntry } from "@/lib/finance/cash/load";
import { formatAccountMoney, sumByCurrency } from "@/lib/finance/cash/money";
import { EntryRowActions, type UndoInfo } from "../entry-actions";
import { ExpensesTable } from "../expenses-table";
import { LedgerBulkBar, type BulkRowMeta } from "../_hareketler/bulk-bar";
import { InlineCategory, InlineNote, InlineParty, LockedReason, type CategoryOption } from "../_hareketler/inline-edit";
import { LedgerKeyboardNav } from "../_hareketler/keyboard-nav";
import { AdoptLegacyButton, type AdoptAccount } from "../_hareketler/legacy-adopt";
import { LEDGER_PAGE_SIZE, ledgerFilterParams, ledgerNeedsOfficeScope, ledgerQueryOps, lockReasonFor, parseLedgerFilters, type QueryOp } from "../_hareketler/ledger-filters";
import { LedgerSavedViews, type SavedLedgerView } from "../_hareketler/saved-views";
import { FINANCE_BASE } from "./finance-shell";

const TUR_OPTIONS = [
  { value: "", label: "Tümü" },
  { value: "gelir", label: "Gelir" },
  { value: "gider", label: "Gider" },
  { value: "transfer", label: "Transfer" },
] as const;

/** Hareketler listesinin adres kökü: Finans'ta `/app/giderler?sekme=hareketler`, Kasam'da `/app/hesabim?sekme=kasam`. */
export type EntriesNav = { base: string; sekme: string };
const FINANCE_NAV: EntriesNav = { base: FINANCE_BASE, sekme: "hareketler" };

/** Kasam (ve eski çağıranlar): kişisel hesap hareketleri; kendi istemcisini ve hesap listesini verir. */
export type CashEntriesProps = {
  /** "personal" = Kasam (yalnız verilen kişisel hesaplar). Verilmezse `limitToAccounts`'tan çıkarılır. */
  scope?: "office" | "personal";
  /** Kasam: liste yalnız verilen hesapların hareketlerini içerir (ofis hareketi asla sorgulanmaz). */
  limitToAccounts?: boolean;
  supabase: SupabaseClient;
  params: ParamRecord;
  accounts: readonly AccountWithBalance[];
  today: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canSalary: boolean;
  nav?: EntriesNav;
};

/**
 * Hareketler sekmesi. İki kullanım:
 * - Muhasebe (`FinanceTabProps`): defter v2 — finance_ledger_v (hareketler + hesaba bağlanmamış "Hesapsız" eski giderler),
 *   KDV/stopaj/cari/ek/vade sütunları, satır içi düzenleme, toplu işlem, kayıtlı görünümler ve klavye kısayolları.
 * - Kasam (`CashEntriesProps`, scope="personal"): kişisel hesap hareketleri (eskisi gibi; ofis hareketi sorgulanmaz).
 */
export async function HareketlerTab(props: FinanceTabProps | CashEntriesProps) {
  if ("supabase" in props) return <CashEntriesList {...props} />;
  return <LedgerTab {...props} />;
}

// ===========================================================================
// Defter v2 (Muhasebe)
// ===========================================================================

const LEDGER_COLUMNS =
  "id, origin, account_id, direction, amount, currency, entry_date, kind, category, title, counterparty, party_id, vat_rate, vat_amount, withholding_amount, open_item_id, source_type, expense_id, reconciled_at, attachment_count, note";

type LedgerRow = {
  id: string;
  origin: "entry" | "legacy_expense";
  account_id: string | null;
  direction: "in" | "out";
  amount: number;
  currency: string;
  entry_date: string;
  kind: string;
  category: string | null;
  title: string;
  counterparty: string | null;
  party_id: string | null;
  vat_rate: number | null;
  vat_amount: number | null;
  withholding_amount: number | null;
  open_item_id: string | null;
  source_type: string | null;
  expense_id: string | null;
  reconciled_at: string | null;
  attachment_count: number;
  note: string | null;
};

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

function toLedgerRow(r: Record<string, unknown>): LedgerRow {
  return {
    id: String(r.id),
    origin: r.origin === "legacy_expense" ? "legacy_expense" : "entry",
    account_id: (r.account_id as string | null) ?? null,
    direction: r.direction === "in" ? "in" : "out",
    amount: Number(r.amount ?? 0),
    currency: String(r.currency ?? "TRY"),
    entry_date: String(r.entry_date),
    kind: String(r.kind ?? ""),
    category: (r.category as string | null) ?? null,
    title: String(r.title ?? ""),
    counterparty: (r.counterparty as string | null) ?? null,
    party_id: (r.party_id as string | null) ?? null,
    vat_rate: num(r.vat_rate),
    vat_amount: num(r.vat_amount),
    withholding_amount: num(r.withholding_amount),
    open_item_id: (r.open_item_id as string | null) ?? null,
    source_type: (r.source_type as string | null) ?? null,
    expense_id: (r.expense_id as string | null) ?? null,
    reconciled_at: (r.reconciled_at as string | null) ?? null,
    attachment_count: Number(r.attachment_count ?? 0),
    note: (r.note as string | null) ?? null,
  };
}

/** Saf sorgu adımlarını PostgREST oluşturucusuna uygular (filtre kontratı: URL -> sorgu birebir). */
type Filterable = {
  eq(column: string, value: unknown): Filterable;
  neq(column: string, value: unknown): Filterable;
  is(column: string, value: null): Filterable;
  gte(column: string, value: unknown): Filterable;
  lte(column: string, value: unknown): Filterable;
  in(column: string, values: readonly unknown[]): Filterable;
  or(filters: string): Filterable;
};
// PostgREST oluşturucusunun seçim-sütunu tipleri derin; filtre adımları yapısal arayüzle uygulanır, tip aynen geri verilir.
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

const SOURCE_LABEL: Record<string, string> = {
  commission: "Komisyon tahsilatı",
  rent: "Kira tahsilatı",
  building: "Aidat tahsilatı",
  owner_payout: "Mülk sahibi ödemesi",
  due: "Aidat",
  recurring: "Düzenli ödeme",
  import: "Ekstreden",
  open_item: "Vadeli kalem",
};

/**
 * Satır içi kategori / not değiştirilebilen kaynaklar. finance_update_entry_v2 kategori, not, başlık, tutar ve tarihi
 * "çekirdek" alan sayar ve elle girilmemiş (komisyon, kira, ekstre, düzenli, vadeli kalem) harekette 'locked' döner.
 * Cari bağı çekirdek değildir: her harekette (transfer hariç) değişebilir.
 */
const CATEGORY_EDITABLE_SOURCES = new Set(["manual"]);

/** Kaynak süzgecinin etiketleri (seçim + etkin süzgeç çipi). */
const KAYNAK_LABEL: Record<string, string> = {
  hareket: "Hesaba işlenen hareketler",
  eski: "Hesapsız eski giderler",
  elle: "Elle girilen gelir (kâr/zarar kapsamı)",
};

/** KDV süzgecinin etiketleri (vergi sekmesi kümeleri; ledger-filters `kdv`). */
const KDV_LABEL: Record<string, string> = {
  var: "KDV'li (KDV özeti kapsamı)",
  yok: "KDV bilgisi yok",
};

function hrefOf(params: Record<string, string>, patch: Record<string, string>): string {
  return buildHref(FINANCE_BASE, mergeParams({ ...params, sekme: "hareketler" }, patch));
}

async function LedgerTab(props: FinanceTabProps) {
  const { params, canCreate, canEdit, canDelete, tenantId } = props;
  const canSalary = props.canSalary;
  const supabase = await createClient();
  const today = trDayKey(now());

  if (params.gorunum === "eski-giderler") {
    return <LegacyExpensesView supabase={supabase} tenantId={tenantId} params={params} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
  }

  const f = parseLedgerFilters(params, { canSalary });
  const filterParams = ledgerFilterParams(f);
  // KDV özeti ve kâr/zarar süzgeçleri (kdv, stopaj, kaynak=elle) yalnız ofis hesaplarını sayar; görünümde hesap kapsamı
  // sütunu yok. Bu tek küçük sorgu yalnız o süzgeçler açıkken çalışır (arşivliler dahil; RPC'ler de arşivi sayar).
  // Hata verirse liste boş kalır (süzgeç gevşemez); kullanıcıya uyarı gösterilir.
  let officeScopeFailed = false;
  let officeAccountIds: string[] | null = null;
  if (ledgerNeedsOfficeScope(f)) {
    const officeRes = await supabase.from("finance_accounts").select("id").eq("owner_scope", "office").limit(500);
    if (officeRes.error) {
      officeScopeFailed = true;
      console.error("LedgerTab office accounts", { code: officeRes.error.code });
    }
    officeAccountIds = ((officeRes.data ?? []) as { id: string }[]).map((a) => a.id);
  }
  const ops = ledgerQueryOps(f, { officeAccountIds });
  const baseOps = ledgerQueryOps(f, { omitKaynak: true, officeAccountIds });
  const from = (f.page - 1) * LEDGER_PAGE_SIZE;

  const countOf = (origin: "entry" | "legacy_expense") =>
    applyOps(supabase.from("finance_ledger_v").select("id", { count: "exact", head: true }), baseOps).eq("origin", origin);

  const [cash, pageRes, entryCount, legacyCount, summary, locksRes, viewsRes, customCatsRes, partiesRes, legacyDefs] = await Promise.all([
    loadAccountsWithBalances(supabase),
    applyOps(supabase.from("finance_ledger_v").select(LEDGER_COLUMNS, { count: "exact" }), ops)
      .order("entry_date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + LEDGER_PAGE_SIZE - 1),
    countOf("entry"),
    countOf("legacy_expense"),
    loadCashSummary(supabase, { from: f.from || null, to: f.to || null }),
    supabase.from("finance_period_locks").select("period_month"),
    supabase.from("finance_saved_views").select("id, name, params").eq("tab", "hareketler").order("created_at", { ascending: true }).limit(30),
    supabase.from("finance_categories").select("key, label, direction").is("archived_at", null).order("sort", { ascending: true }).limit(200),
    supabase.from("finance_parties").select("id, name").is("archived_at", null).order("name", { ascending: true }).limit(300),
    getDefinitionsOrDefault("expense_category"),
  ]);

  // Defter v2 şeması (FN1 migration'ı) yoksa eski hareket listesi aynen çalışır.
  if (pageRes.error) {
    if (!isMissingCashSchema(pageRes.error)) console.error("LedgerTab", { code: pageRes.error.code });
    return (
      <CashEntriesList
        supabase={supabase}
        params={params}
        accounts={cash.accounts}
        today={today}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        canSalary={canSalary}
        scope="office"
      />
    );
  }

  const rows = ((pageRes.data ?? []) as Record<string, unknown>[]).map(toLedgerRow);
  const total = pageRes.count ?? rows.length;

  // Belge bağlantısı (görünümde yok) ve cari adları: sayfa satırları için tek tur, paralel.
  const entryIds = rows.filter((r) => r.origin === "entry").map((r) => r.id);
  const partyIds = [...new Set(rows.map((r) => r.party_id).filter((v): v is string => Boolean(v)))];
  const [notesRes, partyNamesRes] = await Promise.all([
    entryIds.length > 0 ? supabase.from("cash_entries").select("id, document_url, created_expense").in("id", entryIds) : Promise.resolve({ data: [] as unknown[] }),
    partyIds.length > 0 ? supabase.from("finance_parties").select("id, name").in("id", partyIds) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const entryMeta = new Map<string, EntryMeta>(
    ((notesRes.data ?? []) as { id: string; document_url: string | null; created_expense: boolean | null }[]).map((n) => [
      n.id,
      { documentUrl: n.document_url, createdExpense: n.created_expense === true },
    ]),
  );
  const partyName = new Map(((partyNamesRes.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));

  const accounts = cash.accounts;
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const lockedMonths = new Set(((locksRes.data ?? []) as { period_month: string }[]).map((l) => String(l.period_month).slice(0, 7)));
  const savedViews: SavedLedgerView[] = ((viewsRes.data ?? []) as { id: string; name: string; params: unknown }[]).map((v) => ({
    id: v.id,
    name: v.name,
    params: Object.fromEntries(Object.entries(v.params && typeof v.params === "object" ? (v.params as Record<string, unknown>) : {}).filter(([, x]) => typeof x === "string" && x)) as Record<string, string>,
  }));

  // Kategoriler: sistem (kod) + ofis (finance_categories); eski gider kategorileri yalnız etiket için.
  const custom = ((customCatsRes.data ?? []) as { key: string; label: string; direction: "in" | "out" }[]);
  const categoriesFor = (dir: "in" | "out"): CategoryOption[] => [
    ...CASH_CATEGORIES.filter((c) => c.direction === dir && (canSalary || c.value !== SALARY_CATEGORY)).map((c) => ({ value: c.value, label: c.label })),
    ...custom.filter((c) => c.direction === dir).map((c) => ({ value: c.key, label: c.label })),
  ];
  const categoriesIn = categoriesFor("in");
  const categoriesOut = categoriesFor("out");
  const legacyCatLabel = new Map(legacyDefs.map((d) => [d.value, d.label]));
  const customLabel = new Map(custom.map((c) => [c.key, c.label]));
  const categoryLabel = (row: Pick<LedgerRow, "origin" | "category">) =>
    !row.category ? "—" : row.origin === "legacy_expense" ? (legacyCatLabel.get(row.category) ?? row.category) : (customLabel.get(row.category) ?? cashCategoryLabel(row.category));

  // KPI: tutarlar hesap özet RPC'sinden (finance_cash_summary) gelir, listeden DEĞİL. Hesap/kategori kapsamı uygulanır.
  const inScope = summary.filter((s) => accountById.has(s.account_id) && (!f.accountId || s.account_id === f.accountId) && (!f.kategori || s.category === f.kategori));
  const sumOf = (dir: "in" | "out") => sumByCurrency(inScope.filter((s) => s.direction === dir).map((s) => ({ currency: accountById.get(s.account_id)?.currency ?? "TRY", amount: s.total })));
  const incomes = sumOf("in");
  const expenses = sumOf("out");
  const money = (list: { currency: string; amount: number }[]) => (list.length === 0 ? formatAccountMoney(0, "TRY") : list.map((r) => formatAccountMoney(r.amount, r.currency)).join(" · "));
  const net = sumByCurrency([...incomes, ...expenses.map((e) => ({ currency: e.currency, amount: -e.amount }))]);
  // Kartlar hesap özet RPC'sinden gelir: yalnız hesap, kategori ve tarih kapsamını uygular. Cari / arama / kaynak / mutabakat /
  // belge süzgeci açıkken liste ile kart farklı kümeyi sayar; ipucu bunu açıkça söyler.
  const cardsIgnoreFilters = Boolean(f.cari || f.q || f.kaynak || f.kdv || f.stopaj || f.mutabikYok || f.belgeYok);
  const scopeHint = f.from || f.to ? "seçili aralık" : "tüm zamanlar";
  const rangeHint = cardsIgnoreFilters ? `${scopeHint}; cari, arama, kaynak, KDV, stopaj, mutabakat ve belge süzgecinden bağımsız` : scopeHint;
  const legacyN = legacyCount.count ?? 0;
  const entryN = entryCount.count ?? 0;

  const kpis: KpiItem[] = [
    { label: "Gelir", value: money(incomes), icon: <ArrowDownCircle />, tone: "success", href: hrefOf(filterParams, { tur: "gelir", kaynak: "" }), hint: rangeHint },
    { label: "Gider", value: money(expenses), icon: <ArrowUpCircle />, tone: "warning", href: hrefOf(filterParams, { tur: "gider", kaynak: "hareket" }), hint: rangeHint },
    { label: "Net", value: money(net), icon: <Scale />, tone: "info", href: hrefOf(filterParams, { tur: "", kaynak: "hareket" }), hint: cardsIgnoreFilters ? "hesaplara işlenen, transfer hariç; liste süzgecinden bağımsız" : "hesaplara işlenen, transfer hariç" },
    { label: "Hesapsız eski gider", value: legacyN, icon: <Inbox />, tone: legacyN > 0 ? "warning" : "neutral", href: hrefOf(filterParams, { kaynak: "eski", tur: "", mutabik: "" }), hint: "hesaba taşınmayı bekliyor" },
  ];

  const accountOptions = [{ value: "", label: "Tüm hesaplar" }, ...accounts.map((a) => ({ value: a.id, label: `${a.name}${a.owner_scope === "user" ? " (kişisel)" : ""}${a.archived_at ? " (arşiv)" : ""}` }))];
  const parties = ((partiesRes.data ?? []) as { id: string; name: string }[]);
  const allCategoryOptions = [
    { value: "", label: "Tümü" },
    ...categoriesOut.map((c) => ({ value: c.value, label: `Gider · ${c.label}` })),
    ...categoriesIn.map((c) => ({ value: c.value, label: `Gelir · ${c.label}` })),
    { value: OWNER_PAYOUT_CATEGORY, label: cashCategoryLabel(OWNER_PAYOUT_CATEGORY) },
  ];

  const pathParams: ParamRecord = { ...filterParams, sekme: "hareketler" };
  const chips = buildActiveChips(FINANCE_BASE, pathParams, [
    { key: "hesap", label: "Hesap", format: (v) => accountById.get(v)?.name ?? "Seçili hesap" },
    { key: "tur", label: "Tür", format: (v) => TUR_OPTIONS.find((o) => o.value === v)?.label ?? v },
    { key: "kategori", label: "Kategori", format: (v) => customLabel.get(v) ?? legacyCatLabel.get(v) ?? cashCategoryLabel(v) },
    { key: "cari", label: "Cari", format: (v) => partyName.get(v) ?? parties.find((p) => p.id === v)?.name ?? "Seçili cari" },
    { key: "kaynak", label: "Kaynak", format: (v) => KAYNAK_LABEL[v] ?? "Hareketler" },
    { key: "kdv", label: "KDV", format: (v) => KDV_LABEL[v] ?? "KDV" },
    { key: "stopaj", label: "Stopaj", format: () => "Stopajlı" },
    { key: "mutabik", label: "Mutabakat", format: () => "Mutabık değil" },
    { key: "belge", label: "Belge", format: () => "Ekli belge yok" },
    { key: "from", label: "Başlangıç", format: (v) => formatDateTr(v) },
    { key: "to", label: "Bitiş", format: (v) => formatDateTr(v) },
    { key: "q", label: "Arama" },
  ]);

  const views: ViewOption[] = [
    { value: "defter", label: "Defter", icon: BookOpen, href: hrefOf(filterParams, {}) },
    { value: "eski-giderler", label: "Eski giderler", icon: Archive, href: `${FINANCE_BASE}?sekme=hareketler&gorunum=eski-giderler` },
  ];

  const adoptAccounts: AdoptAccount[] = accounts
    .filter((a) => a.owner_scope === "office" && !a.archived_at && a.currency === "TRY")
    .map((a) => ({ id: a.id, name: a.name, balance: a.balance }));

  const ctx: RowCtx = {
    accountById,
    partyName,
    entryMeta,
    lockedMonths,
    categoriesIn,
    categoriesOut,
    categoryLabel,
    today,
    canEdit,
    canDelete,
    canCreate,
    canSalary,
    adoptAccounts,
  };
  const meta: BulkRowMeta[] = rows.map((r) => {
    const p = rowPerms(r, ctx);
    return {
      id: r.id,
      origin: r.origin,
      direction: r.direction,
      amount: r.amount,
      currency: r.currency,
      categoryEditable: p.category && !p.lock,
      partyEditable: p.party && !p.lock,
      reconcilable: p.reconcile,
      reconciled: Boolean(r.reconciled_at),
    };
  });
  const selectable = canEdit || canCreate;
  const w = pageWindow(f.page, total, LEDGER_PAGE_SIZE, rows.length);
  const reportFilters = new URLSearchParams({ sekme: "raporlar", rapor: f.accountId ? "hesap-ekstresi" : "gelir-gider-dokumu" });
  if (f.accountId) reportFilters.set("hesap", f.accountId);
  if (f.from) reportFilters.set("from", f.from);
  if (f.to) reportFilters.set("to", f.to);

  const kaynakTabs = [
    { value: "", label: "Tümü", n: entryN + legacyN },
    { value: "hareket", label: "Hareketler", n: entryN },
    { value: "eski", label: "Hesapsız", n: legacyN },
  ];

  return (
    <LedgerKeyboardNav>
      <KpiStrip items={kpis} />

      {officeScopeFailed ? <Alert tone="warning">Ofis hesapları şu an yüklenemedi; bu süzgeçle liste boş görünebilir. Sayfayı yenileyin.</Alert> : null}

      <ListToolbar
        pathname={FINANCE_BASE}
        params={pathParams}
        views={views}
        activeView="defter"
        searchPlaceholder="Açıklama veya karşı taraf ara…  ( / )"
        searchLabel="Hareketlerde ara"
        panelParamKeys={["hesap", "tur", "kategori", "cari", "kaynak", "kdv", "stopaj", "mutabik", "belge", "from", "to"]}
        panel={
          <FilterGrid>
            <FilterSelect name="hesap" label="Hesap" value={f.accountId} options={accountOptions} />
            <FilterSelect name="tur" label="Tür" value={f.tur} options={TUR_OPTIONS} />
            <FilterSelect name="kategori" label="Kategori" value={f.kategori} options={allCategoryOptions} />
            <FilterSelect name="cari" label="Cari" value={f.cari} options={[{ value: "", label: "Tüm cariler" }, ...parties.map((p) => ({ value: p.id, label: p.name }))]} />
            <FilterSelect name="kaynak" label="Kaynak" value={f.kaynak} options={[{ value: "", label: "Tümü" }, ...Object.entries(KAYNAK_LABEL).map(([value, label]) => ({ value, label }))]} />
            <FilterSelect name="kdv" label="KDV" value={f.kdv} options={[{ value: "", label: "Tümü" }, ...Object.entries(KDV_LABEL).map(([value, label]) => ({ value, label }))]} />
            <FilterSelect name="stopaj" label="Stopaj" value={f.stopaj ? "var" : ""} options={[{ value: "", label: "Tümü" }, { value: "var", label: "Stopajlı" }]} />
            <FilterSelect name="mutabik" label="Mutabakat" value={f.mutabikYok ? "hayir" : ""} options={[{ value: "", label: "Tümü" }, { value: "hayir", label: "Mutabık değil" }]} />
            <FilterSelect name="belge" label="Belge" value={f.belgeYok ? "yok" : ""} options={[{ value: "", label: "Tümü" }, { value: "yok", label: "Ekli belge yok" }]} />
            <FilterDate name="from" label="Başlangıç" value={f.from} />
            <FilterDate name="to" label="Bitiş" value={f.to} />
          </FilterGrid>
        }
        chips={chips}
        resultCount={total}
        resultNoun="kayıt"
        savedViews={<LedgerSavedViews base={FINANCE_BASE} sekme="hareketler" views={savedViews} current={filterParams} />}
        actions={
          <Link
            href={`${FINANCE_BASE}?${reportFilters.toString()}`}
            className="focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-xs font-semibold text-accent-text hover:bg-surface-hover touch:min-h-11"
          >
            <FileBarChart className="h-3.5 w-3.5" aria-hidden="true" />
            {f.accountId ? "Hesap ekstresi raporu" : "Gelir-gider dökümü raporu"}
          </Link>
        }
      />

      <nav aria-label="Kaynak" className="-mt-1 flex flex-wrap items-center gap-1.5">
        {kaynakTabs.map((t) => {
          const on = f.kaynak === t.value;
          return (
            <Link
              key={t.value || "tumu"}
              href={hrefOf(filterParams, { kaynak: t.value, mutabik: t.value === "eski" ? "" : filterParams.mutabik ?? "" })}
              aria-current={on ? "page" : undefined}
              className={`focus-ring press inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition touch:min-h-11 ${on ? "border-brand-300 bg-surface-selected text-brand-700" : "border-line bg-surface text-text-muted hover:text-text"}`}
            >
              {t.label}
              <span className="numeric rounded-full bg-canvas px-1.5 text-text-faint">{t.n}</span>
            </Link>
          );
        })}
        <p className="kbd-hint ml-auto hidden items-center gap-1 text-xs text-text-faint lg:flex" aria-hidden="true">
          <Kbd>/</Kbd> ara · <Kbd>J</Kbd><Kbd>K</Kbd> satır · <Kbd>Enter</Kbd> düzenle
        </p>
      </nav>

      {legacyN > 0 && f.kaynak !== "hareket" && canCreate ? (
        <LegacyCallout count={legacyN} href={hrefOf(filterParams, { kaynak: "eski" })} active={f.kaynak === "eski"} />
      ) : null}

      {rows.length === 0 ? (
        chips.length > 0 ? (
          <div className="grid place-items-center rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
            <h2 className="font-display text-lg font-bold text-text">Bu filtreyle kayıt yok</h2>
            <Link href={`${FINANCE_BASE}?sekme=hareketler`} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-accent-text hover:underline">
              Filtreleri temizle
            </Link>
          </div>
        ) : (
          <EmptyState
            icon={ArrowLeftRight}
            title="Henüz hareket yok"
            description={accounts.length === 0 ? "Önce bir hesap açın (ör. ofis kasası), sonra gelir ve giderlerinizi ekleyin." : "Sayfanın üstündeki Yeni kayıt düğmesiyle (ya da G / E kısayoluyla) ilk hareketi girin."}
            tone="amber"
            action={accounts.length === 0 ? { href: `${FINANCE_BASE}?sekme=kasa-banka`, label: "İlk hesabı aç" } : undefined}
          />
        )
      ) : (
        <BulkSelectionProvider>
          {selectable ? (
            <LedgerBulkBar rows={meta} categoriesIn={categoriesIn} categoriesOut={categoriesOut} adoptAccounts={adoptAccounts} canEdit={canEdit} canAdopt={canCreate} />
          ) : null}
          <MobileCardList aria-label="Defter kayıtları">
            {rows.map((r) => (
              <LedgerCard key={r.id} row={r} ctx={ctx} selectable={selectable} />
            ))}
          </MobileCardList>
          <div className="hidden overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface md:block">
            <table className="w-full min-w-[980px] text-sm">
              <caption className="sr-only">Defter kayıtları: hareketler ve hesapsız eski giderler</caption>
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">
                  {selectable ? (
                    <th scope="col" className="w-10 px-3 py-2.5">
                      <BulkSelectAll ids={rows.map((r) => r.id)} noun="defter" />
                    </th>
                  ) : null}
                  <th scope="col" className="px-3 py-2.5">Tarih</th>
                  <th scope="col" className="px-3 py-2.5">Açıklama · cari · not</th>
                  <th scope="col" className="px-3 py-2.5">Kategori</th>
                  <th scope="col" className="px-3 py-2.5">Hesap</th>
                  <th scope="col" className="px-3 py-2.5 text-right">KDV</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Stopaj</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Tutar</th>
                  <th scope="col" className="px-3 py-2.5 text-right"><span className="sr-only">İşlemler</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <LedgerTableRow key={r.id} row={r} ctx={ctx} selectable={selectable} />
                ))}
              </tbody>
            </table>
          </div>
        </BulkSelectionProvider>
      )}

      <ListPager pathname={FINANCE_BASE} params={pathParams} window={w} total={total} />
      {!canCreate && !canEdit ? <p className="text-xs text-text-faint">Bu ekranda yalnız görüntüleme yetkiniz var.</p> : null}
    </LedgerKeyboardNav>
  );
}

type EntryMeta = { documentUrl: string | null; createdExpense: boolean };

type RowCtx = {
  accountById: Map<string, AccountWithBalance>;
  partyName: Map<string, string>;
  /** Görünümde olmayan hareket alanları (belge bağlantısı, created_expense); sayfa satırları için tek sorgu. */
  entryMeta: Map<string, EntryMeta>;
  lockedMonths: ReadonlySet<string>;
  categoriesIn: readonly CategoryOption[];
  categoriesOut: readonly CategoryOption[];
  categoryLabel: (row: Pick<LedgerRow, "origin" | "category">) => string;
  today: string;
  canEdit: boolean;
  canDelete: boolean;
  canCreate: boolean;
  canSalary: boolean;
  adoptAccounts: readonly AdoptAccount[];
};

/** Satır izinleri: kişisel hesabın hareketini yalnız sahibi görür, düzenleme onda da açıktır (RPC doğrular). */
function rowPerms(r: LedgerRow, ctx: RowCtx) {
  const account = r.account_id ? ctx.accountById.get(r.account_id) : undefined;
  const personal = account?.owner_scope === "user";
  const isEntry = r.origin === "entry";
  const isTransfer = r.kind === "transfer";
  const lock = isEntry ? lockReasonFor(r.entry_date, ctx.lockedMonths) : null;
  const mayEdit = isEntry && (personal || ctx.canEdit);
  const manual = r.source_type === "manual" && (r.kind === "income" || r.kind === "expense");
  return {
    account,
    personal,
    isTransfer,
    lock,
    mayEdit,
    /** Kategori ve not (çekirdek alan): yalnız elle girilmiş gelir/gider; kilitli ayda pasif. */
    category: mayEdit && manual && CATEGORY_EDITABLE_SOURCES.has(r.source_type ?? ""),
    /** Cari bağı: çekirdek alan değil, kaynaklı harekette de değişebilir (kilitli ayda pasif). */
    party: mayEdit && !isTransfer,
    /** Elle mutabakat: transfer dahil gelir/gider/transfer (düzeltme hariç), ofis hesaplarında expenses:edit. */
    reconcile: isEntry && ctx.canEdit && (r.kind === "income" || r.kind === "expense" || r.kind === "transfer"),
    dialogEdit: mayEdit && manual,
    mayVoid: isEntry && (personal || ctx.canDelete),
    manual,
  };
}

function Amount({ r }: { r: LedgerRow }) {
  const isTransfer = r.kind === "transfer";
  return (
    <span className={`numeric whitespace-nowrap font-bold ${isTransfer ? "text-text" : r.direction === "in" ? "text-success-strong" : "text-danger-strong"}`}>
      {r.direction === "in" ? "+" : "−"}
      {formatAccountMoney(r.amount, r.currency)}
    </span>
  );
}

function Badges({ r }: { r: LedgerRow }) {
  return (
    <>
      {r.origin === "legacy_expense" ? <StatusPill tone="warning" dot={false}>Hesapsız</StatusPill> : null}
      {r.source_type && r.source_type !== "manual" && r.origin === "entry" ? <StatusPill tone="info" dot={false}>{SOURCE_LABEL[r.source_type] ?? r.source_type}</StatusPill> : null}
      {r.reconciled_at ? <StatusPill tone="success" dot={false}>Mutabık</StatusPill> : null}
      {r.open_item_id ? (
        <Link href={`${FINANCE_BASE}?sekme=cari&kalem=${r.open_item_id}`} className="inline-flex items-center gap-1 font-semibold text-accent-text hover:underline">
          <CalendarClock className="h-3 w-3" aria-hidden="true" /> Vadeli kalem
        </Link>
      ) : null}
      {r.attachment_count > 0 ? (
        <Link href={`${FINANCE_BASE}?sekme=belgeler&hareket=${r.id}`} className="inline-flex items-center gap-0.5 font-semibold text-accent-text hover:underline" aria-label={`${r.attachment_count} ekli belge`}>
          <Paperclip className="h-3 w-3" aria-hidden="true" />
          {r.attachment_count}
        </Link>
      ) : null}
    </>
  );
}

function vatText(r: LedgerRow): { text: string; sub: string | null } {
  if (r.vat_amount === null) return { text: "—", sub: null };
  return { text: formatAccountMoney(r.vat_amount, r.currency), sub: r.vat_rate !== null ? `%${r.vat_rate.toLocaleString("tr-TR")}` : null };
}

function RowActions({ r, ctx, p }: { r: LedgerRow; ctx: RowCtx; p: ReturnType<typeof rowPerms> }) {
  if (r.origin === "legacy_expense") {
    return ctx.canCreate ? (
      <div className="flex justify-end">
        <AdoptLegacyButton items={[{ id: r.id, amount: r.amount, currency: r.currency }]} accounts={ctx.adoptAccounts} />
      </div>
    ) : null;
  }
  if (!p.dialogEdit && !p.mayVoid) return null;
  return (
    <EntryRowActions
      entry={{ id: r.id, direction: r.direction, amount: r.amount, date: r.entry_date, category: r.category, title: r.title, counterparty: r.counterparty, note: r.note }}
      today={ctx.today}
      canEdit={p.dialogEdit}
      canVoid={p.mayVoid}
      canSalary={ctx.canSalary}
      isTransfer={p.isTransfer}
      undo={p.manual && r.account_id ? undoInfoFor(r, ctx.entryMeta.get(r.id)) : null}
      disabledReason={p.lock}
    />
  );
}

/**
 * İptal sonrası "Geri al" bilgisi. finance_void_entry gideri yalnız `created_expense=true` ise siler:
 * - created_expense=true: geri al gideri yeniden üretir (alsoExpense);
 * - expense_id dolu, created_expense=false ("Hesaba taşı" ile benimsenmiş eski gider): gider yerinde kalır, iptalle yeniden
 *   "Hesapsız" olur; geri al YENİ gider yazmaz, aynı gideri aynı hesaba yeniden taşır (adoptExpenseId);
 * - created_expense bilinmiyorsa (sorgu düştü) güvenli taraf: geri al gösterilmez.
 */
function undoInfoFor(r: LedgerRow, meta: EntryMeta | undefined): UndoInfo | null {
  if (!r.account_id || !meta) return null;
  if (r.expense_id && !meta.createdExpense) return { accountId: r.account_id, hadExpense: false, adoptExpenseId: r.expense_id };
  return { accountId: r.account_id, hadExpense: meta.createdExpense && Boolean(r.expense_id) };
}

function CategoryCell({ r, ctx, p }: { r: LedgerRow; ctx: RowCtx; p: ReturnType<typeof rowPerms> }) {
  if (!p.category) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
        {p.isTransfer ? "Transfer" : ctx.categoryLabel(r)}
        {p.lock ? <LockedReason reason={p.lock} /> : null}
      </span>
    );
  }
  return (
    <InlineCategory
      entryId={r.id}
      value={r.category}
      options={r.direction === "in" ? ctx.categoriesIn : ctx.categoriesOut}
      disabledReason={p.lock}
      label={r.title}
    />
  );
}

function PartyAndNote({ r, ctx, p }: { r: LedgerRow; ctx: RowCtx; p: ReturnType<typeof rowPerms> }) {
  const name = (r.party_id ? ctx.partyName.get(r.party_id) : null) ?? null;
  const doc = ctx.entryMeta.get(r.id)?.documentUrl ?? null;
  return (
    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
      {p.party ? (
        <InlineParty entryId={r.id} partyName={name ?? r.counterparty} direction={r.direction} disabledReason={p.lock} label={r.title} />
      ) : name ? (
        <Link href={`${FINANCE_BASE}?sekme=cari&cari=${r.party_id}`} className="hover:text-accent-text hover:underline">{name}</Link>
      ) : r.counterparty ? (
        <span>{r.counterparty}</span>
      ) : null}
      {p.category ? <InlineNote entryId={r.id} value={r.note} disabledReason={p.lock} label={r.title} /> : r.note ? <span className="truncate">{r.note}</span> : null}
      {doc ? (
        <a href={doc} target="_blank" rel="noreferrer noopener" className="font-semibold text-accent-text hover:underline">Belge</a>
      ) : null}
      <Badges r={r} />
    </div>
  );
}

function AccountCell({ r, p }: { r: LedgerRow; p: ReturnType<typeof rowPerms> }) {
  if (r.origin === "legacy_expense") return <span className="text-xs text-text-faint">Hesaba bağlı değil</span>;
  if (!p.account) return <span className="text-text-faint">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Link href={`${FINANCE_BASE}?sekme=hareketler&hesap=${p.account.id}`} className="font-medium text-accent-text hover:underline">{p.account.name}</Link>
      {p.personal ? <StatusPill tone="neutral" dot={false}>Kişisel</StatusPill> : null}
    </span>
  );
}

function LedgerTableRow({ row: r, ctx, selectable }: { row: LedgerRow; ctx: RowCtx; selectable: boolean }) {
  const p = rowPerms(r, ctx);
  const vat = vatText(r);
  return (
    <tr
      data-ledger-row=""
      tabIndex={-1}
      className="border-b border-line align-top outline-none last:border-b-0 hover:bg-surface-hover/40 focus:bg-surface-selected/60 data-[kb-active]:bg-surface-selected/60"
    >
      {selectable ? (
        <td className="px-3 py-3">
          <BulkRowCheckbox id={r.id} label={r.title} />
        </td>
      ) : null}
      <td className="numeric whitespace-nowrap px-3 py-3 text-text-muted">{formatDateTr(r.entry_date)}</td>
      <td className="max-w-[22rem] px-3 py-3">
        <p className="font-semibold text-text">{r.title}</p>
        <PartyAndNote r={r} ctx={ctx} p={p} />
      </td>
      <td className="px-3 py-3"><CategoryCell r={r} ctx={ctx} p={p} /></td>
      <td className="px-3 py-3"><AccountCell r={r} p={p} /></td>
      <td className="numeric whitespace-nowrap px-3 py-3 text-right text-xs text-text-muted" title={vat.text === "—" ? "KDV bilgisi yok" : undefined}>
        {vat.text}
        {vat.sub ? <span className="block text-text-faint">{vat.sub}</span> : null}
      </td>
      <td className="numeric whitespace-nowrap px-3 py-3 text-right text-xs text-text-muted">{r.withholding_amount !== null ? formatAccountMoney(r.withholding_amount, r.currency) : "—"}</td>
      <td className="px-3 py-3 text-right"><Amount r={r} /></td>
      <td className="px-3 py-3"><RowActions r={r} ctx={ctx} p={p} /></td>
    </tr>
  );
}

function LedgerCard({ row: r, ctx, selectable }: { row: LedgerRow; ctx: RowCtx; selectable: boolean }) {
  const p = rowPerms(r, ctx);
  const vat = vatText(r);
  return (
    <MobileCard>
      <div data-ledger-row="" tabIndex={-1} className="outline-none">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            {selectable ? <BulkRowCheckbox id={r.id} label={r.title} /> : null}
            <div className="min-w-0">
              <p className="break-words font-semibold text-text">{r.title}</p>
              <p className="numeric mt-0.5 text-xs text-text-muted">{formatDateTr(r.entry_date)}</p>
            </div>
          </div>
          <p className="shrink-0 text-right"><Amount r={r} /></p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <CategoryCell r={r} ctx={ctx} p={p} />
          <AccountCell r={r} p={p} />
          {vat.text !== "—" ? <span className="numeric text-xs text-text-muted">KDV {vat.text}{vat.sub ? ` (${vat.sub})` : ""}</span> : null}
          {r.withholding_amount !== null ? <span className="numeric text-xs text-text-muted">Stopaj {formatAccountMoney(r.withholding_amount, r.currency)}</span> : null}
        </div>
        <PartyAndNote r={r} ctx={ctx} p={p} />
        <div className="mt-2 flex justify-end border-t border-line pt-2 empty:hidden">
          <RowActions r={r} ctx={ctx} p={p} />
        </div>
      </div>
    </MobileCard>
  );
}

function LegacyCallout({ count, href, active }: { count: number; href: string; active: boolean }) {
  return (
    <section aria-label="Hesapsız eski giderler" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-warning/30 bg-surface-warning-soft px-4 py-3 text-sm">
      <Inbox className="h-4 w-4 shrink-0 text-warning-strong" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-text">
        <strong className="numeric">{count}</strong> eski gider henüz bir hesaba bağlı değil. Bakiyeler bozulmasın diye ayrı listelenir;
        seçip <strong>Hesaba taşı</strong> ile hangi kasadan ya da bankadan ödendiğini işaretleyin.
      </p>
      {active ? null : (
        <Link href={href} className="focus-ring inline-flex min-h-9 items-center rounded-[var(--radius-control)] px-2 text-xs font-semibold text-accent-text hover:underline touch:min-h-11">
          Yalnız bunları göster
        </Link>
      )}
    </section>
  );
}

// ===========================================================================
// "Eski giderler" görünümü: gider kayıtlarının kendisi (portföy, portal, tekrar, fiş dosyası düzenleme)
// ===========================================================================

async function LegacyExpensesView({
  supabase,
  tenantId,
  params,
  canCreate,
  canEdit,
  canDelete,
}: {
  supabase: SupabaseClient;
  tenantId: string;
  params: Record<string, string | undefined>;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const from = isoDateParam(params.from);
  const to = isoDateParam(params.to);
  const portfoy = uuidParam(params.portfoy);
  const kategori = (params.kategori ?? "").trim().slice(0, 80);
  const [expenses, defs, financeProbe] = await Promise.all([
    listExpenses(undefined, { from: from || undefined, to: to || undefined, propertyId: portfoy || undefined, category: kategori || undefined }, 300),
    getDefinitionsOrDefault("expense_category"),
    supabase.from("expense_budgets").select("id", { count: "exact", head: true }),
  ]);
  const categories = defs.map((c) => ({ value: c.value, label: c.label }));
  const receipts = tenantId
    ? await loadExpenseReceipts(supabase, tenantId, expenses.map((e) => e.id as string))
    : { available: false, byExpense: new Map<string, ExpenseReceiptFile>() };
  const receiptUploads = receipts.available && (canCreate || canEdit);
  const rows = expenses.map((e) => {
    const prop = Array.isArray(e.property) ? e.property[0] : e.property;
    const file = receipts.byExpense.get(e.id as string) ?? null;
    return {
      id: e.id,
      title: e.title,
      amount: Number(e.amount),
      category: e.category,
      expense_date: e.expense_date,
      notes: e.notes,
      property_id: (e.property_id as string | null) ?? null,
      property_label: prop ? (prop.property_code ?? prop.title ?? null) : null,
      receipt_url: (e.receipt_url as string | null) ?? null,
      recurrence: (e.recurrence as string | null | undefined) ?? null,
      portal_key: (e.portal_key as string | null | undefined) ?? null,
      receipt_file: file ? { id: file.id, name: file.fileName, type: file.fileType } : null,
    };
  });
  const views: ViewOption[] = [
    { value: "defter", label: "Defter", icon: BookOpen, href: `${FINANCE_BASE}?sekme=hareketler` },
    { value: "eski-giderler", label: "Eski giderler", icon: Archive, href: `${FINANCE_BASE}?sekme=hareketler&gorunum=eski-giderler` },
  ];
  const chips = [kategori, from, to, portfoy].filter(Boolean);

  return (
    <div className="grid gap-4">
      <div className="surface-card flex flex-wrap items-end gap-3 rounded-[var(--radius-panel)] p-3">
        <ViewSwitcher options={views} active="eski-giderler" />
        <form method="get" action={FINANCE_BASE} className="flex flex-1 flex-wrap items-end gap-2">
          <input type="hidden" name="sekme" value="hareketler" />
          <input type="hidden" name="gorunum" value="eski-giderler" />
          {portfoy ? <input type="hidden" name="portfoy" value={portfoy} /> : null}
          <FilterSelect name="kategori" label="Kategori" value={kategori} options={[{ value: "", label: "Tümü" }, ...categories]} className="min-w-40" />
          <FilterDate name="from" label="Başlangıç" value={from} />
          <FilterDate name="to" label="Bitiş" value={to} />
          <Button type="submit" variant="outline" size="sm">Uygula</Button>
          {chips.length > 0 ? (
            <Link href={`${FINANCE_BASE}?sekme=hareketler&gorunum=eski-giderler`} className="inline-flex min-h-8 items-center text-xs font-semibold text-text-muted hover:text-text touch:min-h-11">
              Filtreleri temizle
            </Link>
          ) : null}
        </form>
        <p role="status" className="numeric text-xs text-text-muted">{rows.length} gider kaydı{rows.length >= 300 ? " (en yeni 300)" : ""}</p>
      </div>
      <p className="text-xs text-text-muted">
        Gider kayıtlarının kendisi: portföy, portal, tekrar ve fiş dosyası burada düzenlenir. Yeni gider için sayfanın üstündeki <strong>Yeni kayıt</strong> penceresini
        kullanın (gelişmiş alanlar: portföy, KDV, stopaj, belge). Hesaba bağlı olmayanlar Defter&apos;de &quot;Hesapsız&quot; görünür.
      </p>
      {rows.length === 0 ? (
        <EmptyState icon={Archive} title="Gider kaydı yok" description="Bu filtreyle eşleşen eski gider kaydı bulunmuyor." tone="amber" action={{ href: `${FINANCE_BASE}?sekme=hareketler`, label: "Deftere dön" }} />
      ) : (
        <ExpensesTable expenses={rows} categories={categories} canEdit={canEdit} canDelete={canDelete} receiptUploads={receiptUploads && canEdit} financeFields={!financeProbe.error && canEdit} />
      )}
    </div>
  );
}

// ===========================================================================
// Kasam (scope="personal") ve şema yokken yedek: kasa hareketleri (değişmedi)
// ===========================================================================

/**
 * Filtre kontratı: hesap, tür, kategori, tarih aralığı, arama ve sayfa URL'de (?hesap= &tur= &kategori= &from= &to= &q= &sayfa=)
 * tutulur; sunucu sorgusuna aynen yansır, gerçek sayfalama. Kişisel hesap hareketlerini yalnız sahibi, maaş hareketlerini
 * ofis hesaplarında yalnız owner/gm görür (RLS).
 */
async function CashEntriesList({
  supabase,
  params,
  accounts,
  today,
  canCreate,
  canEdit,
  canDelete,
  canSalary,
  nav = FINANCE_NAV,
  scope,
  limitToAccounts = false,
}: CashEntriesProps) {
  const personalOnly = scope === "personal" || limitToAccounts;
  const hrefWith = (p: ParamRecord, patch: Record<string, string>) => buildHref(nav.base, mergeParams({ ...p, sekme: nav.sekme }, patch));
  const val = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const hesap = uuidParam(params.hesap);
  const accountId = accounts.some((a) => a.id === hesap) ? hesap : "";
  const turRaw = val("tur");
  const tur = turRaw === "gelir" || turRaw === "gider" || turRaw === "transfer" ? turRaw : "";
  const categoryRaw = val("kategori");
  const kategori = (CASH_CATEGORIES.some((c) => c.value === categoryRaw) || categoryRaw === OWNER_PAYOUT_CATEGORY) && (canSalary || categoryRaw !== SALARY_CATEGORY) ? categoryRaw : "";
  const from = isoDateParam(params.from);
  const to = isoDateParam(params.to);
  const q = val("q").trim().slice(0, 60);
  // ?mutabik=hayir: hesap kartındaki "mutabık olmayan hareket" sayısından gelir (ekstre kapsam penceresi from/to ile birlikte).
  const mutabikYok = val("mutabik") === "hayir";
  const page = parsePage(params.sayfa);

  const [{ entries, total }, summary] = await Promise.all([
    loadCashEntries(supabase, { accountId: accountId || null, accountIds: personalOnly && !accountId ? accounts.map((a) => a.id) : null, tur: tur || null, category: kategori || null, from: from || null, to: to || null, q: q || null, unreconciled: mutabikYok, page }),
    loadCashSummary(supabase, { from: from || null, to: to || null }),
  ]);

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const inScope = summary.filter((s) => accountById.has(s.account_id)).filter((s) => !accountId || s.account_id === accountId).filter((s) => !kategori || s.category === kategori);
  const sumOf = (dir: "in" | "out") =>
    sumByCurrency(inScope.filter((s) => s.direction === dir).map((s) => ({ currency: accountById.get(s.account_id)?.currency ?? "TRY", amount: s.total })));
  const incomes = sumOf("in");
  const expenses = sumOf("out");
  const money = (rows: { currency: string; amount: number }[]) => (rows.length === 0 ? formatAccountMoney(0, "TRY") : rows.map((r) => formatAccountMoney(r.amount, r.currency)).join(" · "));
  const net = sumByCurrency([...incomes, ...expenses.map((e) => ({ currency: e.currency, amount: -e.amount }))]);

  const kpis: KpiItem[] = [
    { label: "Gelir", value: money(incomes), icon: <ArrowDownCircle />, tone: "success", href: hrefWith(params, { tur: "gelir", sayfa: "" }), hint: from || to ? "seçili aralık" : "tüm zamanlar" },
    { label: "Gider", value: money(expenses), icon: <ArrowUpCircle />, tone: "warning", href: hrefWith(params, { tur: "gider", sayfa: "" }), hint: from || to ? "seçili aralık" : "tüm zamanlar" },
    { label: "Net", value: money(net), icon: <Scale />, tone: "info", href: hrefWith(params, { tur: "", sayfa: "" }), hint: "gelir - gider (transfer hariç)" },
  ];

  const pathParams: ParamRecord = { ...params, sekme: nav.sekme };
  const chips = buildActiveChips(nav.base, pathParams, [
    { key: "hesap", label: "Hesap", format: () => accountById.get(accountId)?.name ?? "Seçili hesap" },
    { key: "tur", label: "Tür", format: (v) => TUR_OPTIONS.find((o) => o.value === v)?.label ?? v },
    { key: "kategori", label: "Kategori", format: (v) => cashCategoryLabel(v) },
    { key: "from", label: "Başlangıç", format: (v) => formatDateTr(v) },
    { key: "to", label: "Bitiş", format: (v) => formatDateTr(v) },
    { key: "q", label: "Arama" },
    { key: "mutabik", label: "Mutabakat", format: () => "Mutabık değil" },
  ]).filter((c) => (c.key === "hesap" ? Boolean(accountId) : c.key === "tur" ? Boolean(tur) : c.key === "kategori" ? Boolean(kategori) : c.key === "mutabik" ? mutabikYok : true));

  const w = pageWindow(page, total, ENTRY_PAGE_SIZE, entries.length);
  const categoryOptions = [
    { value: "", label: "Tümü" },
    ...CASH_CATEGORIES.filter((c) => canSalary || c.value !== SALARY_CATEGORY).map((c) => ({ value: c.value, label: c.label })),
    { value: OWNER_PAYOUT_CATEGORY, label: cashCategoryLabel(OWNER_PAYOUT_CATEGORY) },
  ];

  return (
    <div className="grid gap-4">
      <KpiStrip items={kpis} />

      <ListToolbar
        pathname={nav.base}
        params={pathParams}
        searchPlaceholder="Açıklama veya karşı taraf ara…"
        searchLabel="Hareketlerde ara"
        panelParamKeys={["hesap", "tur", "kategori", "mutabik", "from", "to"]}
        panel={
          <FilterGrid>
            <FilterSelect name="hesap" label="Hesap" value={accountId} options={[{ value: "", label: "Tüm hesaplar" }, ...accounts.map((a) => ({ value: a.id, label: `${a.name}${a.owner_scope === "user" ? " (kişisel)" : ""}` }))]} />
            <FilterSelect name="tur" label="Tür" value={tur} options={TUR_OPTIONS} />
            <FilterSelect name="kategori" label="Ne için" value={kategori} options={categoryOptions} />
            <FilterSelect name="mutabik" label="Mutabakat" value={mutabikYok ? "hayir" : ""} options={[{ value: "", label: "Tümü" }, { value: "hayir", label: "Mutabık değil" }]} />
            <FilterDate name="from" label="Başlangıç" value={from} />
            <FilterDate name="to" label="Bitiş" value={to} />
          </FilterGrid>
        }
        chips={chips}
        resultCount={total}
        resultNoun="hareket"
      />

      {entries.length === 0 ? (
        chips.length > 0 ? (
          <div className="grid place-items-center rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
            <h2 className="font-display text-lg font-bold text-text">Bu filtreyle hareket yok</h2>
            <Link href={`${nav.base}?sekme=${nav.sekme}`} className="mt-2 text-sm font-semibold text-accent-text hover:underline">
              Filtreleri temizle
            </Link>
          </div>
        ) : (
          <EmptyState
            icon={ArrowLeftRight}
            title="Henüz hareket yok"
            description={accounts.length === 0 ? "Önce bir hesap açın (ör. ofis kasası), sonra gelir ve giderlerinizi ekleyin." : "Sayfanın üstündeki Gelir ekle veya Gider ekle düğmesiyle ilk hareketi girin."}
            tone="amber"
            action={accounts.length === 0 ? { href: `${nav.base}?sekme=${nav.base === FINANCE_BASE ? "kasa-banka" : nav.sekme}`, label: "İlk hesabı aç" } : undefined}
          />
        )
      ) : (
        <>
        <MobileCardList aria-label="Para hareketleri">
          {entries.map((e) => (
            <EntryCard key={e.id} entry={e} account={accountById.get(e.account_id)} nav={nav} today={today} canEdit={canEdit} canDelete={canDelete} canSalary={canSalary} />
          ))}
        </MobileCardList>
        <div className="hidden overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface md:block">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Para hareketleri</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">
                <th scope="col" className="px-4 py-2.5">Tarih</th>
                <th scope="col" className="px-4 py-2.5">Ne için</th>
                <th scope="col" className="px-4 py-2.5">Hesap</th>
                <th scope="col" className="px-4 py-2.5 text-right">Tutar</th>
                <th scope="col" className="px-4 py-2.5 text-right"><span className="sr-only">İşlemler</span></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <EntryRow key={e.id} entry={e} account={accountById.get(e.account_id)} nav={nav} today={today} canEdit={canEdit} canDelete={canDelete} canSalary={canSalary} />
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      <ListPager pathname={nav.base} params={pathParams} window={w} total={total} />
      {!canCreate && accounts.length > 0 ? <p className="text-xs text-text-faint">Bu ekranda yalnız görüntüleme yetkiniz var.</p> : null}
    </div>
  );
}

type EntryProps = {
  nav: EntriesNav;
  entry: CashEntry;
  account: AccountWithBalance | undefined;
  today: string;
  canEdit: boolean;
  canDelete: boolean;
  canSalary: boolean;
};

function entryPerms(e: CashEntry, account: AccountWithBalance | undefined, canEdit: boolean, canDelete: boolean) {
  const personal = account?.owner_scope === "user";
  const manual = e.source_type === "manual" && (e.kind === "income" || e.kind === "expense");
  // Kişisel hesabın hareketini yalnız sahibi görür: düzenleme/iptal onda da açıktır (RPC doğrular).
  return {
    personal,
    isTransfer: e.kind === "transfer",
    mayEdit: manual && (personal || canEdit),
    mayVoid: personal || canDelete,
    // Benimsenmiş eski giderin hareketi (expense_id dolu, created_expense=false): iptal gideri silmez; geri al yeni gider yazıp
    // çift saydırmasın diye bu listede gösterilmez (yeniden taşıma Muhasebe > Hareketler'de).
    undo:
      manual && e.category && isCashCategory(e.category, e.direction) && (!e.expense_id || e.created_expense === true)
        ? { accountId: e.account_id, hadExpense: e.created_expense === true }
        : null,
  };
}

function EntryRow({ entry: e, account, today, canEdit, canDelete, canSalary, nav }: EntryProps) {
  const { personal, isTransfer, mayEdit, mayVoid, undo } = entryPerms(e, account, canEdit, canDelete);
  const sign = e.direction === "in" ? "+" : "−";
  return (
    <tr className="border-b border-line last:border-b-0 hover:bg-surface-hover/40">
      <td className="numeric whitespace-nowrap px-4 py-3 text-text-muted">{formatDateTr(e.entry_date)}</td>
      <td className="px-4 py-3">
        <p className="font-semibold text-text">{e.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
          <span>{cashCategoryLabel(e.category)}</span>
          {e.counterparty ? <span>· {e.counterparty}</span> : null}
          {e.source_type !== "manual" ? <StatusPill tone="info" dot={false}>{SOURCE_LABEL[e.source_type] ?? e.source_type}</StatusPill> : null}
          {e.document_url ? (
            <a href={e.document_url} target="_blank" rel="noreferrer noopener" className="font-semibold text-accent-text hover:underline">Belge</a>
          ) : null}
        </p>
      </td>
      <td className="px-4 py-3">
        {account ? (
          <Link href={`${nav.base}?sekme=${nav.sekme}&hesap=${account.id}`} className="font-medium text-accent-text hover:underline">
            {account.name}
          </Link>
        ) : (
          <span className="text-text-faint">—</span>
        )}
        {personal ? <StatusPill tone="neutral" dot={false} className="ml-1.5">Kişisel</StatusPill> : null}
      </td>
      <td className={`numeric whitespace-nowrap px-4 py-3 text-right font-bold ${isTransfer ? "text-text" : e.direction === "in" ? "text-success-strong" : "text-danger-strong"}`}>
        {sign}
        {formatAccountMoney(e.amount, e.currency)}
      </td>
      <td className="px-4 py-3">
        {mayEdit || mayVoid ? (
          <EntryRowActions
            entry={{ id: e.id, direction: e.direction, amount: e.amount, date: e.entry_date, category: e.category, title: e.title, counterparty: e.counterparty, note: e.note }}
            today={today}
            canEdit={mayEdit}
            canVoid={mayVoid}
            canSalary={canSalary}
            isTransfer={isTransfer}
            undo={undo}
          />
        ) : null}
      </td>
    </tr>
  );
}

function EntryCard({ entry: e, account, today, canEdit, canDelete, canSalary, nav }: EntryProps) {
  const { personal, isTransfer, mayEdit, mayVoid, undo } = entryPerms(e, account, canEdit, canDelete);
  return (
    <MobileCard>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-semibold text-text">{e.title}</p>
          <p className="numeric mt-0.5 text-xs text-text-muted">{formatDateTr(e.entry_date)} · {cashCategoryLabel(e.category)}</p>
        </div>
        <p className={`numeric shrink-0 text-right font-bold ${isTransfer ? "text-text" : e.direction === "in" ? "text-success-strong" : "text-danger-strong"}`}>
          {e.direction === "in" ? "+" : "−"}
          {formatAccountMoney(e.amount, e.currency)}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
        {account ? (
          <Link href={`${nav.base}?sekme=${nav.sekme}&hesap=${account.id}`} className="font-medium text-accent-text hover:underline">{account.name}</Link>
        ) : null}
        {personal ? <StatusPill tone="neutral" dot={false}>Kişisel</StatusPill> : null}
        {e.counterparty ? <span>· {e.counterparty}</span> : null}
        {e.source_type !== "manual" ? <StatusPill tone="info" dot={false}>{SOURCE_LABEL[e.source_type] ?? e.source_type}</StatusPill> : null}
        {e.document_url ? (
          <a href={e.document_url} target="_blank" rel="noreferrer noopener" className="font-semibold text-accent-text hover:underline">Belge</a>
        ) : null}
      </div>
      {mayEdit || mayVoid ? (
        <div className="mt-2 flex justify-end border-t border-line pt-2">
          <EntryRowActions
            entry={{ id: e.id, direction: e.direction, amount: e.amount, date: e.entry_date, category: e.category, title: e.title, counterparty: e.counterparty, note: e.note }}
            today={today}
            canEdit={mayEdit}
            canVoid={mayVoid}
            canSalary={canSalary}
            isTransfer={isTransfer}
            undo={undo}
          />
        </div>
      ) : null}
    </MobileCard>
  );
}
