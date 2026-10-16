"use server";

import { revalidateFinance } from "@/lib/finance/revalidate-finance";
import { financePath } from "@/lib/finance/routes";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { actionErrorMessage } from "@/lib/action-errors";
import { revalidateTenantData } from "@/lib/revalidate";
import { parseMoneyInput } from "@/lib/money-input";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { isMissingCashSchema } from "@/lib/finance/cash/load";
import { financeOutcomeMessage } from "@/lib/finance/cash/input";
import { isFinanceTabId, PARTY_KINDS, type Direction, type FinanceTabId, type OpenItemDirection, type PartyKind, type RuleMode } from "@/lib/finance/ledger/types";

/**
 * Finans v2 (Muhasebe) server action'ları — FN1 sözleşmesi. Her action `requirePermission("expenses", …)` kapısından geçer,
 * yazma yalnız finance_* RPC'leriyle yapılır (tek transaction, kiracı + yetki + maaş kuralı DB'de), başarıda
 * Finans ve Kazancım/Kasam (`revalidateFinance`) tazelenir. Dönüş: `{ ok: true, id? } | { ok: false, error }`.
 * RPC hata sözleşmesi: `FN:<kod>` → Türkçe mesaj; ay kilidi tetiği `DONEM_KILITLI` → kilit mesajı.
 * Yetki: kayıt/cari/kalem açma = create; düzenleme, kategori/kural/kilit/bütçe/ayar = edit; kalem iptali = delete;
 * ay kilidini açma yalnız ofis sahibi ve genel müdür (RPC'de finance_is_owner_gm).
 */

export type LedgerResult = { ok: true; id?: string; count?: number } | { ok: false; error: string };

const MISSING_MSG = "Muhasebe güncellemesi veritabanına henüz uygulanmamış. Kısa süre sonra yeniden deneyin.";
const PERIOD_LOCKED_MESSAGE =
  "Bu ay kapatılmış (ay kilidi); kayıt eklenemez, değiştirilemez ya da iptal edilemez. Kilidi ofis sahibi ya da genel müdür Ayarlar > Dönem kapanışı bölümünden açabilir.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const FN_MESSAGES: Record<string, string> = {
  party_not_found: "Cari bulunamadı.",
  invalid_category: "Kategori bulunamadı ya da bu yönde kullanılamaz.",
  amount_exceeds_open: "Tutar, kalemin kalan tutarını aşıyor.",
  item_closed: "Bu kalem kapanmış ya da iptal edilmiş.",
  duplicate: "Bu kayıt zaten var.",
  duplicate_name: "Bu adla başka bir kayıt var.",
  limit_reached: "Kayıt sınırına ulaşıldı (en fazla 200).",
  error: "İşlem tamamlanamadı. Sayfayı yenileyip tekrar deneyin.",
};

type RpcError = { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null;

/** RPC hatasını kullanıcı mesajına çevirir (DONEM_KILITLI ve FN:<kod> sözleşmesi). İç yardımcı (dışa açık action değil). */
function ledgerErrorMessage(error: RpcError, fallbackSubject: string): string {
  const msg = error?.message ?? "";
  if (msg.includes("DONEM_KILITLI")) return PERIOD_LOCKED_MESSAGE;
  const fn = /FN:([a-z_]+)/.exec(msg);
  if (fn) return FN_MESSAGES[fn[1]!] ?? financeOutcomeMessage(fn[1]!);
  if (isMissingCashSchema(error)) return MISSING_MSG;
  return actionErrorMessage(error, fallbackSubject);
}

function fail(error: RpcError, subject: string): LedgerResult {
  return { ok: false, error: ledgerErrorMessage(error, subject) };
}

const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const optUuid = (v: unknown): string | null => (isUuid(v) ? v : null);
const optText = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const optDate = (v: unknown): string | null => (typeof v === "string" && ISO_DATE.test(v) ? v : null);
function money(v: unknown, opts: { allowZero?: boolean } = {}): number | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  const r = parseMoneyInput(typeof v === "number" || typeof v === "string" ? v : String(v), { allowZero: opts.allowZero });
  return r.ok ? r.value : "invalid";
}
function rate(v: unknown): number | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : "invalid";
}
const INVALID: LedgerResult = { ok: false, error: "Girdiğiniz bilgileri kontrol edin (tutar, tarih ve açıklama)." };

