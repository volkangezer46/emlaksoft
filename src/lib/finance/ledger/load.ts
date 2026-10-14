import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchLatestRates, type FxClient } from "@/lib/fx";
import { now, trDayKey } from "@/lib/clock";
import { CASH_CATEGORIES } from "@/lib/finance/cash/categories";
import { isMissingCashSchema } from "@/lib/finance/cash/load";
import {
  AGING_BUCKETS,
  DEFAULT_FINANCE_SETTINGS,
  isFinanceTabId,
  type AgingBucket,
  type AgingBucketKey,
  type Attachment,
  type AttachmentFilter,
  type Budget,
  type CurrencyCode,
  type Direction,
  type FinanceCategory,
  type FinanceRule,
  type FinanceSettings,
  type FinanceTabId,
  type ForecastPoint,
  type LedgerFilter,
  type LedgerPage,
  type LedgerRow,
  type OcrStatus,
  type OpenItem,
  type OpenItemDirection,
  type OpenItemSource,
  type OpenItemStatus,
  type OpenItemView,
  type OverviewSummary,
  type PartyBalance,
  type PartyKind,
  type PartyStatementDocType,
  type PartyStatementRow,
  type PeriodLock,
  type PnlRow,
  type RuleMode,
  type SavedView,
  type VatRow,
} from "./types";

/**
 * Finans v2 sunucu okuyucuları (FN1 sözleşmesi). Kullanıcı oturumu + RLS; her işlev TEK RPC ya da TEK select yapar,
 * sekmeler bunları `Promise.all` ile paralel çağırır. Şema yoksa (migration bekliyor) ya da okuma hatasında boş/null döner
 * (sayfa çökmez, sekme boş durum gösterir). Kiracı süzgeci RLS + RPC içindeki current_active_tenant_id ile sağlanır.
 */

type DbError = { code?: string | null; message?: string | null } | null | undefined;
type Row = Record<string, unknown>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LEDGER_PAGE_SIZE = 50;

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : num(v));
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const day = (v: unknown): string => str(v).slice(0, 10);
const currency = (v: unknown): CurrencyCode => (v === "USD" || v === "EUR" ? v : "TRY");

function logError(where: string, error: DbError) {
  if (!isMissingCashSchema(error)) console.error(`finance-ledger:${where}`, { code: error?.code });
}

