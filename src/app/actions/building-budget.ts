"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { actionErrorMessage } from "@/lib/action-errors";
import { isIsoDate } from "@/lib/workflow-state";
import { revalidateTenantData } from "@/lib/revalidate";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { formatTryDecimal } from "@/lib/format";
import { isUuid } from "@/lib/building-management/input";
import { isMonthKey } from "@/lib/building-management/period";
import { compareUnits, distributeAmount, unitLabel } from "@/lib/building-management/distribution";
import { budgetPeriods, isBudgetDistribution, monthlyAdvance, parseBudgetLines } from "@/lib/building-management/budget";

/**
 * Bina İŞLETME PROJESİ (yıllık bütçe) action'ları. Tümü `expenses` modül kapısındadır (Aidat sayfasının modülü): oluşturma ve
 * avans tahakkuku = create, düzenleme/onay/taslağa alma = edit, taslak silme = delete. Yazma yolları veritabanı RPC'leridir
 * (yetki içeride tekrar denetlenir, denetim kaydı aynı transaction'da); service_role YOK. Avans tahakkuku mevcut
 * `create_building_batch` RPC'sini kullanır: finans/defter tetikleyicileri değişmeden çalışır, dönem başına tek aidat kuralı tekrar
 * üretimi engeller (idempotent).
 */

export type BudgetResult = { ok?: boolean; error?: string; id?: string; info?: string; created?: number; skipped?: number };

const MISSING_MSG = "İşletme projesi için veritabanı güncellemesi henüz uygulanmamış.";
const PATHS = ["/app/aidat"] as const;

function isMissingSchema(e: { code?: string | null; message?: string | null } | null): boolean {
  if (!e) return false;
  const code = String(e.code ?? "");
  return ["42P01", "42883", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(code) || /does not exist|schema cache|could not find/i.test(String(e.message ?? ""));
}

function outcomeError(outcome: string): string {
  switch (outcome) {
    case "unauthorized": return "Oturum bulunamadı. Yeniden giriş yapın.";
    case "forbidden": return "Bu işlem için yetkiniz yok.";
    case "invalid_input": return "Girdiğiniz bilgileri kontrol edin (dönem, ay sayısı, dağıtım ve kalemler).";
    case "invalid_lines": return "Bütçe kalemlerini kontrol edin: her kalemin adı ve sıfırdan büyük yıllık tutarı olmalı.";
    case "duplicate_period": return "Bu bina için aynı başlangıç ayında bir işletme projesi zaten var.";
    case "locked": return "Onaylı işletme projesi değiştirilemez. Önce taslağa alın.";
    case "not_found": return "İşletme projesi ya da bina bulunamadı.";
    case "already_approved": return "Bu işletme projesi zaten onaylı.";
    case "not_approved": return "Önce işletme projesini onaylayın.";
    case "has_accruals": return "Bu projeden tahakkuk etmiş aidat avansları var; taslağa almak için önce o ayların tahakkuklarını iptal edin.";
    case "invalid_periods": return "Seçilen aylar işletme projesinin dönemi dışında.";
    case "invalid_shares": return "Daire listesi değişmiş olabilir. Sayfayı yenileyip tekrar deneyin.";
    case "sum_mismatch": return "Daire payları aylık avansla eşleşmedi. Sayfayı yenileyip tekrar deneyin.";
    default: return "İşlem tamamlanamadı. Sayfayı yenileyip tekrar deneyin.";
  }
}

function outcomeOf(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

export type BudgetInput = {
  id?: string | null;
  buildingId: string;
  title: string;
  /** `YYYY-MM` */
  startMonth: string;
  months: number | string;
  distribution: string;
  lines: { category?: string | null; label?: string; amount?: string | number }[];
  decisionDate?: string | null;
  decisionNo?: string | null;
  decisionNote?: string | null;
};

/** İşletme projesi taslağını oluştur ya da güncelle (onaylı proje kilitlidir). */
export async function saveBuildingBudget(input: BudgetInput): Promise<BudgetResult> {
  const gate = await requirePermission("expenses", input.id ? "edit" : "create");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(input.buildingId)) return { error: "Bina bulunamadı." };
  if (input.id && !isUuid(input.id)) return { error: "İşletme projesi bulunamadı." };
  const title = String(input.title ?? "").trim();
  if (title.length < 1 || title.length > 120) return { error: "Proje adı 1-120 karakter olmalı." };
  if (!isMonthKey(input.startMonth)) return { error: "Geçerli bir başlangıç ayı seçin." };
  const months = Math.trunc(Number(input.months));
  if (!(months >= 1 && months <= 24)) return { error: "Dönem 1-24 ay olmalı." };
  if (!isBudgetDistribution(input.distribution)) return { error: "Dağıtım yöntemini seçin." };
  const decisionDate = String(input.decisionDate ?? "").trim();
  if (decisionDate && !isIsoDate(decisionDate)) return { error: "Geçerli bir karar tarihi girin." };
  const decisionNo = String(input.decisionNo ?? "").trim();
  if (decisionNo.length > 40) return { error: "Karar numarası en fazla 40 karakter olabilir." };
  const decisionNote = String(input.decisionNote ?? "").trim();
  if (decisionNote.length > 1000) return { error: "Karar notu en fazla 1000 karakter olabilir." };
  const parsed = parseBudgetLines(input.lines);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_building_budget", {
    p_budget_id: input.id || null,
    p_building_id: input.buildingId,
    p_title: title,
    p_period_start: `${input.startMonth}-01`,
    p_months: months,
    p_distribution: input.distribution,
    p_lines: parsed.lines,
    p_decision_date: decisionDate || null,
    p_decision_no: decisionNo || null,
    p_decision_note: decisionNote || null,
  });
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("saveBuildingBudget", { code: error.code });
    return { error: actionErrorMessage(error, "İşletme projesi kaydedilemedi") };
  }
  const res = outcomeOf(data);
  if (res.outcome !== "saved") return { error: outcomeError(String(res.outcome ?? "")) };
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true, id: String(res.budget_id ?? input.id ?? ""), info: `İşletme projesi kaydedildi · yıllık ${formatTryDecimal(parsed.total, 2)}` };
}