// ---------------------------------------------------------------------------
// Hareket
// ---------------------------------------------------------------------------
export type EntryV2Input = {
  accountId: string;
  direction: Direction | "transfer";
  amount: number | string;
  entryDate?: string;
  category?: string | null;
  title?: string | null;
  partyId?: string | null;
  partyName?: string | null;
  partyKind?: PartyKind | null;
  counterparty?: string | null;
  vatRate?: number | string | null;
  vatIncluded?: boolean;
  withholdingRate?: number | string | null;
  propertyId?: string | null;
  openItemId?: string | null;
  note?: string | null;
  documentUrl?: string | null;
  createExpense?: boolean;
  expenseCategory?: string | null;
  attachmentIds?: string[];
  ruleId?: string | null;
  /** Yalnız transfer: hedef hesap. */
  toAccountId?: string | null;
};

function entryPayload(input: EntryV2Input): Record<string, unknown> | null {
  const amount = money(input.amount);
  const vat = rate(input.vatRate);
  const wh = rate(input.withholdingRate);
  if (amount === "invalid" || amount === null || vat === "invalid" || wh === "invalid") return null;
  if (!isUuid(input.accountId)) return null;
  if (input.direction !== "in" && input.direction !== "out" && input.direction !== "transfer") return null;
  if (input.direction === "transfer" && !isUuid(input.toAccountId)) return null;
  const attachments = (input.attachmentIds ?? []).filter(isUuid).slice(0, 20);
  return {
    account_id: input.accountId,
    to_account_id: optUuid(input.toAccountId),
    direction: input.direction,
    amount,
    entry_date: optDate(input.entryDate),
    category: optText(input.category, 40),
    title: optText(input.title, 160),
    party_id: optUuid(input.partyId),
    party_name: optUuid(input.partyId) ? null : optText(input.partyName, 120),
    party_kind: input.partyKind && PARTY_KINDS.includes(input.partyKind) ? input.partyKind : null,
    counterparty: optText(input.counterparty, 120),
    vat_rate: vat,
    vat_included: input.vatIncluded !== false,
    withholding_rate: wh,
    property_id: optUuid(input.propertyId),
    open_item_id: optUuid(input.openItemId),
    note: optText(input.note, 1000),
    document_url: optText(input.documentUrl, 500),
    create_expense: input.createExpense === true,
    expense_category: optText(input.expenseCategory, 40),
    attachment_ids: attachments,
    rule_id: optUuid(input.ruleId),
  };
}

export async function recordEntryV2(input: EntryV2Input): Promise<LedgerResult> {
  const p = entryPayload(input);
  if (!p) return INVALID;
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_record_entry_v2", { p });
  if (error) return fail(error, "Kayıt");
  revalidateFinance(gate.tenantId);
  return { ok: true, id: String(data ?? "") };
}

export type EntryV2Patch = Partial<Omit<EntryV2Input, "accountId" | "direction" | "toAccountId" | "openItemId" | "attachmentIds" | "createExpense" | "ruleId">>;

export async function updateEntryV2(entryId: string, patch: EntryV2Patch): Promise<LedgerResult> {
  if (!isUuid(entryId)) return { ok: false, error: "Kayıt bulunamadı." };
  const p: Record<string, unknown> = {};
  if ("amount" in patch) {
    const a = money(patch.amount);
    if (a === "invalid" || a === null) return INVALID;
    p.amount = a;
    p.vat_included = patch.vatIncluded !== false;
  }
  if ("vatRate" in patch) {
    const v = rate(patch.vatRate);
    if (v === "invalid") return INVALID;
    p.vat_rate = v;
  }
  if ("withholdingRate" in patch) {
    const w = rate(patch.withholdingRate);
    if (w === "invalid") return INVALID;
    p.withholding_rate = w;
  }
  if ("entryDate" in patch) {
    const d = optDate(patch.entryDate);
    if (!d) return INVALID;
    p.entry_date = d;
  }
  if ("category" in patch) p.category = optText(patch.category, 40);
  if ("title" in patch) {
    const t = optText(patch.title, 160);
    if (!t) return INVALID;
    p.title = t;
  }
  if ("counterparty" in patch) p.counterparty = optText(patch.counterparty, 120);
  if ("note" in patch) p.note = optText(patch.note, 1000);
  if ("documentUrl" in patch) p.document_url = optText(patch.documentUrl, 500);
  if ("expenseCategory" in patch) p.expense_category = optText(patch.expenseCategory, 40);
  if ("propertyId" in patch) p.property_id = optUuid(patch.propertyId);
  if ("partyId" in patch) p.party_id = optUuid(patch.partyId);
  else if ("partyName" in patch) p.party_name = optText(patch.partyName, 120) ?? "";
  if (patch.partyKind && PARTY_KINDS.includes(patch.partyKind)) p.party_kind = patch.partyKind;
  if (Object.keys(p).length === 0) return { ok: true, id: entryId };

  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_update_entry_v2", { p_entry_id: entryId, p });
  if (error) return fail(error, "Kayıt güncelleme");
  revalidateFinance(gate.tenantId);
  return { ok: true, id: entryId };
}

