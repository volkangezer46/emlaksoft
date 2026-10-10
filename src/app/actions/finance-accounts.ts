"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { actionErrorMessage } from "@/lib/action-errors";
import { parseMoneyInput } from "@/lib/money-input";
import { isIsoDate } from "@/lib/workflow-state";
import { now, trDayKey } from "@/lib/clock";
import { revalidateTenantData } from "@/lib/revalidate";
import { checkTransfer } from "@/lib/finance/cash/balance";
import { canHandleSalary, expenseCategoryFor, SALARY_CATEGORY, type CashDirection } from "@/lib/finance/cash/categories";
import { financeOutcomeMessage, isUuid, parseAccountInput, parseEntryInput } from "@/lib/finance/cash/input";
import { isMissingCashSchema, type FinanceAccount } from "@/lib/finance/cash/load";

/**
 * Finans hesapları + para hareket defteri server action'ları (Paket A).
 *
 * Yetki: OFİS hesapları `expenses` modülüne bağlıdır (görüntüle/oluştur/düzenle/sil); KİŞİSEL hesaplar yalnız oturum sahibinindir
 * (yeni izin modülü yok; kapı olarak herkesin sahip olduğu `dashboard:view` kullanılır, asıl kural RPC + RLS'dedir: kişisel hesabı
 * ofis sahibi dahil kimse göremez/yazamaz). Tüm yazmalar finance_* RPC'leridir (tek transaction, denetim kaydı); service_role YOK.
 */

export type FinanceResult = { ok?: boolean; error?: string; id?: string; info?: string };
export type PostableAccount = { id: string; name: string; kind: string; currency: string; scope: "office" | "user" };

const MISSING_MSG = "Kasa ve banka için veritabanı güncellemesi henüz uygulanmamış.";
const PATHS = ["/app/giderler"] as const;

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

type Level = "view" | "create" | "edit" | "delete";

/** Kişisel hesap işlemleri her oturumlu üyeye açıktır (`dashboard:view`); ofis hesapları `expenses` yetkisi ister. */
async function gateFor(scope: "office" | "user", level: Level) {
  return scope === "user" ? requirePermission("dashboard", "view") : requirePermission("expenses", level);
}

async function accountOf(accountId: string): Promise<Pick<FinanceAccount, "id" | "owner_scope" | "currency" | "archived_at"> | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("finance_accounts").select("id, owner_scope, currency, archived_at").eq("id", accountId).maybeSingle();
  return (data as Pick<FinanceAccount, "id" | "owner_scope" | "currency" | "archived_at"> | null) ?? null;
}

async function entryScope(entryId: string): Promise<"office" | "user" | null> {
  const supabase = await createClient();
  const { data: entry } = await supabase.from("cash_entries").select("account_id").eq("id", entryId).maybeSingle();
  if (!entry) return null;
  const acc = await accountOf(String((entry as { account_id: string }).account_id));
  return acc?.owner_scope ?? null;
}

function rpcFailure(error: { code?: string | null; message?: string | null } | null, fallback: string): FinanceResult {
  if (isMissingCashSchema(error)) return { error: MISSING_MSG };
  console.error("finance-accounts", { code: error?.code });
  return { error: actionErrorMessage(error, fallback) };
}

// ---------------------------------------------------------------------------
// Hesaplar
// ---------------------------------------------------------------------------

export async function createFinanceAccount(input: Record<string, unknown>): Promise<FinanceResult> {
  const today = trDayKey(now());
  const parsed = parseAccountInput(input as Record<string, string>, today);
  if (!parsed.ok) return { error: parsed.error };
  const a = parsed.value;
  const gate = await gateFor(a.scope, "create");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_account_create", {
    p_scope: a.scope,
    p_kind: a.kind,
    p_name: a.name,
    p_iban_last4: a.ibanLast4,
    p_currency: a.currency,
    p_opening_balance: a.openingBalance,
    p_opening_date: a.openingDate,
  });
  if (error) return rpcFailure(error, "Hesap açılamadı.");
  const res = asObject(data);
  if (res.outcome !== "created") return { error: financeOutcomeMessage(String(res.outcome ?? "")) };
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true, id: String(res.account_id ?? "") };
}

