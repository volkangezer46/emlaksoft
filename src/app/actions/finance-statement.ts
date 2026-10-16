"use server";

import { revalidateFinance } from "@/lib/finance/revalidate-finance";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { actionErrorMessage } from "@/lib/action-errors";
import { expenseCategoryFor, isCashCategory } from "@/lib/finance/cash/categories";
import { financeOutcomeMessage, isUuid } from "@/lib/finance/cash/input";
import { isMissingCashSchema } from "@/lib/finance/cash/load";
import { explainApplyFailures } from "@/lib/finance/statement/errors";
import { now, trDayKey } from "@/lib/clock";

/**
 * Banka ekstresi içe aktarma + mutabakat server action'ları (Paket C).
 *
 * Yetki: OFİS hesabı `expenses` modülüne, KİŞİSEL hesap oturum sahibine bağlıdır (Paket A ile aynı kural; asıl kural RPC + RLS'dedir).
 * Dosya yükleme/ayrıştırma `/api/app/finans/ekstre` ucundadır (server action gövde sınırına takılmaz; bkz. src/lib/finance/statement/service.ts). Tüm yazmalar
 * finance_statement_* RPC'leridir (tek transaction); service_role YOK.
 */

export type StatementResult = { ok?: boolean; error?: string; info?: string };

export type StatementDecision = {
  lineId: string;
  action: "create" | "match" | "skip" | "recurring";
  /** Düzenli ödeme kuralı (action: "recurring"). */
  ruleId?: string | null;
  category?: string | null;
  title?: string | null;
  entryId?: string | null;
  sourceType?: "commission" | "rent" | "building" | null;
  sourceId?: string | null;
};

const MISSING_MSG = "Ekstre yükleme için veritabanı güncellemesi henüz uygulanmamış.";

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