/** Deftere bağlanmamış eski giderleri seçilen ofis hesabına taşır; `count` = taşınan adet. */
export async function adoptLegacyExpenses(accountId: string, expenseIds: string[]): Promise<LedgerResult> {
  const ids = [...new Set((expenseIds ?? []).filter(isUuid))].slice(0, 500);
  if (!isUuid(accountId) || ids.length === 0) return INVALID;
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_adopt_legacy_expenses", { p_account_id: accountId, p_ids: ids });
  if (error) return fail(error, "Eski giderleri taşıma");
  revalidateFinance(gate.tenantId);
  return { ok: true, count: Number(data ?? 0) };
}

// ---------------------------------------------------------------------------
// Cari
// ---------------------------------------------------------------------------
export type PartyInput = {
  id?: string | null;
  kind: PartyKind;
  name: string;
  taxId?: string | null;
  ibanLast4?: string | null;
  phone?: string | null;
  email?: string | null;
  customerId?: string | null;
  userId?: string | null;
  note?: string | null;
};

export async function upsertParty(input: PartyInput): Promise<LedgerResult> {
  const name = optText(input.name, 120);
  if (!name || !PARTY_KINDS.includes(input.kind)) return { ok: false, error: "Cari adı ve türü gerekli." };
  const taxId = optText(input.taxId, 20)?.replace(/\D/g, "") || null;
  if (taxId && !/^\d{10}$/.test(taxId)) return { ok: false, error: "Vergi kimlik no 10 haneli olmalı." };
  const iban = optText(input.ibanLast4, 4);
  if (iban && !/^\d{4}$/.test(iban)) return { ok: false, error: "IBAN'ın son 4 hanesini girin." };
  let phone: string | null = null;
  if (optText(input.phone, 40)) {
    const parsed = parsePhoneStrict(input.phone);
    if (!parsed.ok) return { ok: false, error: parsed.error ?? "Telefon numarası geçerli değil." };
    phone = parsed.stored;
  }
  const email = optText(input.email, 254)?.toLowerCase() ?? null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "E-posta adresi geçerli değil." };

  const isNew = !isUuid(input.id);
  const gate = await requirePermission("expenses", isNew ? "create" : "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_party_upsert", {
    p: {
      id: isNew ? null : input.id,
      kind: input.kind,
      name,
      tax_id: taxId,
      iban_last4: iban,
      phone,
      email,
      customer_id: optUuid(input.customerId),
      user_id: optUuid(input.userId),
      note: optText(input.note, 1000),
    },
  });
  if (error) return fail(error, "Cari kaydı");
  revalidateFinance(gate.tenantId);
  return { ok: true, id: String(data ?? "") };
}

export async function archiveParty(partyId: string, archived = true): Promise<LedgerResult> {
  if (!isUuid(partyId)) return { ok: false, error: "Cari bulunamadı." };
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_party_set_archived", { p_id: partyId, p_archived: archived });
  if (error) return fail(error, "Cari arşivleme");
  revalidateFinance(gate.tenantId);
  return { ok: true, id: partyId };
}

// ---------------------------------------------------------------------------
// Açık kalem
// ---------------------------------------------------------------------------
export type OpenItemInput = {
  direction: OpenItemDirection;
  title: string;
  amount: number | string;
  partyId?: string | null;
  partyName?: string | null;
  partyKind?: PartyKind | null;
  category?: string | null;
  currency?: "TRY" | "USD" | "EUR";
  vatRate?: number | string | null;
  withholdingRate?: number | string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  propertyId?: string | null;
  note?: string | null;
};

