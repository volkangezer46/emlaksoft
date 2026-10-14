"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { now } from "@/lib/clock";
import { customCategoryKey, parseBudgetAmount, parseMonthKey, parseRatePct } from "@/lib/finance/expense-budget";
import { isMissingFinanceSchema } from "@/lib/finance/load";
import { isMissingCashSchema } from "@/lib/finance/cash/load";
import { isUuid } from "@/lib/finance/cash/input";
import { canHandleSalary } from "@/lib/finance/cash/categories";

export type ExpenseBudgetResult = { ok?: boolean; error?: string };

const MISSING = "Bütçe özelliği için veritabanı güncellemesi bekleniyor. Yöneticinizle iletişime geçin.";

/** Kategori için aylık bütçe belirler/günceller (giderler:düzenle). Boş tutar bütçeyi kaldırır. ESKİ tablo (expense_budgets). */
export async function saveExpenseBudget(_prev: ExpenseBudgetResult, formData: FormData): Promise<ExpenseBudgetResult> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };

  const category = String(formData.get("category") ?? "").trim();
  const defs = await getDefinitionsOrDefault("expense_category");
  if (!category || !defs.some((d) => d.value === category)) return { error: "Geçerli bir gider kategorisi seçin." };

  const rawAmount = String(formData.get("monthly_amount") ?? "").trim();
  const supabase = await createClient();

  if (!rawAmount) {
    const { error } = await supabase.from("expense_budgets").delete().eq("tenant_id", gate.tenantId).eq("category", category);
    if (error) return { error: isMissingFinanceSchema(error) ? MISSING : actionErrorMessage(error, "Bütçe kaldırılamadı.") };
    await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "expense_budget.remove", entityType: "expense_budget", oldValue: { category } });
  } else {
    const amount = parseBudgetAmount(rawAmount);
    if (amount === null) return { error: "Bütçe tutarı sıfırdan büyük, geçerli bir sayı olmalı." };
    const { error } = await supabase
      .from("expense_budgets")
      .upsert(
        { tenant_id: gate.tenantId, category, monthly_amount: amount, created_by: gate.userId, updated_at: new Date(now()).toISOString() },
        { onConflict: "tenant_id,category" },
      );
    if (error) return { error: isMissingFinanceSchema(error) ? MISSING : actionErrorMessage(error, "Bütçe kaydedilemedi.") };
    await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "expense_budget.set", entityType: "expense_budget", newValue: { category, monthly_amount: amount } });
  }

  revalidatePath("/app/giderler");
  revalidateTenantData(gate.tenantId);
  return { ok: true };
}

/* ================================================================================================
 * Muhasebe v2 (FN6): Bütçe, Ayarlar (kategori, otomatik kural, genel ayar) ve dönem kapanışı.
 * Yazmalar YALNIZ FN1 RPC'leriyle (finance_budget_set, finance_category_*, finance_rule_*, finance_period_*,
 * finance_settings_save); her action `requirePermission("expenses", …)` kapısından geçer. Kilidi açma ayrıca
 * ofis sahibi / genel müdür ister (RPC `finance_is_owner_gm()` aynı kuralı uygular).
 * ============================================================================================== */

export type FinanceActionResult = { ok: true; id?: string; count?: number } | { ok: false; error: string };

const PATHS = ["/app/giderler"] as const;
const LEDGER_MISSING = "Muhasebe güncellemesi henüz uygulanmamış; yöneticiniz uyguladığında bu işlem açılır.";

/** FN1 RPC hata sözleşmesi (`FN:<kod>`) için Türkçe karşılıklar. */
const FN_MESSAGES: Record<string, string> = {
  invalid_input: "Girilen bilgiler geçersiz; alanları kontrol edin.",
  invalid_category: "Seçilen kategori bulunamadı ya da arşivlenmiş.",
  party_not_found: "Seçilen cari bulunamadı.",
  not_found: "Kayıt bulunamadı.",
  limit_reached: "Bu ofis için kayıt sınırına ulaşıldı (200).",
  unauthorized: "Oturumunuz sona ermiş; yeniden giriş yapın.",
};

function isPeriodLocked(error: { message?: string | null; details?: string | null } | null): boolean {
  const text = `${error?.message ?? ""} ${error?.details ?? ""}`;
  return text.includes("DONEM_KILITLI");
}

function rpcFailure(error: { code?: string | null; message?: string | null; details?: string | null } | null, fallback: string): FinanceActionResult {
  if (isPeriodLocked(error)) return { ok: false, error: "Bu ay kapatılmış (dönem kilitli). Kayıt için önce Ayarlar > Dönem kapanışı'ndan kilidi açtırın." };
  if (isMissingCashSchema(error)) return { ok: false, error: LEDGER_MISSING };
  if ((error?.message ?? "").includes("forbidden") || error?.code === "42501") return { ok: false, error: "Bu işlem için yetkiniz yok." };
  const code = /FN:([a-z_]+)/.exec(error?.message ?? "")?.[1];
  if (code && FN_MESSAGES[code]) return { ok: false, error: FN_MESSAGES[code] };
  console.error("finance-fn6", { code: error?.code });
  return { ok: false, error: actionErrorMessage(error, fallback) };
}

