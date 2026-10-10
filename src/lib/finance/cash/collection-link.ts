import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingCashSchema } from "./load";
import { isUuid } from "./input";

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

export async function recordCollectionCash(
  supabase: SupabaseClient,
  args: { accountId?: string | null; sourceType: CollectionSource; sourceId: string; amount: number; date: string; title: string },
): Promise<string | null> {
  const accountId = (args.accountId ?? "").trim();
  if (!accountId) return null;
  const WARN = "Tahsilat kaydedildi ancak seçilen hesaba hareket yazılamadı. Finans > Hareketler'den ekleyebilirsiniz.";
  if (!isUuid(accountId) || !isUuid(args.sourceId)) return WARN;
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
    return WARN;
  }
  const outcome = (data as { outcome?: string } | null)?.outcome;
  return outcome === "recorded" || outcome === "duplicate" ? null : WARN;
}

/** Tahsilat geri alınınca/iptal edilince bağlı hareketi iptal eder (en iyi çaba; şema yoksa sessiz). */
export async function voidCollectionCash(
  supabase: SupabaseClient,
  sourceType: CollectionSource,
  sourceId: string,
  reason = "Tahsilat geri alındı",
): Promise<void> {
  if (!isUuid(sourceId)) return;
  const { error } = await supabase.rpc("finance_void_source_entries", { p_source_type: sourceType, p_source_id: sourceId, p_reason: reason });
  if (error && !isMissingCashSchema(error)) console.error("voidCollectionCash", { code: error.code });
}