/** PostgREST `or(...)`/`ilike` için güvenli arama metni (virgül, parantez, joker ve ters bölü atılır). */
export function sanitizeSearch(q: string | undefined | null): string {
  return (q ?? "").replace(/[,()*%\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

// ---------------------------------------------------------------------------
// Kur
// ---------------------------------------------------------------------------
/** RPC'lerin `p_rates` girdisi: {"USD": 41.2, "EUR": 47.9}. Kur yoksa null (yalnız TL toplanır). */
export const fxRatesForFinance = cache(async (): Promise<{ USD?: number; EUR?: number } | null> => {
  const supabase = await createClient();
  const rates = await fetchLatestRates(supabase as unknown as FxClient);
  if (!rates) return null;
  const out: { USD?: number; EUR?: number } = {};
  if (rates.usd) out.USD = rates.usd;
  if (rates.eur) out.EUR = rates.eur;
  return Object.keys(out).length > 0 ? out : null;
});

// ---------------------------------------------------------------------------
// Pano ve tahmin
// ---------------------------------------------------------------------------
export async function loadOverview(from: string, to: string): Promise<OverviewSummary | null> {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return null;
  const [supabase, rates] = await Promise.all([createClient(), fxRatesForFinance()]);
  const { data, error } = await supabase.rpc("finance_overview", { p_from: from, p_to: to, p_rates: rates });
  if (error || !data || typeof data !== "object") {
    if (error) logError("overview", error);
    return null;
  }
  const d = data as Row;
  const byCurrency = Array.isArray(d.by_currency) ? (d.by_currency as Row[]) : [];
  return {
    from: day(d.from),
    to: day(d.to),
    cashTotalTry: num(d.cash_total_try),
    byCurrency: byCurrency.map((r) => ({ currency: currency(r.currency), amount: num(r.amount) })),
    fxMissing: d.fx_missing === true,
    inTotal: num(d.in_total),
    outTotal: num(d.out_total),
    net: num(d.net),
    receivableOpen: num(d.receivable_open),
    payableOpen: num(d.payable_open),
    overdueCount: num(d.overdue_count),
    reviewCount: num(d.review_count),
    legacyUnadoptedCount: num(d.legacy_unadopted_count),
    vatPayableMonth: num(d.vat_payable_month),
  };
}

export async function loadForecast(days: number): Promise<ForecastPoint[]> {
  const d = Math.min(366, Math.max(1, Math.round(days) || 30));
  const [supabase, rates] = await Promise.all([createClient(), fxRatesForFinance()]);
  const { data, error } = await supabase.rpc("finance_cashflow_forecast", { p_days: d, p_rates: rates });
  if (error) {
    logError("forecast", error);
    return [];
  }
  return ((data ?? []) as Row[]).map((r) => ({
    date: day(r.d),
    inflow: num(r.inflow),
    outflow: num(r.outflow),
    balance: num(r.balance),
    isActual: r.is_actual === true,
  }));
}

function mapOpenItemView(r: Row): OpenItemView {
  return {
    key: str(r.key),
    source: str(r.source) as OpenItemSource,
    sourceId: str(r.source_id),
    direction: (r.direction === "payable" ? "payable" : "receivable") as OpenItemDirection,
    partyId: strOrNull(r.party_id),
    partyLabel: str(r.party_label),
    title: str(r.title),
    category: strOrNull(r.category),
    amountOpen: num(r.amount_open),
    currency: currency(r.currency),
    dueDate: day(r.due_date),
    href: str(r.href),
  };
}

const OPEN_VIEW_COLS = "key, source, source_id, direction, party_id, party_label, title, category, amount_open, currency, due_date, href";

/** Önümüzdeki `days` gün içinde vadesi gelen (ve geçmiş) açık kalemler; tüm kaynaklar (finance_open_items_v). */
export async function loadUpcoming(days: number): Promise<OpenItemView[]> {
  const until = trDayKey(now() + Math.min(366, Math.max(0, Math.round(days) || 0)) * 86_400_000);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("finance_open_items_v")
    .select(OPEN_VIEW_COLS)
    .gt("amount_open", 0)
    .lte("due_date", until)
    .order("due_date", { ascending: true })
    .limit(50);
  if (error) {
    logError("upcoming", error);
    return [];
  }
  return ((data ?? []) as Row[]).map(mapOpenItemView);
}

// ---------------------------------------------------------------------------
// Cari
// ---------------------------------------------------------------------------
const PARTY_KIND_SET = new Set<PartyKind>(["musteri", "malik", "kiraci", "tedarikci", "danisman", "diger"]);

export async function loadParties(kind?: PartyKind | null, q?: string | null): Promise<PartyBalance[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_party_balances", {
    p_kind: kind && PARTY_KIND_SET.has(kind) ? kind : null,
    p_q: sanitizeSearch(q) || null,
  });
  if (error) {
    logError("parties", error);
    return [];
  }
  return ((data ?? []) as Row[]).map((r) => ({
    partyId: str(r.party_id),
    name: str(r.name),
    kind: (PARTY_KIND_SET.has(r.kind as PartyKind) ? r.kind : "diger") as PartyKind,
    receivableOpen: num(r.receivable_open),
    payableOpen: num(r.payable_open),
    paidIn: num(r.paid_in),
    paidOut: num(r.paid_out),
    balance: num(r.balance),
    overdueAmount: num(r.overdue_amount),
    lastActivity: r.last_activity ? day(r.last_activity) : null,
  }));
}

export async function loadPartyStatement(id: string, from?: string | null, to?: string | null): Promise<PartyStatementRow[] | null> {
  if (!UUID.test(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_party_statement", {
    p_party_id: id,
    p_from: from && ISO_DATE.test(from) ? from : null,
    p_to: to && ISO_DATE.test(to) ? to : null,
  });
  if (error) {
    logError("party-statement", error);
    return null;
  }
  return ((data ?? []) as Row[]).map((r) => ({
    date: r.d ? day(r.d) : null,
    docType: str(r.doc_type) as PartyStatementDocType,
    refId: strOrNull(r.ref_id),
    title: str(r.title),
    debit: num(r.debit),
    credit: num(r.credit),
    runningBalance: num(r.running_balance),
    href: strOrNull(r.href),
  }));
}

// ---------------------------------------------------------------------------
// Açık kalem
// ---------------------------------------------------------------------------
export type OpenItemsFilter = {
  direction?: OpenItemDirection;
  partyId?: string;
  source?: OpenItemSource;
  /** true: yalnız vadesi geçmiş. */
  overdue?: boolean;
  limit?: number;
};

/** Açık kalemler (tüm kaynaklar, yalnız açık tutarı olanlar), vadeye göre. */
export async function loadOpenItems(filter: OpenItemsFilter = {}): Promise<OpenItemView[]> {
  const supabase = await createClient();
  let query = supabase.from("finance_open_items_v").select(OPEN_VIEW_COLS).gt("amount_open", 0);
  if (filter.direction === "receivable" || filter.direction === "payable") query = query.eq("direction", filter.direction);
  if (filter.partyId && UUID.test(filter.partyId)) query = query.eq("party_id", filter.partyId);
  if (filter.source) query = query.eq("source", filter.source);
  if (filter.overdue) query = query.lt("due_date", trDayKey(now()));
  const { data, error } = await query.order("due_date", { ascending: true }).limit(Math.min(500, Math.max(1, filter.limit ?? 200)));
  if (error) {
    logError("open-items", error);
    return [];
  }
  return ((data ?? []) as Row[]).map(mapOpenItemView);
}

export type OpenItemRecordFilter = { partyId?: string; status?: OpenItemStatus | "active"; direction?: OpenItemDirection; limit?: number };

/** Elle açılan kalem kayıtları (ödenen/iptal dahil; ayrıntı ve ekstre ekranı için). */
export async function loadOpenItemRecords(filter: OpenItemRecordFilter = {}): Promise<OpenItem[]> {
  const supabase = await createClient();
  let query = supabase
    .from("finance_open_items")
    .select(
      "id, direction, party_id, title, category, amount, currency, vat_rate, vat_amount, withholding_amount, issue_date, due_date, paid_amount, status, source_type, source_id, property_id, note, created_at, cancelled_at, cancel_reason, is_sample",
    );
  if (filter.partyId && UUID.test(filter.partyId)) query = query.eq("party_id", filter.partyId);
  if (filter.direction) query = query.eq("direction", filter.direction);
  if (filter.status === "active") query = query.in("status", ["open", "partial"]);
  else if (filter.status) query = query.eq("status", filter.status);
  const { data, error } = await query.order("due_date", { ascending: true }).limit(Math.min(500, Math.max(1, filter.limit ?? 200)));
  if (error) {
    logError("open-item-records", error);
    return [];
  }
  return ((data ?? []) as Row[]).map((r) => ({
    id: str(r.id),
    direction: (r.direction === "payable" ? "payable" : "receivable") as OpenItemDirection,
    partyId: strOrNull(r.party_id),
    title: str(r.title),
    category: strOrNull(r.category),
    amount: num(r.amount),
    currency: currency(r.currency),
    vatRate: numOrNull(r.vat_rate),
    vatAmount: numOrNull(r.vat_amount),
    withholdingAmount: numOrNull(r.withholding_amount),
    issueDate: day(r.issue_date),
    dueDate: day(r.due_date),
    paidAmount: num(r.paid_amount),
    status: str(r.status) as OpenItemStatus,
    sourceType: strOrNull(r.source_type),
    sourceId: strOrNull(r.source_id),
    propertyId: strOrNull(r.property_id),
    note: strOrNull(r.note),
    createdAt: str(r.created_at),
    cancelledAt: strOrNull(r.cancelled_at),
    cancelReason: strOrNull(r.cancel_reason),
    isSample: r.is_sample === true,
  }));
}

export async function loadAging(dir: OpenItemDirection): Promise<AgingBucket[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_aging", { p_direction: dir === "payable" ? "payable" : "receivable" });
  if (error) {
    logError("aging", error);
    return AGING_BUCKETS.map((bucket) => ({ bucket, count: 0, amount: 0 }));
  }
  const byKey = new Map(((data ?? []) as Row[]).map((r) => [str(r.bucket), r]));
  return AGING_BUCKETS.map((bucket: AgingBucketKey) => ({ bucket, count: num(byKey.get(bucket)?.cnt), amount: num(byKey.get(bucket)?.amount) }));
}

// ---------------------------------------------------------------------------
// Defter
// ---------------------------------------------------------------------------
const LEDGER_COLS =
  "id, origin, account_id, direction, amount, currency, entry_date, kind, category, title, counterparty, party_id, vat_rate, vat_amount, withholding_amount, property_id, open_item_id, source_type, source_id, expense_id, reconciled_at, voided_at, attachment_count, is_sample, note, created_at";

function mapLedgerRow(r: Row): LedgerRow {
  return {
    id: str(r.id),
    origin: r.origin === "legacy_expense" ? "legacy_expense" : "entry",
    accountId: strOrNull(r.account_id),
    direction: (r.direction === "in" ? "in" : "out") as Direction,
    amount: num(r.amount),
    currency: currency(r.currency),
    entryDate: day(r.entry_date),
    kind: (["income", "expense", "transfer", "adjust"].includes(str(r.kind)) ? r.kind : "expense") as LedgerRow["kind"],
    category: strOrNull(r.category),
    title: str(r.title),
    counterparty: strOrNull(r.counterparty),
    partyId: strOrNull(r.party_id),
    vatRate: numOrNull(r.vat_rate),
    vatAmount: numOrNull(r.vat_amount),
    withholdingAmount: numOrNull(r.withholding_amount),
    propertyId: strOrNull(r.property_id),
    openItemId: strOrNull(r.open_item_id),
    sourceType: str(r.source_type),
    sourceId: strOrNull(r.source_id),
    expenseId: strOrNull(r.expense_id),
    reconciledAt: strOrNull(r.reconciled_at),
    voidedAt: strOrNull(r.voided_at),
    attachmentCount: num(r.attachment_count),
    isSample: r.is_sample === true,
    note: strOrNull(r.note),
    createdAt: str(r.created_at),
  };
}

/** URL parametrelerinden (Hareketler sekmesi) defter süzgeci; geçersiz değer yok sayılır. */
export function ledgerFilterFromParams(params: Record<string, string | undefined>): LedgerFilter {
  const f: LedgerFilter = {};
  if (params.tur === "in" || params.tur === "out" || params.tur === "transfer") f.tur = params.tur;
  if (params.hesap && UUID.test(params.hesap)) f.hesap = params.hesap;
  if (params.kategori && /^[a-z0-9_]{1,40}$/.test(params.kategori)) f.kategori = params.kategori;
  if (params.cari && UUID.test(params.cari)) f.cari = params.cari;
  if (params.from && ISO_DATE.test(params.from)) f.from = params.from;
  if (params.to && ISO_DATE.test(params.to)) f.to = params.to;
  const q = sanitizeSearch(params.q);
  if (q) f.q = q;
  if (params.mutabik === "evet" || params.mutabik === "hayir") f.mutabik = params.mutabik;
  if (params.origin === "entry" || params.origin === "legacy_expense") f.origin = params.origin;
  if (params.iptal === "1") f.iptal = true;
  return f;
}

/** Birleşik defter sayfası (finance_ledger_v): sunucu süzgeci + gerçek sayfalama (1'den başlar). */
export async function loadLedgerPage(filter: LedgerFilter, page = 1): Promise<LedgerPage> {
  const p = Math.max(1, Math.min(10_000, Math.round(page) || 1));
  const from = (p - 1) * LEDGER_PAGE_SIZE;
  const supabase = await createClient();
  let query = supabase.from("finance_ledger_v").select(LEDGER_COLS, { count: "exact" });
  if (filter.tur === "transfer") query = query.eq("kind", "transfer");
  else if (filter.tur) query = query.eq("direction", filter.tur).neq("kind", "transfer");
  if (filter.hesap && UUID.test(filter.hesap)) query = query.eq("account_id", filter.hesap);
  if (filter.kategori) query = query.eq("category", filter.kategori);
  if (filter.cari && UUID.test(filter.cari)) query = query.eq("party_id", filter.cari);
  if (filter.from && ISO_DATE.test(filter.from)) query = query.gte("entry_date", filter.from);
  if (filter.to && ISO_DATE.test(filter.to)) query = query.lte("entry_date", filter.to);
  const q = sanitizeSearch(filter.q);
  if (q) query = query.or(`title.ilike.*${q}*,counterparty.ilike.*${q}*`);
  if (filter.mutabik === "evet") query = query.not("reconciled_at", "is", null);
  else if (filter.mutabik === "hayir") query = query.is("reconciled_at", null).eq("origin", "entry");
  if (filter.origin) query = query.eq("origin", filter.origin);
  if (!filter.iptal) query = query.is("voided_at", null);
  const { data, error, count } = await query
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, from + LEDGER_PAGE_SIZE - 1);
  if (error) {
    logError("ledger", error);
    return { rows: [], total: 0, page: p, pageSize: LEDGER_PAGE_SIZE };
  }
  return { rows: ((data ?? []) as Row[]).map(mapLedgerRow), total: count ?? 0, page: p, pageSize: LEDGER_PAGE_SIZE };
}