const monthStart = (key: string) => `${key}-01`;
/** Muhasebe v2 yazmaları: `expenses:edit` kapısı (eski bütçe action'ı kendi kapısını ayrıca çağırır). */
const gateEdit = () => requirePermission("expenses", "edit");
const BUDGET_DIRECTIONS = new Set(["in", "out"]);

/** Ay + yön + kategori için bütçe/hedef. Boş tutar ya da 0 bütçeyi kaldırır. */
export async function setFinanceBudget(input: { month: string; direction: string; category: string; amount: string | number | null }): Promise<FinanceActionResult> {
  const gate = await gateEdit();
  if (!gate.ok) return { ok: false, error: gate.error };
  const month = parseMonthKey(input.month, "");
  if (!month) return { ok: false, error: "Geçerli bir ay seçin." };
  if (!BUDGET_DIRECTIONS.has(input.direction)) return { ok: false, error: "Gelir hedefi mi gider bütçesi mi olduğunu seçin." };
  const category = String(input.category ?? "").trim();
  if (!category || category.length > 64) return { ok: false, error: "Bir kategori seçin." };
  const raw = String(input.amount ?? "").trim();
  let amount = 0;
  if (raw && raw !== "0") {
    const parsed = parseBudgetAmount(raw);
    if (parsed === null) return { ok: false, error: "Tutar sıfırdan büyük, geçerli bir sayı olmalı." };
    amount = parsed;
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_budget_set", { p_month: monthStart(month), p_direction: input.direction, p_category: category, p_amount: amount });
  if (error) return rpcFailure(error, "Bütçe kaydedilemedi.");
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true };
}

/** Genel muhasebe ayarları: KDV varsayılanı, dahil/hariç, fiş okuma, nakit uyarı eşiği. */
export async function saveFinanceSettings(input: { defaultVatRate: string | number; vatIncludedDefault: boolean; ocrEnabled: boolean; forecastMinBalance: string | number | null }): Promise<FinanceActionResult> {
  const gate = await gateEdit();
  if (!gate.ok) return { ok: false, error: gate.error };
  const vat = parseRatePct(input.defaultVatRate);
  if (vat === undefined || vat === null || ![0, 1, 10, 20].includes(vat)) return { ok: false, error: "KDV varsayılanı %0, %1, %10 ya da %20 olmalı." };
  const rawMin = String(input.forecastMinBalance ?? "").trim();
  let minBalance: number | null = null;
  if (rawMin) {
    const parsed = parseBudgetAmount(rawMin);
    if (parsed === null) return { ok: false, error: "Nakit uyarı eşiği sıfırdan büyük bir tutar olmalı (boş bırakılabilir)." };
    minBalance = parsed;
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_settings_save", {
    p: { default_vat_rate: vat, vat_included_default: Boolean(input.vatIncludedDefault), ocr_enabled: Boolean(input.ocrEnabled), forecast_min_balance: minBalance },
  });
  if (error) return rpcFailure(error, "Ayarlar kaydedilemedi.");
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true };
}

const CATEGORY_DIRECTIONS = new Set(["in", "out"]);
const EXPENSE_CATEGORY_RE = /^[a-z0-9_]{1,40}$/;

/** Ofis kategorisi ekle / düzenle. Anahtar yeni kayıtta adından türetilir (`x_` önekli); düzenlemede değişmez. */
export async function upsertFinanceCategory(input: {
  id?: string | null;
  direction: string;
  label: string;
  defaultVatRate?: string | number | null;
  defaultWithholdingRate?: string | number | null;
  expenseCategory?: string | null;
}): Promise<FinanceActionResult> {
  const gate = await gateEdit();
  if (!gate.ok) return { ok: false, error: gate.error };
  const id = input.id && isUuid(input.id) ? input.id : null;
  if (!CATEGORY_DIRECTIONS.has(input.direction)) return { ok: false, error: "Gelir mi gider mi olduğunu seçin." };
  const label = String(input.label ?? "").trim().replace(/\s+/g, " ");
  if (label.length < 2 || label.length > 40) return { ok: false, error: "Kategori adı 2-40 karakter olmalı." };
  const vat = parseRatePct(input.defaultVatRate);
  const wh = parseRatePct(input.defaultWithholdingRate);
  if (vat === undefined || wh === undefined) return { ok: false, error: "KDV ve stopaj oranı 0 ile 100 arasında olmalı." };
  const expenseCategory = String(input.expenseCategory ?? "").trim();
  if (expenseCategory && !EXPENSE_CATEGORY_RE.test(expenseCategory)) return { ok: false, error: "Gider raporu kategorisi geçersiz." };
  const key = customCategoryKey(label);
  if (!id && !key) return { ok: false, error: "Kategori adı harf ya da rakam içermeli." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_category_upsert", {
    p: {
      ...(id ? { id } : { key }),
      direction: input.direction,
      label,
      default_vat_rate: vat,
      default_withholding_rate: wh,
      expense_category: input.direction === "out" ? expenseCategory || "diger" : null,
    },
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Bu adla bir kategori zaten var." };
    return rpcFailure(error, "Kategori kaydedilemedi.");
  }
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true, id: typeof data === "string" ? data : undefined };
}