export async function createOpenItem(input: OpenItemInput): Promise<LedgerResult> {
  const amount = money(input.amount);
  const vat = rate(input.vatRate);
  const wh = rate(input.withholdingRate);
  const title = optText(input.title, 160);
  if (amount === "invalid" || amount === null || vat === "invalid" || wh === "invalid" || !title) return INVALID;
  if (input.direction !== "receivable" && input.direction !== "payable") return INVALID;
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_open_item_create", {
    p: {
      direction: input.direction,
      title,
      amount,
      party_id: optUuid(input.partyId),
      party_name: optUuid(input.partyId) ? null : optText(input.partyName, 120),
      party_kind: input.partyKind && PARTY_KINDS.includes(input.partyKind) ? input.partyKind : null,
      category: optText(input.category, 40),
      currency: input.currency === "USD" || input.currency === "EUR" ? input.currency : "TRY",
      vat_rate: vat,
      withholding_rate: wh,
      issue_date: optDate(input.issueDate),
      due_date: optDate(input.dueDate),
      property_id: optUuid(input.propertyId),
      note: optText(input.note, 1000),
    },
  });
  if (error) return fail(error, "Vade kalemi");
  revalidateFinance(gate.tenantId);
  return { ok: true, id: String(data ?? "") };
}

export async function cancelOpenItem(itemId: string, reason: string): Promise<LedgerResult> {
  const r = optText(reason, 300);
  if (!isUuid(itemId)) return { ok: false, error: "Kalem bulunamadı." };
  if (!r || r.length < 3) return { ok: false, error: "İptal nedeni en az 3 karakter olmalı." };
  const gate = await requirePermission("expenses", "delete");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_open_item_cancel", { p_id: itemId, p_reason: r });
  if (error) return fail(error, "Kalem iptali");
  revalidateFinance(gate.tenantId);
  return { ok: true, id: itemId };
}

/** Kalemi (kısmen) kapatır: tutar boşsa kalan tutarın tamamı. Dönen `id` oluşan hareketin kimliğidir. */
export async function settleOpenItem(input: { itemId: string; accountId: string; amount?: number | string | null; date?: string | null; note?: string | null }): Promise<LedgerResult> {
  const amount = money(input.amount);
  if (!isUuid(input.itemId) || !isUuid(input.accountId) || amount === "invalid") return INVALID;
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_open_item_settle", {
    p_id: input.itemId,
    p_account_id: input.accountId,
    p_amount: amount,
    p_date: optDate(input.date),
    p_note: optText(input.note, 1000),
  });
  if (error) return fail(error, "Tahsilat / ödeme");
  revalidateFinance(gate.tenantId);
  return { ok: true, id: String(data ?? "") };
}

// ---------------------------------------------------------------------------
// Kategori ve kural
// ---------------------------------------------------------------------------
export type CategoryInput = {
  id?: string | null;
  direction: Direction;
  label: string;
  icon?: string | null;
  defaultVatRate?: number | string | null;
  defaultWithholdingRate?: number | string | null;
  expenseCategory?: string | null;
  sort?: number;
};

export async function upsertCategory(input: CategoryInput): Promise<LedgerResult> {
  const label = optText(input.label, 60);
  const vat = rate(input.defaultVatRate);
  const wh = rate(input.defaultWithholdingRate);
  if (!label || vat === "invalid" || wh === "invalid" || (input.direction !== "in" && input.direction !== "out")) return INVALID;
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_category_upsert", {
    p: {
      id: optUuid(input.id),
      direction: input.direction,
      label,
      icon: optText(input.icon, 40),
      default_vat_rate: vat,
      default_withholding_rate: wh,
      expense_category: optText(input.expenseCategory, 40),
      sort: Number.isInteger(input.sort) ? input.sort : 0,
    },
  });
  if (error) return fail(error, "Kategori");
  revalidateFinance(gate.tenantId);
  return { ok: true, id: String(data ?? "") };
}