// ---------------------------------------------------------------------------
// Kategori, kural
// ---------------------------------------------------------------------------
/** Sistem (kod: CASH_CATEGORIES) + ofis kategorileri birleşik; arşivlenen ofis kategorileri dışarıda. */
export async function loadCategories(direction?: Direction | null): Promise<FinanceCategory[]> {
  const system: FinanceCategory[] = CASH_CATEGORIES.filter((c) => !direction || c.direction === direction).map((c, i) => ({
    id: c.value,
    key: c.value,
    label: c.label,
    direction: c.direction,
    source: "system",
    icon: null,
    defaultVatRate: null,
    defaultWithholdingRate: c.value === "kira" ? 20 : null,
    expenseCategory: c.expenseCategory ?? null,
    sort: i,
    archived: false,
  }));
  const supabase = await createClient();
  let query = supabase
    .from("finance_categories")
    .select("id, direction, key, label, icon, default_vat_rate, default_withholding_rate, expense_category, sort, archived_at")
    .is("archived_at", null);
  if (direction) query = query.eq("direction", direction);
  const { data, error } = await query.order("sort", { ascending: true }).order("label", { ascending: true }).limit(500);
  if (error) {
    logError("categories", error);
    return system;
  }
  const custom: FinanceCategory[] = ((data ?? []) as Row[]).map((r) => ({
    id: str(r.id),
    key: str(r.key),
    label: str(r.label),
    direction: (r.direction === "in" ? "in" : "out") as Direction,
    source: "custom",
    icon: strOrNull(r.icon),
    defaultVatRate: numOrNull(r.default_vat_rate),
    defaultWithholdingRate: numOrNull(r.default_withholding_rate),
    expenseCategory: strOrNull(r.expense_category),
    sort: system.length + num(r.sort),
    archived: Boolean(r.archived_at),
  }));
  return [...system, ...custom];
}