/** Kategoriyi arşivler: yeni kayıtta çıkmaz, eski hareketlerde etiketi korunur. */
export async function archiveFinanceCategory(id: string): Promise<FinanceActionResult> {
  const gate = await gateEdit();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!isUuid(id)) return { ok: false, error: "Kategori bulunamadı." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_category_archive", { p_id: id });
  if (error) return rpcFailure(error, "Kategori arşivlenemedi.");
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true, id };
}

/** Otomatik kategori kuralı ekle / düzenle (banka ekstresi satırları için "öner" ya da "otomatik"). */
export async function upsertFinanceRule(input: {
  id?: string | null;
  direction?: string | null;
  matchText?: string | null;
  matchIbanLast4?: string | null;
  amountMin?: string | number | null;
  amountMax?: string | number | null;
  setCategory: string;
  setPartyId?: string | null;
  mode: string;
  active?: boolean;
}): Promise<FinanceActionResult> {
  const gate = await gateEdit();
  if (!gate.ok) return { ok: false, error: gate.error };
  const id = input.id && isUuid(input.id) ? input.id : null;
  const direction = input.direction === "in" || input.direction === "out" ? input.direction : null;
  const matchText = String(input.matchText ?? "").trim().slice(0, 80) || null;
  if (matchText && matchText.length < 2) return { ok: false, error: "Eşleşme metni en az 2 karakter olmalı." };
  const iban = String(input.matchIbanLast4 ?? "").replace(/\D/g, "");
  if (iban && iban.length !== 4) return { ok: false, error: "IBAN için son 4 haneyi yazın." };
  const parseOpt = (v: unknown) => (String(v ?? "").trim() ? parseBudgetAmount(v) : null);
  const amountMin = parseOpt(input.amountMin);
  const amountMax = parseOpt(input.amountMax);
  if ((String(input.amountMin ?? "").trim() && amountMin === null) || (String(input.amountMax ?? "").trim() && amountMax === null)) {
    return { ok: false, error: "Tutar aralığı geçerli sayılardan oluşmalı." };
  }
  if (amountMin !== null && amountMax !== null && amountMin > amountMax) return { ok: false, error: "En az tutar en çok tutardan büyük olamaz." };
  if (!matchText && !iban && amountMin === null && amountMax === null) return { ok: false, error: "En az bir eşleşme koşulu girin (metin, IBAN ya da tutar)." };
  const setCategory = String(input.setCategory ?? "").trim();
  if (!setCategory || setCategory.length > 40) return { ok: false, error: "Atanacak kategoriyi seçin." };
  if (setCategory === "maas" && !canHandleSalary(gate.role)) return { ok: false, error: "Maaş kuralını yalnız ofis sahibi ve genel müdür tanımlayabilir." };
  const mode = input.mode === "auto" ? "auto" : "suggest";
  const setPartyId = input.setPartyId && isUuid(input.setPartyId) ? input.setPartyId : null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_rule_upsert", {
    p: {
      ...(id ? { id } : {}),
      direction,
      match_text: matchText,
      match_iban_last4: iban || null,
      amount_min: amountMin,
      amount_max: amountMax,
      set_category: setCategory,
      set_party_id: setPartyId,
      mode,
      active: input.active ?? true,
    },
  });
  if (error) return rpcFailure(error, "Kural kaydedilemedi.");
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true, id: typeof data === "string" ? data : undefined };
}

export async function deleteFinanceRule(id: string): Promise<FinanceActionResult> {
  const gate = await gateEdit();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!isUuid(id)) return { ok: false, error: "Kural bulunamadı." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_rule_delete", { p_id: id });
  if (error) return rpcFailure(error, "Kural silinemedi.");
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true, id };
}

/** Ayı kilitler: o aya hareket/açık kalem eklenemez, değiştirilemez, iptal edilemez (DB tetiği DONEM_KILITLI). */
export async function lockFinancePeriod(month: string, note?: string | null): Promise<FinanceActionResult> {
  const gate = await gateEdit();
  if (!gate.ok) return { ok: false, error: gate.error };
  const key = parseMonthKey(month, "");
  if (!key) return { ok: false, error: "Geçerli bir ay seçin." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_period_lock", { p_month: monthStart(key), p_note: String(note ?? "").trim().slice(0, 200) || null });
  if (error) return rpcFailure(error, "Dönem kilitlenemedi.");
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true };
}

/** Kilidi açar: YALNIZ ofis sahibi ve genel müdür. */
export async function unlockFinancePeriod(month: string): Promise<FinanceActionResult> {
  const gate = await gateEdit();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!canHandleSalary(gate.role)) return { ok: false, error: "Dönem kilidini yalnız ofis sahibi ve genel müdür açabilir." };
  const key = parseMonthKey(month, "");
  if (!key) return { ok: false, error: "Geçerli bir ay seçin." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_period_unlock", { p_month: monthStart(key) });
  if (error) return rpcFailure(error, "Dönem kilidi açılamadı.");
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true };
}