export async function archiveCategory(categoryId: string): Promise<LedgerResult> {
  if (!isUuid(categoryId)) return { ok: false, error: "Kategori bulunamadı." };
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_category_archive", { p_id: categoryId });
  if (error) return fail(error, "Kategori arşivleme");
  revalidateFinance(gate.tenantId);
  return { ok: true, id: categoryId };
}

export type RuleInput = {
  id?: string | null;
  direction?: Direction | null;
  matchText?: string | null;
  matchIbanLast4?: string | null;
  amountMin?: number | string | null;
  amountMax?: number | string | null;
  setCategory: string;
  setPartyId?: string | null;
  mode: RuleMode;
  active?: boolean;
};

export async function upsertRule(input: RuleInput): Promise<LedgerResult> {
  const min = money(input.amountMin, { allowZero: true });
  const max = money(input.amountMax, { allowZero: true });
  const cat = optText(input.setCategory, 40);
  if (min === "invalid" || max === "invalid" || !cat || (input.mode !== "suggest" && input.mode !== "auto")) return INVALID;
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_rule_upsert", {
    p: {
      id: optUuid(input.id),
      direction: input.direction === "in" || input.direction === "out" ? input.direction : null,
      match_text: optText(input.matchText, 100),
      match_iban_last4: optText(input.matchIbanLast4, 4),
      amount_min: min,
      amount_max: max,
      set_category: cat,
      set_party_id: optUuid(input.setPartyId),
      mode: input.mode,
      active: input.active !== false,
    },
  });
  if (error) return fail(error, "Kural");
  revalidateFinance(gate.tenantId);
  return { ok: true, id: String(data ?? "") };
}

export async function deleteRule(ruleId: string): Promise<LedgerResult> {
  if (!isUuid(ruleId)) return { ok: false, error: "Kural bulunamadı." };
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_rule_delete", { p_id: ruleId });
  if (error) return fail(error, "Kural silme");
  revalidateFinance(gate.tenantId);
  return { ok: true, id: ruleId };
}

// ---------------------------------------------------------------------------
// Dönem ve bütçe
// ---------------------------------------------------------------------------
const monthStart = (v: string): string | null => {
  if (/^\d{4}-\d{2}$/.test(v)) return `${v}-01`;
  return ISO_DATE.test(v) ? `${v.slice(0, 7)}-01` : null;
};

export async function lockPeriod(month: string, note?: string | null): Promise<LedgerResult> {
  const m = monthStart(month);
  if (!m) return INVALID;
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_period_lock", { p_month: m, p_note: optText(note, 300) });
  if (error) return fail(error, "Ay kilidi");
  revalidateFinance(gate.tenantId);
  return { ok: true };
}

/** Ay kilidini açar — yalnız ofis sahibi ve genel müdür (RPC reddeder; burada rol ön kontrolü de var). */
export async function unlockPeriod(month: string): Promise<LedgerResult> {
  const m = monthStart(month);
  if (!m) return INVALID;
  const gate = await requirePermission("expenses", "view");
  if (!gate.ok) return { ok: false, error: gate.error };
  if (gate.role !== "owner" && gate.role !== "gm") return { ok: false, error: "Ay kilidini yalnız ofis sahibi ve genel müdür açabilir." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_period_unlock", { p_month: m });
  if (error) return fail(error, "Ay kilidini açma");
  revalidateFinance(gate.tenantId);
  return { ok: true };
}

/** Bütçe: tutar boş (null) ise o ayın satırı silinir; 0 = o aydan itibaren bütçe yok. */
export async function setBudget(input: { month: string; direction: Direction; category: string; amount: number | string | null }): Promise<LedgerResult> {
  const m = monthStart(input.month);
  const amount = money(input.amount, { allowZero: true });
  const cat = optText(input.category, 60);
  if (!m || !cat || amount === "invalid" || (input.direction !== "in" && input.direction !== "out")) return INVALID;
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_budget_set", { p_month: m, p_direction: input.direction, p_category: cat, p_amount: amount });
  if (error) return fail(error, "Bütçe");
  revalidateFinance(gate.tenantId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Ekler ve ayar
// ---------------------------------------------------------------------------
export async function registerAttachment(input: {
  storagePath: string;
  fileName: string;
  fileType?: string | null;
  fileSize?: number | null;
  entryId?: string | null;
  openItemId?: string | null;
}): Promise<LedgerResult> {
  const path = optText(input.storagePath, 500);
  const name = optText(input.fileName, 200);
  if (!path || !name || path.includes("..")) return INVALID;
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!path.startsWith(`${gate.tenantId}/ledger/`)) return INVALID;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_attachment_register", {
    p_storage_path: path,
    p_file_name: name,
    p_file_type: optText(input.fileType, 100),
    p_file_size: Number.isFinite(input.fileSize) ? Math.max(0, Math.round(Number(input.fileSize))) : null,
    p_entry_id: optUuid(input.entryId),
    p_open_item_id: optUuid(input.openItemId),
  });
  if (error) return fail(error, "Belge kaydı");
  revalidateFinance(gate.tenantId);
  return { ok: true, id: String(data ?? "") };
}