export async function loadRules(): Promise<FinanceRule[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("finance_rules")
    .select("id, direction, match_text, match_iban_last4, amount_min, amount_max, set_category, set_party_id, mode, active, hits, created_at")
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) {
    logError("rules", error);
    return [];
  }
  return ((data ?? []) as Row[]).map((r) => ({
    id: str(r.id),
    direction: r.direction === "in" || r.direction === "out" ? (r.direction as Direction) : null,
    matchText: strOrNull(r.match_text),
    matchIbanLast4: strOrNull(r.match_iban_last4),
    amountMin: numOrNull(r.amount_min),
    amountMax: numOrNull(r.amount_max),
    setCategory: str(r.set_category),
    setPartyId: strOrNull(r.set_party_id),
    mode: (r.mode === "auto" ? "auto" : "suggest") as RuleMode,
    active: r.active !== false,
    hits: num(r.hits),
    createdAt: str(r.created_at),
  }));
}

// ---------------------------------------------------------------------------
// Bütçe, vergi, kâr/zarar
// ---------------------------------------------------------------------------
/** `month`: YYYY-MM ya da YYYY-MM-DD (ayın herhangi bir günü). */
export async function loadBudgetVsActual(month: string): Promise<Budget[]> {
  const m = /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : month;
  if (!ISO_DATE.test(m)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_budget_vs_actual", { p_month: m });
  if (error) {
    logError("budget", error);
    return [];
  }
  return ((data ?? []) as Row[]).map((r) => ({
    direction: (r.direction === "in" ? "in" : "out") as Direction,
    category: str(r.category),
    budget: num(r.budget),
    actual: num(r.actual),
  }));
}

export async function loadVatSummary(from: string, to: string): Promise<VatRow[]> {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_vat_summary", { p_from: from, p_to: to });
  if (error) {
    logError("vat", error);
    return [];
  }
  return ((data ?? []) as Row[]).map((r) => ({
    month: day(r.month),
    outputVat: num(r.output_vat),
    inputVat: num(r.input_vat),
    payable: num(r.payable),
    withholdingPaid: num(r.withholding_paid),
    withholdingCollected: num(r.withholding_collected),
  }));
}

function numberRecord(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v as Row).map(([k, x]) => [k, num(x)]));
}