async function setStatus(tenantId: string, budgetId: string, action: "approve" | "reopen" | "delete"): Promise<BudgetResult> {
  if (!isUuid(budgetId)) return { error: "İşletme projesi bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_building_budget_status", { p_budget_id: budgetId, p_action: action });
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("setBuildingBudgetStatus", { code: error.code, action });
    return { error: actionErrorMessage(error, "İşlem tamamlanamadı") };
  }
  const res = outcomeOf(data);
  if (res.outcome !== "done") return { error: outcomeError(String(res.outcome ?? "")) };
  revalidateTenantData(tenantId, PATHS);
  return { ok: true };
}

/** Projeyi onayla (genel kurul kabulü sonrası): kalemler kilitlenir, avans tahakkuku açılır. */
export async function approveBuildingBudget(budgetId: string): Promise<BudgetResult> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };
  return setStatus(gate.tenantId, budgetId, "approve");
}

/** Onayı geri al (yalnız projeden tahakkuk etmiş, iptal edilmemiş avans yoksa). */
export async function reopenBuildingBudget(budgetId: string): Promise<BudgetResult> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };
  return setStatus(gate.tenantId, budgetId, "reopen");
}

/** Taslak projeyi sil (onaylı proje silinmez). */
export async function deleteBuildingBudget(budgetId: string): Promise<BudgetResult> {
  const gate = await requirePermission("expenses", "delete");
  if (!gate.ok) return { error: gate.error };
  return setStatus(gate.tenantId, budgetId, "delete");
}

/**
 * Onaylı projenin aylık avansını seçilen aylara (boşsa dönemin tüm aylarına) tahakkuk et. Daire payları sunucuda, dönem aidatıyla
 * AYNI saf dağıtım fonksiyonuyla hesaplanır; var olan ay atlanır (tekrar basmak güvenlidir).
 */