export async function updateFinanceAccount(accountId: string, input: Record<string, unknown>): Promise<FinanceResult> {
  if (!isUuid(accountId)) return { error: "Hesap bulunamadı." };
  const acc = await accountOf(accountId);
  if (!acc) return { error: "Hesap bulunamadı." };
  const gate = await gateFor(acc.owner_scope, "edit");
  if (!gate.ok) return { error: gate.error };
  const today = trDayKey(now());
  const parsed = parseAccountInput({ ...(input as Record<string, string>), scope: acc.owner_scope, currency: acc.currency }, today);
  if (!parsed.ok) return { error: parsed.error };
  const a = parsed.value;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_account_update", {
    p_account_id: accountId,
    p_name: a.name,
    p_iban_last4: a.ibanLast4,
    p_opening_balance: a.openingBalance,
    p_opening_date: a.openingDate,
  });
  if (error) return rpcFailure(error, "Hesap güncellenemedi.");
  const res = asObject(data);
  if (res.outcome !== "updated") return { error: financeOutcomeMessage(String(res.outcome ?? "")) };
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true, id: accountId };
}

export async function archiveFinanceAccount(accountId: string, archived: boolean): Promise<FinanceResult> {
  if (!isUuid(accountId)) return { error: "Hesap bulunamadı." };
  const acc = await accountOf(accountId);
  if (!acc) return { error: "Hesap bulunamadı." };
  const gate = await gateFor(acc.owner_scope, "edit");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_account_set_archived", { p_account_id: accountId, p_archived: archived });
  if (error) return rpcFailure(error, "Hesap güncellenemedi.");
  const outcome = String(asObject(data).outcome ?? "");
  if (outcome !== "archived" && outcome !== "unarchived") return { error: financeOutcomeMessage(outcome) };
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true, id: accountId };
}

/** Tahsilat ekranlarındaki "Hangi hesaba girdi?" seçimi için: yazılabilir (arşivsiz) OFİS hesapları. Yetki/şema yoksa boş liste. */
export async function listPostableAccounts(): Promise<PostableAccount[]> {
  const gate = await requirePermission("expenses", "view");
  if (!gate.ok) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("finance_accounts")
    .select("id, name, kind, currency, owner_scope")
    .eq("owner_scope", "office")
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) {
    if (!isMissingCashSchema(error)) console.error("listPostableAccounts", { code: error.code });
    return [];
  }
  return ((data ?? []) as { id: string; name: string; kind: string; currency: string; owner_scope: "office" | "user" }[]).map((a) => ({
    id: a.id, name: a.name, kind: a.kind, currency: a.currency, scope: a.owner_scope,
  }));
}

// ---------------------------------------------------------------------------
// Hareketler
// ---------------------------------------------------------------------------

/**
 * Hızlı "Gelir ekle" / "Gider ekle". Ofis hesabından TL gider çıkışı, `alsoExpense` kapalı değilse aynı transaction'da
 * `expenses` kaydı da üretir (Giderler özeti/kâr-zarar bozulmaz); maaş ve kişisel hesap hareketleri gider kaydına DÖNÜŞMEZ.
 */
export async function recordCashEntry(direction: CashDirection, input: Record<string, unknown>): Promise<FinanceResult> {
  if (direction !== "in" && direction !== "out") return { error: "İşlem türü geçersiz." };
  const today = trDayKey(now());
  const parsed = parseEntryInput(input as Record<string, string>, direction, today);
  if (!parsed.ok) return { error: parsed.error };
  const e = parsed.value;
  const acc = await accountOf(e.accountId);
  if (!acc) return { error: "Hesap bulunamadı." };
  const gate = await gateFor(acc.owner_scope, "create");
  if (!gate.ok) return { error: gate.error };
  if (e.category === SALARY_CATEGORY && acc.owner_scope === "office" && !canHandleSalary(gate.role)) {
    return { error: "Maaş hareketlerini yalnız ofis sahibi ve genel müdür girebilir." };
  }

  const expenseCategory = expenseCategoryFor(e.category);
  const createExpense = direction === "out" && acc.owner_scope === "office" && expenseCategory !== null && input.alsoExpense !== false;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_record_entry", {
    p_account_id: e.accountId,
    p_direction: direction,
    p_amount: e.amount,
    p_entry_date: e.date,
    p_category: e.category,
    p_title: e.title,
    p_counterparty: e.counterparty,
    p_document_url: e.documentUrl,
    p_note: e.note,
    p_source_type: "manual",
    p_source_id: null,
    p_create_expense: createExpense,
    p_expense_category: expenseCategory,
  });
  if (error) return rpcFailure(error, "Hareket kaydedilemedi.");
  const res = asObject(data);
  if (res.outcome !== "recorded") return { error: financeOutcomeMessage(String(res.outcome ?? ""), { openingDate: res.opening_date as string | undefined }) };
  revalidateTenantData(gate.tenantId, [...PATHS, "/app/raporlar/kar-zarar"]);
  return { ok: true, id: String(res.entry_id ?? "") };
}