export async function loadPnl(from: string, to: string): Promise<PnlRow[]> {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_pnl", { p_from: from, p_to: to });
  if (error) {
    logError("pnl", error);
    return [];
  }
  return ((data ?? []) as Row[]).map((r) => ({
    month: day(r.month),
    income: num(r.income),
    expense: num(r.expense),
    net: num(r.net),
    incomeByCategory: numberRecord(r.income_by_category),
    expenseByCategory: numberRecord(r.expense_by_category),
  }));
}

// ---------------------------------------------------------------------------
// Ekler, ayar, kilit, kayıtlı görünüm
// ---------------------------------------------------------------------------
export async function loadAttachments(filter: AttachmentFilter = {}): Promise<Attachment[]> {
  const supabase = await createClient();
  let query = supabase
    .from("finance_attachments")
    .select("id, entry_id, open_item_id, storage_path, file_name, file_type, file_size, ocr_status, ocr_json, uploaded_by, created_at");
  if (filter.inbox) query = query.is("entry_id", null).is("open_item_id", null);
  if (filter.entryId && UUID.test(filter.entryId)) query = query.eq("entry_id", filter.entryId);
  if (filter.openItemId && UUID.test(filter.openItemId)) query = query.eq("open_item_id", filter.openItemId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(Math.min(200, Math.max(1, filter.limit ?? 100)));
  if (error) {
    logError("attachments", error);
    return [];
  }
  return ((data ?? []) as Row[]).map((r) => ({
    id: str(r.id),
    entryId: strOrNull(r.entry_id),
    openItemId: strOrNull(r.open_item_id),
    storagePath: str(r.storage_path),
    fileName: str(r.file_name),
    fileType: strOrNull(r.file_type),
    fileSize: numOrNull(r.file_size),
    ocrStatus: (["none", "pending", "done", "failed"].includes(str(r.ocr_status)) ? r.ocr_status : "none") as OcrStatus,
    ocrJson: r.ocr_json && typeof r.ocr_json === "object" ? (r.ocr_json as Record<string, unknown>) : null,
    uploadedBy: strOrNull(r.uploaded_by),
    createdAt: str(r.created_at),
  }));
}

/** Ofis finans ayarı; satır yoksa varsayılanlar (KDV %20 dahil, fiş okuma kapalı). */
export async function loadSettings(): Promise<FinanceSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("finance_settings")
    .select("base_currency, default_vat_rate, vat_included_default, ocr_enabled, forecast_min_balance, updated_at")
    .maybeSingle();
  if (error) logError("settings", error);
  if (error || !data) return DEFAULT_FINANCE_SETTINGS;
  const r = data as Row;
  return {
    baseCurrency: currency(r.base_currency),
    defaultVatRate: num(r.default_vat_rate),
    vatIncludedDefault: r.vat_included_default !== false,
    ocrEnabled: r.ocr_enabled === true,
    forecastMinBalance: numOrNull(r.forecast_min_balance),
    updatedAt: strOrNull(r.updated_at),
  };
}