/** Eki harekete / kaleme bağlar; ikisi de boşsa fiş kutusuna geri koyar. */
export async function linkAttachment(attachmentId: string, target: { entryId?: string | null; openItemId?: string | null }): Promise<LedgerResult> {
  if (!isUuid(attachmentId)) return { ok: false, error: "Belge bulunamadı." };
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_attachment_link", {
    p_id: attachmentId,
    p_entry_id: optUuid(target.entryId),
    p_open_item_id: optUuid(target.openItemId),
  });
  if (error) return fail(error, "Belge bağlama");
  revalidateFinance(gate.tenantId);
  return { ok: true, id: attachmentId };
}

export async function saveSettings(input: {
  baseCurrency?: "TRY" | "USD" | "EUR";
  defaultVatRate?: number | string;
  vatIncludedDefault?: boolean;
  ocrEnabled?: boolean;
  forecastMinBalance?: number | string | null;
}): Promise<LedgerResult> {
  const p: Record<string, unknown> = {};
  if (input.baseCurrency) {
    if (!["TRY", "USD", "EUR"].includes(input.baseCurrency)) return INVALID;
    p.base_currency = input.baseCurrency;
  }
  if (input.defaultVatRate !== undefined) {
    const v = rate(input.defaultVatRate);
    if (v === "invalid" || v === null) return INVALID;
    p.default_vat_rate = v;
  }
  if (typeof input.vatIncludedDefault === "boolean") p.vat_included_default = input.vatIncludedDefault;
  if (typeof input.ocrEnabled === "boolean") p.ocr_enabled = input.ocrEnabled;
  if ("forecastMinBalance" in input) {
    const m = money(input.forecastMinBalance, { allowZero: true });
    if (m === "invalid") return INVALID;
    p.forecast_min_balance = m;
  }
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_settings_save", { p });
  if (error) return fail(error, "Finans ayarları");
  revalidateFinance(gate.tenantId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Kayıtlı görünüm (kullanıcıya özel; RLS: yalnız kendi satırı)
// ---------------------------------------------------------------------------
const VIEW_PARAM_KEY = /^[a-z_]{1,20}$/;

export async function saveView(input: { tab: FinanceTabId; name: string; params: Record<string, string | undefined> }): Promise<LedgerResult> {
  const name = optText(input.name, 60);
  if (!name || !isFinanceTabId(input.tab)) return { ok: false, error: "Görünüm adı gerekli." };
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.params ?? {})) {
    if (VIEW_PARAM_KEY.test(k) && typeof v === "string" && v.length <= 200 && k !== "sayfa") params[k] = v;
  }
  const gate = await requirePermission("expenses", "view");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("finance_saved_views")
    .insert({ tenant_id: gate.tenantId, user_id: gate.userId, tab: input.tab, name, params })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Bu adla kayıtlı bir görünüm var." };
    return fail(error, "Görünüm kaydı");
  }
  revalidateTenantData(gate.tenantId, [financePath("hareketler")]);
  return { ok: true, id: String((data as { id: string }).id) };
}

export async function deleteView(viewId: string): Promise<LedgerResult> {
  if (!isUuid(viewId)) return { ok: false, error: "Görünüm bulunamadı." };
  const gate = await requirePermission("expenses", "view");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { error } = await supabase.from("finance_saved_views").delete().eq("id", viewId).eq("user_id", gate.userId);
  if (error) return fail(error, "Görünüm silme");
  revalidateTenantData(gate.tenantId, [financePath("hareketler")]);
  return { ok: true, id: viewId };
}