export async function updateCashEntry(entryId: string, input: Record<string, unknown>): Promise<FinanceResult> {
  if (!isUuid(entryId)) return { error: "Hareket bulunamadı." };
  const scope = await entryScope(entryId);
  if (!scope) return { error: "Hareket bulunamadı." };
  const gate = await gateFor(scope, "edit");
  if (!gate.ok) return { error: gate.error };
  const direction: CashDirection = String(input.direction) === "in" ? "in" : "out";
  const parsed = parseEntryInput(input as Record<string, string>, direction, trDayKey(now()));
  if (!parsed.ok) return { error: parsed.error };
  const e = parsed.value;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_update_entry", {
    p_entry_id: entryId,
    p_amount: e.amount,
    p_entry_date: e.date,
    p_category: e.category,
    p_title: e.title,
    p_counterparty: e.counterparty,
    p_document_url: e.documentUrl,
    p_note: e.note,
    p_expense_category: expenseCategoryFor(e.category),
  });
  if (error) return rpcFailure(error, "Hareket güncellenemedi.");
  const res = asObject(data);
  if (res.outcome !== "updated") return { error: financeOutcomeMessage(String(res.outcome ?? ""), { openingDate: res.opening_date as string | undefined }) };
  revalidateTenantData(gate.tenantId, [...PATHS, "/app/raporlar/kar-zarar"]);
  return { ok: true, id: entryId };
}

/** Hareketi iptal eder (silinmez; transfer iki bacağı birlikte). Neden zorunlu. */
export async function voidCashEntry(entryId: string, reason: string): Promise<FinanceResult> {
  if (!isUuid(entryId)) return { error: "Hareket bulunamadı." };
  const scope = await entryScope(entryId);
  if (!scope) return { error: "Hareket bulunamadı." };
  const gate = await gateFor(scope, "delete");
  if (!gate.ok) return { error: gate.error };
  const text = String(reason ?? "").trim();
  if (text.length < 3) return { error: "İptal nedenini yazın (en az 3 karakter)." };
  if (text.length > 300) return { error: "İptal nedeni en fazla 300 karakter olabilir." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_void_entry", { p_entry_id: entryId, p_reason: text });
  if (error) return rpcFailure(error, "Hareket iptal edilemedi.");
  const outcome = String(asObject(data).outcome ?? "");
  if (outcome !== "voided") return { error: financeOutcomeMessage(outcome) };
  revalidateTenantData(gate.tenantId, [...PATHS, "/app/raporlar/kar-zarar"]);
  return { ok: true, id: entryId };
}

export async function transferBetweenAccounts(input: {
  fromAccountId: string;
  toAccountId: string;
  amount: string | number;
  date?: string;
  note?: string;
}): Promise<FinanceResult> {
  if (!isUuid(input.fromAccountId) || !isUuid(input.toAccountId)) return { error: "Kaynak ve hedef hesabı seçin." };
  const from = await accountOf(input.fromAccountId);
  const to = await accountOf(input.toAccountId);
  if (!from || !to) return { error: "Hesap bulunamadı." };
  // Ofis hesabına dokunan transfer expenses yetkisi ister; iki kişisel hesap arası transfer oturum sahibine yeter.
  const gate = await gateFor(from.owner_scope === "office" || to.owner_scope === "office" ? "office" : "user", "create");
  if (!gate.ok) return { error: gate.error };
  const amount = parseMoneyInput(input.amount, { max: 9_999_999_999.99 });
  if (!amount.ok || amount.value == null || amount.value <= 0) return { error: "Geçerli, en çok iki ondalık haneli bir tutar girin." };
  const today = trDayKey(now());
  const date = (input.date ?? "").trim() || today;
  if (!isIsoDate(date) || date > today) return { error: "Geçerli bir tarih girin (gelecekte olamaz)." };
  const note = (input.note ?? "").trim();
  if (note.length > 1000) return { error: "Not en fazla 1000 karakter olabilir." };
  const check = checkTransfer({ fromId: from.id, toId: to.id, fromCurrency: from.currency, toCurrency: to.currency, amount: amount.value });
  if (!check.ok) return { error: check.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_transfer", {
    p_from_account: from.id,
    p_to_account: to.id,
    p_amount: amount.value,
    p_entry_date: date,
    p_note: note || null,
  });
  if (error) return rpcFailure(error, "Transfer yapılamadı.");
  const res = asObject(data);
  if (res.outcome !== "transferred") return { error: financeOutcomeMessage(String(res.outcome ?? "")) };
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true, id: String(res.transfer_group_id ?? "") };
}