export async function accrueBuildingBudget(input: { budgetId: string; months?: string[] }): Promise<BudgetResult> {
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(input.budgetId)) return { error: "İşletme projesi bulunamadı." };
  const supabase = await createClient();
  const { data: b, error: bErr } = await supabase
    .from("building_budgets")
    .select("id, building_id, period_start, months, distribution, total_amount, status")
    .eq("tenant_id", gate.tenantId)
    .eq("id", input.budgetId)
    .maybeSingle();
  if (bErr) {
    if (isMissingSchema(bErr)) return { error: MISSING_MSG };
    return { error: actionErrorMessage(bErr, "Avans tahakkuku oluşturulamadı") };
  }
  if (!b) return { error: "İşletme projesi bulunamadı." };
  const budget = b as { id: string; building_id: string; period_start: string; months: number; distribution: string; total_amount: number | string; status: string };
  if (budget.status !== "approved") return { error: outcomeError("not_approved") };
  if (!isBudgetDistribution(budget.distribution)) return { error: outcomeError("invalid_input") };

  const all = budgetPeriods(String(budget.period_start).slice(0, 10), Number(budget.months));
  const requested = (input.months ?? []).filter(isMonthKey).map((m) => `${m}-01`);
  if ((input.months ?? []).length > 0 && requested.length !== (input.months ?? []).length) return { error: "Geçerli aylar seçin." };
  const periods = requested.length > 0 ? [...new Set(requested)] : all;
  if (periods.some((p) => !all.includes(p))) return { error: outcomeError("invalid_periods") };

  const monthly = monthlyAdvance(Number(budget.total_amount), Number(budget.months));
  type UnitRaw = { id: string; block: string | null; floor: number | null; unit_no: string; area_m2: number | string | null; land_share: number | string | null };
  const { data: unitRows, error: uErr } = await fetchAllRows<UnitRaw>((from, to) =>
    supabase.from("building_units").select("id, block, floor, unit_no, area_m2, land_share")
      .eq("tenant_id", gate.tenantId).eq("building_id", budget.building_id).eq("active", true)
      .order("id", { ascending: true }).range(from, to), 1000, 5);
  if (uErr) return { error: "Daireler okunamadı. Sayfayı yenileyip tekrar deneyin." };
  const units = (unitRows as { id: string; block: string | null; floor: number | null; unit_no: string; area_m2: number | string | null; land_share: number | string | null }[])
    .map((u) => ({ id: u.id, block: u.block, floor: u.floor, unitNo: u.unit_no, areaM2: u.area_m2 == null ? null : Number(u.area_m2), landShare: u.land_share == null ? null : Number(u.land_share) }))
    .sort(compareUnits);
  if (units.length === 0) return { error: "Binada etkin daire yok. Önce daireleri ekleyin." };
  const dist = distributeAmount({
    method: budget.distribution,
    total: monthly,
    units: units.map((u) => ({ id: u.id, label: unitLabel(u), areaM2: u.areaM2, landShare: u.landShare })),
  });
  if (!dist.ok) return { error: dist.error };

  const { data, error } = await supabase.rpc("accrue_building_budget", {
    p_budget_id: budget.id,
    p_periods: periods,
    p_shares: dist.shares.map((s) => ({ unit_id: s.unitId, amount: s.amount })),
  });
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("accrueBuildingBudget", { code: error.code });
    return { error: actionErrorMessage(error, "Avans tahakkuku oluşturulamadı") };
  }
  const res = outcomeOf(data);
  if (res.outcome !== "accrued") return { error: outcomeError(String(res.outcome ?? "")) };
  const created = Number(res.created) || 0;
  const skipped = Number(res.skipped) || 0;
  revalidateTenantData(gate.tenantId, PATHS);
  const info = created > 0
    ? `${created} ay için ${units.length} daireye aylık ${formatTryDecimal(monthly, 2)} avans tahakkuk etti${skipped > 0 ? ` · ${skipped} ay zaten vardı` : ""}`
    : "Seçilen ayların tamamı zaten tahakkuk etmiş; yeni kayıt açılmadı.";
  return { ok: true, created, skipped, info };
}
