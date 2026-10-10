"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { actionErrorMessage } from "@/lib/action-errors";
import { parseMoneyInput } from "@/lib/money-input";
import { now, trDayKey } from "@/lib/clock";
import { revalidateTenantData } from "@/lib/revalidate";
import { isUuid } from "@/lib/finance/cash/input";
import { canHandleSalary, SALARY_CATEGORY } from "@/lib/finance/cash/categories";
import { isMissingCashSchema } from "@/lib/finance/cash/load";
import { parseRuleInput, recurringOutcomeMessage, type ParsedRule } from "@/lib/finance/recurring/rules";

/**
 * Düzenli ödeme / gelir kuralları (Paket B). Yetki: OFİS kuralları `expenses` modülüne bağlıdır (maaş yalnız owner/gm);
 * KİŞİSEL kurallar yalnız oturum sahibinindir (kapı `dashboard:view`, asıl kural RPC + RLS'de). Tüm yazmalar recurring_* RPC'leridir.
 */
export type RecurringResult = { ok?: boolean; error?: string; id?: string };

const PATHS = ["/app/giderler", "/app/hesabim"] as const;
const MISSING_MSG = "Düzenli ödemeler için veritabanı güncellemesi henüz uygulanmamış.";

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

type Level = "view" | "create" | "edit" | "delete";
async function gateFor(scope: "office" | "user", level: Level) {
  return scope === "user" ? requirePermission("dashboard", "view") : requirePermission("expenses", level);
}

function rpcFailure(error: { code?: string | null; message?: string | null } | null, fallback: string): RecurringResult {
  if (isMissingCashSchema(error)) return { error: MISSING_MSG };
  console.error("recurring-rules", { code: error?.code });
  return { error: actionErrorMessage(error, fallback) };
}

async function accountScope(accountId: string): Promise<"office" | "user" | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("finance_accounts").select("owner_scope").eq("id", accountId).maybeSingle();
  const scope = (data as { owner_scope?: string } | null)?.owner_scope;
  return scope === "office" || scope === "user" ? scope : null;
}

async function ruleScope(ruleId: string): Promise<"office" | "user" | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("recurring_rules").select("scope").eq("id", ruleId).maybeSingle();
  const scope = (data as { scope?: string } | null)?.scope;
  return scope === "office" || scope === "user" ? scope : null;
}

async function occurrenceScope(occId: string): Promise<"office" | "user" | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("recurring_occurrences").select("rule_id").eq("id", occId).maybeSingle();
  const ruleId = (data as { rule_id?: string } | null)?.rule_id;
  return ruleId ? ruleScope(ruleId) : null;
}

/** Çekirdek: ayrıştırılmış kuralı RPC ile yazar (yetki çağıranda doğrulanmıştır). */
async function insertRuleCore(parsed: ParsedRule): Promise<RecurringResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recurring_rule_create", {
    p_scope: parsed.scope,
    p_direction: parsed.direction,
    p_category: parsed.category,
    p_title: parsed.title,
    p_amount: parsed.amount,
    p_account_id: parsed.accountId,
    p_frequency: parsed.frequency,
    p_pay_day: parsed.payDay,
    p_start_date: parsed.startDate,
    p_end_date: parsed.endDate,
    p_mode: parsed.mode,
    p_portal_key: parsed.portalKey,
    p_expense_category: parsed.expenseCategory,
    p_create_expense: true,
  });
  if (error) return rpcFailure(error, "Düzenli ödeme kaydedilemedi.");
  const res = asObject(data);
  if (res.outcome !== "created") return { error: recurringOutcomeMessage(String(res.outcome ?? "")) };
  return { ok: true, id: String(res.rule_id ?? "") };
}

/** "Düzenli ödeme ekle": ne için · tutar · hangi hesap · her ay hangi gün · otomatik/bana sor. */
export async function createRecurringRule(input: Record<string, unknown>): Promise<RecurringResult> {
  const accountId = String(input.accountId ?? "");
  if (!isUuid(accountId)) return { error: "Hangi hesap olduğunu seçin." };
  const scope = await accountScope(accountId);
  if (!scope) return { error: "Hesap bulunamadı." };
  const gate = await gateFor(scope, "create");
  if (!gate.ok) return { error: gate.error };
  const parsed = parseRuleInput(input as Record<string, string>, scope, trDayKey(now()));
  if (!parsed.ok) return { error: parsed.error };
  if (parsed.value.category === SALARY_CATEGORY && scope === "office" && !canHandleSalary(gate.role)) {
    return { error: "Maaş ödemelerini yalnız ofis sahibi ve genel müdür tanımlayabilir." };
  }
  const res = await insertRuleCore(parsed.value);
  if (res.ok) revalidateTenantData(gate.tenantId, PATHS);
  return res;
}