async function accountScope(accountId: string): Promise<"office" | "user" | null> {
  if (!isUuid(accountId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("finance_accounts").select("owner_scope").eq("id", accountId).maybeSingle();
  const scope = (data as { owner_scope?: string } | null)?.owner_scope;
  return scope === "office" || scope === "user" ? scope : null;
}

function rpcFailure(error: { code?: string | null; message?: string | null } | null, fallback: string): { error: string } {
  if (isMissingCashSchema(error)) return { error: MISSING_MSG };
  console.error("finance-statement", { code: error?.code });
  return { error: actionErrorMessage(error, fallback) };
}

/** Başarısız satırların nedenini (açılış tarihi, gelecek tarih, maaş yetkisi) kullanıcıya açık cümleyle verir. */
async function failureText(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  scope: "office" | "user",
  role: string,
  decisions: readonly StatementDecision[],
  lineList: { id: string; direction: "in" | "out"; line_date: string }[],
  failed: number,
): Promise<string> {
  const { data } = await supabase.from("finance_accounts").select("opening_date").eq("id", accountId).maybeSingle();
  return explainApplyFailures(
    {
      decisions,
      lines: new Map(lineList.map((l) => [l.id, { date: String(l.line_date), direction: l.direction }])),
      openingDate: (data as { opening_date?: string } | null)?.opening_date ?? null,
      today: trDayKey(now()),
      canBookSalary: role === "owner" || role === "gm",
      isOfficeAccount: scope === "office",
    },
    failed,
  );
}

/** Adım 3: kullanıcının onay/düzeltme kararlarını uygular (hareket üret / mevcutla eşle / atla). */
export async function applyStatementDecisions(accountId: string, decisions: readonly StatementDecision[]): Promise<StatementResult> {
  const scope = await accountScope(accountId);
  if (!scope) return { error: "Hesap bulunamadı." };
  const gate = scope === "user" ? await requirePermission("dashboard", "view") : await requirePermission("expenses", "create");
  if (!gate.ok) return { error: gate.error };
  if (!Array.isArray(decisions) || decisions.length === 0) return { error: "Önce işlenecek satırları seçin." };
  if (decisions.length > 500) return { error: "Tek seferde en çok 500 satır onaylanabilir." };

  const supabase = await createClient();
  const ids = decisions.map((d) => String(d.lineId));
  if (ids.some((id) => !isUuid(id))) return { error: "Satır bilgisi geçersiz. Sayfayı yenileyip tekrar deneyin." };
  const { data: lineRows, error: lineErr } = await supabase.from("finance_statement_lines").select("id, direction, line_date").eq("account_id", accountId).in("id", ids);
  if (lineErr) return rpcFailure(lineErr, "Ekstre satırları okunamadı.");
  const lineList = (lineRows ?? []) as { id: string; direction: "in" | "out"; line_date: string }[];
  const dirById = new Map(lineList.map((r) => [r.id, r.direction]));

  const payload: Record<string, unknown>[] = [];
  for (const d of decisions) {
    const dir = dirById.get(String(d.lineId));
    if (!dir) return { error: "Satırlardan biri bulunamadı. Sayfayı yenileyip tekrar deneyin." };
    if (d.action === "skip") {
      payload.push({ line_id: d.lineId, action: "skip" });
    } else if (d.action === "match") {
      if (!d.entryId || !isUuid(d.entryId)) return { error: "Eşleştirilecek hareket seçilmemiş." };
      payload.push({ line_id: d.lineId, action: "match", entry_id: d.entryId });
    } else if (d.action === "recurring") {
      if (!d.ruleId || !isUuid(d.ruleId)) return { error: "Düzenli ödeme kuralı seçilmemiş." };
      payload.push({ line_id: d.lineId, action: "recurring", rule_id: d.ruleId });
    } else if (d.action === "create") {
      const category = d.category ? String(d.category) : null;
      if (category && !isCashCategory(category, dir)) return { error: "Kategori satırın yönüyle (gelir/gider) uyuşmuyor." };
      const source = d.sourceType && d.sourceId && isUuid(d.sourceId) ? d.sourceType : null;
      if (source && !["commission", "rent", "building"].includes(source)) return { error: "Tahsilat bağı geçersiz." };
      payload.push({
        line_id: d.lineId,
        action: "create",
        category,
        title: d.title ? String(d.title).slice(0, 160) : null,
        source_type: source ?? "import",
        source_id: source ? d.sourceId : null,
        expense_category: category ? (expenseCategoryFor(category) ?? "diger") : "diger",
      });
    } else {
      return { error: "Geçersiz işlem." };
    }
  }

  const { data, error } = await supabase.rpc("finance_statement_apply", { p_account_id: accountId, p_decisions: payload });
  if (error) return rpcFailure(error, "Ekstre işlenemedi.");
  const res = asObject(data);
  if (res.outcome !== "applied") return { error: financeOutcomeMessage(String(res.outcome ?? "")) };
  revalidateFinance(gate.tenantId);
  const created = Number(res.created ?? 0);
  const matched = Number(res.matched ?? 0);
  const skipped = Number(res.skipped ?? 0);
  const failed = Number(res.failed ?? 0);
  const parts = [created ? `${created} hareket oluşturuldu` : "", matched ? `${matched} hareket mutabık işaretlendi` : "", skipped ? `${skipped} satır atlandı` : ""].filter(Boolean);
  if (failed > 0 && parts.length === 0) {
    return { error: await failureText(supabase, accountId, scope, gate.role, decisions, lineList, failed) };
  }
  const tail = failed > 0 ? `; ${failed} satır işlenemedi ve taslakta bekliyor (${(await failureText(supabase, accountId, scope, gate.role, decisions, lineList, failed)).replace(/^\d+ satır işlenemedi:? ?/, "").replace(/\.$/, "")})` : "";
  return { ok: true, info: `${parts.join(", ")}${tail}.` };
}

/** Taslağı at: yalnız bekleyen satırlar silinir; işlenmiş hareketler kalır. */
export async function discardStatementImport(accountId: string, importId: string): Promise<StatementResult> {
  const scope = await accountScope(accountId);
  if (!scope || !isUuid(importId)) return { error: "Kayıt bulunamadı." };
  const gate = scope === "user" ? await requirePermission("dashboard", "view") : await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_statement_discard", { p_import_id: importId });
  if (error) return rpcFailure(error, "Taslak atılamadı.");
  const res = asObject(data);
  if (res.outcome !== "discarded") return { error: financeOutcomeMessage(String(res.outcome ?? "")) };
  revalidateFinance(gate.tenantId);
  return { ok: true };
}
