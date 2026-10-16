"use server";

import { financePath } from "@/lib/finance/routes";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { parseDueInput } from "@/lib/due-input";
import { validateTenantReferences } from "@/lib/tenant-references";
import { dueErrorMessage } from "@/lib/finance/dues/errors";
import { isIsoDate } from "@/lib/workflow-state";
import { now, trDayKey } from "@/lib/clock";

/**
 * Tekil mülk aidatı (WP4, 20261017010500): kayıt `finance_open_items` (source_type 'due') içindedir; eski tekil aidat tablosu salt okunur
 * geçmiştir. Yazma YALNIZ `finance_due_*` RPC'leriyle (SECURITY DEFINER; kiracı + `expenses` izni, dönem kilidi, denetim kaydı
 * aynı transaction'da). Silme YOK: iptal (neden zorunlu). "Ödendi": hesap seçilirse kasa hareketi yazılır, seçilmezse kasa dışı.
 */
export type DueResult = { ok?: boolean; error?: string; id?: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refresh() {
  revalidatePath("/app/aidat");
  revalidatePath(financePath(), "layout");
}

/** "Ödendi" tarihi: boşsa bugün; gelecek tarih reddedilir. */
function paidOn(value: string | null | undefined): string | null | "invalid" {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (!isIsoDate(v) || v > trDayKey(now())) return "invalid";
  return v;
}

export async function createDue(_prev: DueResult, fd: FormData): Promise<DueResult> {
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return { error: gate.error };

  const parsed = parseDueInput(fd);
  if (!parsed.ok) return { error: parsed.error };
  const { title, amount, period, dueDate, propertyId, notes, direction } = parsed.value;
  const references = await validateTenantReferences(gate.tenantId, { propertyId });
  if (!references.ok) return { error: references.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_due_create", {
    p: { title, amount, issue_date: period, due_date: dueDate, property_id: propertyId, note: notes, direction },
  });
  if (error || !data) {
    console.error("createDue", { code: error?.code || "unknown" });
    return { error: dueErrorMessage(error, "Aidat kaydedilemedi; bilgileri kontrol edip tekrar deneyin.") };
  }
  refresh();
  return { ok: true, id: String(data) };
}

/** Aidat düzenleme: başlık, tutar, dönem, son ödeme, not (portföy bağı korunur; yalnız alan gelirse değişir). Açık kalemde. */
export async function updateDue(_prev: DueResult, fd: FormData): Promise<DueResult> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "Aidat kaydı geçersiz." };
  const parsed = parseDueInput(fd);
  if (!parsed.ok) return { error: parsed.error };
  const { title, amount, period, dueDate, propertyId, notes } = parsed.value;
  if (fd.has("property_id")) {
    const references = await validateTenantReferences(gate.tenantId, { propertyId });
    if (!references.ok) return { error: references.error };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_due_update", {
    p_id: id,
    p: { title, amount, issue_date: period, due_date: dueDate, note: notes, ...(fd.has("property_id") ? { property_id: propertyId } : {}) },
  });
  if (error) {
    console.error("updateDue", { code: error.code || "unknown" });
    return { error: dueErrorMessage(error, "Aidat güncellenemedi; sayfayı yenileyip tekrar deneyin.") };
  }
  refresh();
  return { ok: true, id };
}

/**
 * Ödendi / geri al. Ödendi: `accountId` verilirse kalan tutar o hesaba hareket olarak yazılır (kategori aidat), verilmezse
 * hareketi olmayan kalem "kasa dışı" kapatılır. Geri al: yalnız kasa dışı kapatılmış kalem (hareketli ödeme Muhasebe'den iptal edilir).
 */
export async function toggleDuePaid(id: string, paid: boolean, accountId?: string | null, date?: string | null): Promise<DueResult> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(id)) return { error: "Aidat kaydı geçersiz." };
  const account = String(accountId ?? "").trim();
  if (account && !UUID_RE.test(account)) return { error: "Seçilen hesap geçersiz." };
  const day = paidOn(date);
  if (day === "invalid") return { error: "Geçerli, gelecekte olmayan bir ödeme tarihi girin." };

  const supabase = await createClient();
  const { error } = paid
    ? await supabase.rpc("finance_due_mark_paid", { p_ids: [id], p_account_id: account || null, p_date: day })
    : await supabase.rpc("finance_due_reopen", { p_id: id });
  if (error) return { error: dueErrorMessage(error, "Aidat durumu güncellenemedi; sayfayı yenileyip tekrar deneyin.") };
  refresh();
  return { ok: true };
}

/**
 * Seçilen aidat kayıtlarını topluca "ödendi" işaretler — toggleDuePaid'in toplu hali (en çok 200). Zaten kapanmış kayıtlar
 * sessizce atlanır; hesap verilmezse yalnız hareketsiz açık kalemler kasa dışı kapatılır.
 */
export async function markDuesPaidBulk(
  ids: string[],
  accountId?: string | null,
): Promise<DueResult & { updated?: number }> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };

  const clean = Array.from(
    new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean)),
  ).slice(0, 200);
  if (clean.length === 0) return { error: "En az bir kayıt seçin." };
  if (clean.some((id) => !UUID_RE.test(id))) return { error: "Seçilen aidat kaydı geçersiz." };
  const account = String(accountId ?? "").trim();
  if (account && !UUID_RE.test(account)) return { error: "Seçilen hesap geçersiz." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_due_mark_paid", { p_ids: clean, p_account_id: account || null, p_date: null });
  if (error) {
    console.error("markDuesPaidBulk", { code: error.code || "unknown" });
    return { error: dueErrorMessage(error, "Seçilen aidatlar güncellenemedi; sayfayı yenileyip tekrar deneyin.") };
  }
  refresh();
  return { ok: true, updated: Number(data) || 0 };
}

/** Aidat iptali (silme YOK): kayıt kalır, durum "iptal", neden ve denetim kaydı yazılır. */
export async function cancelDue(id: string, reason: string): Promise<DueResult> {
  const gate = await requirePermission("expenses", "delete");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(id)) return { error: "Aidat kaydı geçersiz." };
  const why = String(reason ?? "").trim();
  if (why.length < 3) return { error: "İptal nedenini yazın (en az 3 karakter)." };
  if (why.length > 300) return { error: "İptal nedeni en fazla 300 karakter olabilir." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_due_cancel", { p_id: id, p_reason: why });
  if (error) {
    console.error("cancelDue", { code: error.code || "unknown" });
    return { error: dueErrorMessage(error, "Aidat iptal edilemedi; sayfayı yenileyip tekrar deneyin.") };
  }
  refresh();
  return { ok: true };
}