export async function updateRecurringRule(ruleId: string, input: Record<string, unknown>): Promise<RecurringResult> {
  if (!isUuid(ruleId)) return { error: "Kayıt bulunamadı." };
  const scope = await ruleScope(ruleId);
  if (!scope) return { error: "Kayıt bulunamadı." };
  const gate = await gateFor(scope, "edit");
  if (!gate.ok) return { error: gate.error };
  const title = String(input.title ?? "").trim();
  const accountId = String(input.accountId ?? "");
  const amount = parseMoneyInput(input.amount as string | number | null | undefined, { max: 9_999_999_999.99 });
  const payDay = Math.trunc(Number(input.payDay));
  const endDate = String(input.endDate ?? "").trim();
  if (!title || title.length > 160) return { error: "Açıklama 1-160 karakter olmalı." };
  if (!isUuid(accountId)) return { error: "Hangi hesap olduğunu seçin." };
  if (!amount.ok || amount.value == null || amount.value <= 0) return { error: "Geçerli, en çok iki ondalık haneli bir tutar girin." };
  if (!Number.isFinite(payDay) || payDay < 1 || payDay > 31) return { error: "Ödeme günü 1 ile 31 arasında olmalı." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recurring_rule_update", {
    p_rule_id: ruleId,
    p_title: title,
    p_amount: amount.value,
    p_account_id: accountId,
    p_pay_day: payDay,
    p_end_date: /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : null,
    p_mode: input.mode === "approve" ? "approve" : "auto",
  });
  if (error) return rpcFailure(error, "Düzenli ödeme güncellenemedi.");
  const res = asObject(data);
  if (res.outcome !== "updated") return { error: recurringOutcomeMessage(String(res.outcome ?? "")) };
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true, id: ruleId };
}

export async function setRecurringRuleActive(ruleId: string, active: boolean): Promise<RecurringResult> {
  if (!isUuid(ruleId)) return { error: "Kayıt bulunamadı." };
  const scope = await ruleScope(ruleId);
  if (!scope) return { error: "Kayıt bulunamadı." };
  const gate = await gateFor(scope, "edit");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recurring_rule_set_active", { p_rule_id: ruleId, p_active: active });
  if (error) return rpcFailure(error, "Düzenli ödeme güncellenemedi.");
  const outcome = String(asObject(data).outcome ?? "");
  if (outcome !== "paused" && outcome !== "resumed") return { error: recurringOutcomeMessage(outcome) };
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true, id: ruleId };
}

export async function deleteRecurringRule(ruleId: string): Promise<RecurringResult> {
  if (!isUuid(ruleId)) return { error: "Kayıt bulunamadı." };
  const scope = await ruleScope(ruleId);
  if (!scope) return { error: "Kayıt bulunamadı." };
  const gate = await gateFor(scope, "delete");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recurring_rule_delete", { p_rule_id: ruleId });
  if (error) return rpcFailure(error, "Düzenli ödeme silinemedi.");
  const outcome = String(asObject(data).outcome ?? "");
  if (outcome !== "deleted") return { error: recurringOutcomeMessage(outcome) };
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true };
}

/** Mevcut tekrarlayan gider serisini kurala çevirir (seri hatırlatmadan çıkar; mükerrer üretim yok). */
export async function convertExpenseSeriesToRule(expenseId: string, input: { accountId: string; payDay?: number | string; mode?: string }): Promise<RecurringResult> {
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(expenseId) || !isUuid(input.accountId)) return { error: "Gider ve hesap seçin." };
  const payDay = input.payDay == null || input.payDay === "" ? null : Math.trunc(Number(input.payDay));
  if (payDay != null && (!Number.isFinite(payDay) || payDay < 1 || payDay > 31)) return { error: "Ödeme günü 1 ile 31 arasında olmalı." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recurring_rule_from_expense", {
    p_expense_id: expenseId,
    p_account_id: input.accountId,
    p_pay_day: payDay,
    p_mode: input.mode === "approve" ? "approve" : "auto",
  });
  if (error) return rpcFailure(error, "Seri kurala çevrilemedi.");
  const res = asObject(data);
  if (res.outcome !== "created") return { error: recurringOutcomeMessage(String(res.outcome ?? "")) };
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true, id: String(res.rule_id ?? "") };
}

/** Onay bekleyen ödemeyi onaylar (tutar değiştirilebilir) -> hareket (+ ofis gideri) yazılır. */
export async function approveRecurringOccurrence(occurrenceId: string, amount?: string | number): Promise<RecurringResult> {
  if (!isUuid(occurrenceId)) return { error: "Kayıt bulunamadı." };
  const scope = await occurrenceScope(occurrenceId);
  if (!scope) return { error: "Kayıt bulunamadı." };
  const gate = await gateFor(scope, "create");
  if (!gate.ok) return { error: gate.error };
  let value: number | null = null;
  if (amount != null && String(amount).trim() !== "") {
    const parsed = parseMoneyInput(amount, { max: 9_999_999_999.99 });
    if (!parsed.ok || parsed.value == null || parsed.value <= 0) return { error: "Geçerli, en çok iki ondalık haneli bir tutar girin." };
    value = parsed.value;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recurring_occurrence_approve", { p_occurrence_id: occurrenceId, p_amount: value });
  if (error) return rpcFailure(error, "Ödeme onaylanamadı.");
  const outcome = String(asObject(data).outcome ?? "");
  if (outcome !== "approved") return { error: recurringOutcomeMessage(outcome) };
  revalidateTenantData(gate.tenantId, [...PATHS, "/app/raporlar/kar-zarar"]);
  return { ok: true, id: occurrenceId };
}

export async function skipRecurringOccurrence(occurrenceId: string): Promise<RecurringResult> {
  if (!isUuid(occurrenceId)) return { error: "Kayıt bulunamadı." };
  const scope = await occurrenceScope(occurrenceId);
  if (!scope) return { error: "Kayıt bulunamadı." };
  const gate = await gateFor(scope, "create");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recurring_occurrence_skip", { p_occurrence_id: occurrenceId });
  if (error) return rpcFailure(error, "Ödeme atlanamadı.");
  const outcome = String(asObject(data).outcome ?? "");
  if (outcome !== "skipped") return { error: recurringOutcomeMessage(outcome) };
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true, id: occurrenceId };
}