export async function loadPeriodLocks(): Promise<PeriodLock[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("finance_period_locks")
    .select("period_month, locked_at, locked_by, note")
    .order("period_month", { ascending: false })
    .limit(240);
  if (error) {
    logError("period-locks", error);
    return [];
  }
  return ((data ?? []) as Row[]).map((r) => ({
    periodMonth: day(r.period_month),
    lockedAt: str(r.locked_at),
    lockedBy: strOrNull(r.locked_by),
    note: strOrNull(r.note),
  }));
}

/** Oturum sahibinin kayıtlı görünümleri (RLS: yalnız kendi satırları). */
export async function loadSavedViews(tab: FinanceTabId): Promise<SavedView[]> {
  if (!isFinanceTabId(tab)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("finance_saved_views")
    .select("id, tab, name, params, created_at")
    .eq("tab", tab)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) {
    logError("saved-views", error);
    return [];
  }
  return ((data ?? []) as Row[]).map((r) => ({
    id: str(r.id),
    tab,
    name: str(r.name),
    params:
      r.params && typeof r.params === "object" && !Array.isArray(r.params)
        ? Object.fromEntries(Object.entries(r.params as Row).filter(([, v]) => typeof v === "string") as [string, string][])
        : {},
    createdAt: str(r.created_at),
  }));
}
