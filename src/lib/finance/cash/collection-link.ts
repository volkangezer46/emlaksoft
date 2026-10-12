import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingCashSchema } from "./load";
import { isUuid } from "./input";
import { OWNER_PAYOUT_CATEGORY } from "./categories";

/**
 * Komisyon / kira / aidat tahsilatını isteğe bağlı olarak ofis hesabına hareket olarak yazar (SUNUCU yardımcısı; "use server" DEĞİL).
 * Hesap seçilmediyse HİÇBİR ŞEY yapmaz (tahsilat davranışı aynı kalır). Hareket hatası tahsilatı BOZMAZ: uyarı metni döner.
 * Çift sayım yok: RPC (tenant, source_type, source_id, account) üçlüsünü benzersiz tutar; tekrar çağrı `duplicate` olur.
 */
export type CollectionSource = "commission" | "rent" | "building";

const SOURCE_CATEGORY: Record<CollectionSource, string> = {
  commission: "komisyon",
  rent: "kira_tahsilat",
  building: "aidat_tahsilat",
};

/** Yapılandırılmış sonuç: ok=true -> hareket yazıldı ya da zaten vardı (idempotent); ok=false -> code makine okur, warning yalnız GÖSTERİM. */
export type CollectionCashResult =
  | { ok: true; skipped?: boolean; duplicate?: boolean }
  | { ok: false; code: "invalid_id" | "rpc_error" | "amount_exceeds_source" | "rejected"; outcome?: string; warning: string };

export const COLLECTION_CASH_WARN = "Tahsilat kaydedildi ancak seçilen hesaba hareket yazılamadı. Finans > Hareketler'den ekleyebilirsiniz.";

export async function recordCollectionCashResult(
  supabase: SupabaseClient,
  args: { accountId?: string | null; sourceType: CollectionSource; sourceId: string; amount: number; date: string; title: string },
): Promise<CollectionCashResult> {
  const accountId = (args.accountId ?? "").trim();
  if (!accountId) return { ok: true, skipped: true };
  if (!isUuid(accountId) || !isUuid(args.sourceId)) return { ok: false, code: "invalid_id", warning: COLLECTION_CASH_WARN };
  const { data, error } = await supabase.rpc("finance_record_entry", {
    p_account_id: accountId,
    p_direction: "in",
    p_amount: args.amount,
    p_entry_date: args.date,
    p_category: SOURCE_CATEGORY[args.sourceType],
    p_title: args.title.slice(0, 160),
    p_source_type: args.sourceType,
    p_source_id: args.sourceId,
  });
  if (error) {
    if (!isMissingCashSchema(error)) console.error("recordCollectionCash", { code: error.code });
    return { ok: false, code: "rpc_error", warning: COLLECTION_CASH_WARN };
  }
  const res = data as { outcome?: string; reason?: string } | null;
  if (res?.outcome === "recorded") return { ok: true };
  if (res?.outcome === "duplicate") return { ok: true, duplicate: true };
  if (res?.reason === "amount_exceeds_source") {
    return { ok: false, code: "amount_exceeds_source", outcome: res.outcome, warning: "Tahsilat tutarı kaynak kaydın tutarını aşıyor; hareket yazılmadı." };
  }
  return { ok: false, code: "rejected", outcome: res?.outcome, warning: COLLECTION_CASH_WARN };
}

/** Eski çağıranlar için: başarıda null, hatada gösterim metni. Yeni kod `recordCollectionCashResult` kullanır. */
export async function recordCollectionCash(
  supabase: SupabaseClient,
  args: { accountId?: string | null; sourceType: CollectionSource; sourceId: string; amount: number; date: string; title: string },
): Promise<string | null> {
  const res = await recordCollectionCashResult(supabase, args);
  return res.ok ? null : res.warning;
}

export const OWNER_PAYOUT_CASH_WARN = "Ödeme kaydedildi ancak seçilen hesaba çıkış hareketi yazılamadı. Finans > Hareketler'den ekleyebilirsiniz.";

/**
 * Mülk sahibi hakediş ödemesini isteğe bağlı olarak ofis hesabına ÇIKIŞ olarak yazar (source_type 'owner_payout', source_id = owner_payouts.id).
 * Hesap seçilmediyse hiçbir şey yapmaz. Hareket hatası ödemeyi BOZMAZ: uyarı metni döner (null = sorun yok).
 */
export async function recordOwnerPayoutCash(
  supabase: SupabaseClient,
  args: { accountId?: string | null; payoutId: string; amount: number; date: string; title: string; counterparty?: string | null },
): Promise<string | null> {
  const accountId = (args.accountId ?? "").trim();
  if (!accountId) return null;
  if (!isUuid(accountId) || !isUuid(args.payoutId)) return OWNER_PAYOUT_CASH_WARN;
  const { data, error } = await supabase.rpc("finance_record_entry", {
    p_account_id: accountId,
    p_direction: "out",
    p_amount: args.amount,
    p_entry_date: args.date,
    p_category: OWNER_PAYOUT_CATEGORY,
    p_title: args.title.slice(0, 160),
    p_counterparty: args.counterparty ? args.counterparty.slice(0, 120) : null,
    p_source_type: "owner_payout",
    p_source_id: args.payoutId,
  });
  if (error) {
    if (!isMissingCashSchema(error)) console.error("recordOwnerPayoutCash", { code: error.code });
    return OWNER_PAYOUT_CASH_WARN;
  }
  const outcome = (data as { outcome?: string } | null)?.outcome;
  return outcome === "recorded" || outcome === "duplicate" ? null : OWNER_PAYOUT_CASH_WARN;
}

/** Tahsilat geri alınınca/iptal edilince bağlı hareketi iptal eder (en iyi çaba; şema yoksa sessiz). Ödeme iptalinde 'owner_payout'. */
export async function voidCollectionCash(
  supabase: SupabaseClient,
  sourceType: CollectionSource | "owner_payout",
  sourceId: string,
  reason = "Tahsilat geri alındı",
): Promise<void> {
  if (!isUuid(sourceId)) return;
  const { error } = await supabase.rpc("finance_void_source_entries", { p_source_type: sourceType, p_source_id: sourceId, p_reason: reason });
  if (error && !isMissingCashSchema(error)) console.error("voidCollectionCash", { code: error.code });
}
