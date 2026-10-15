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
/** Hareket tarihi kapatılmış (kilitli) muhasebe ayına düştü: tetik DONEM_KILITLI. */
export const PERIOD_LOCKED_CASH_WARN =
  "Kayıt yapıldı ancak tarihi kapatılmış (kilitli) bir muhasebe ayına düştüğü için hesaba hareket yazılamadı. Kilidi ofis sahibi ya da genel müdür açabilir.";

/** RPC hatası finans ay kilidi tetiğinden mi geldi (DONEM_KILITLI). */
export function isPeriodLockedError(error: { message?: string | null } | null | undefined): boolean {
  return typeof error?.message === "string" && error.message.includes("DONEM_KILITLI");
}

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
    return { ok: false, code: "rpc_error", warning: isPeriodLockedError(error) ? PERIOD_LOCKED_CASH_WARN : COLLECTION_CASH_WARN };
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
    return isPeriodLockedError(error) ? PERIOD_LOCKED_CASH_WARN : OWNER_PAYOUT_CASH_WARN;
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

/* ================================================================================================
 * Komisyon tahsilatı ↔ kasa (SK6/B109)
 * ============================================================================================== */

/**
 * Komisyon tahsilatının kasaya yazılacak tutarı: KDV DAHİL. `gross_amount` KDV hariç matrahtır (kapanış RPC'si v_net'i yazar);
 * müşteriden tahsil edilen matrah + KDV'dir. finance_record_entry'nin komisyon tavanı da gross_amount + vat_amount. Kuruşa yuvarlanır.
 */
export function commissionCashAmount(row: { gross_amount: unknown; vat_amount?: unknown }): number {
  const gross = Number(row.gross_amount);
  if (!Number.isFinite(gross)) return 0;
  const vat = Math.max(0, Number(row.vat_amount ?? 0) || 0);
  return Math.round((gross + vat) * 100) / 100;
}

export const COMMISSION_ACCOUNT_REQUIRED = "Tahsilatın girdiği hesabı seçin; komisyon kasaya yazılmadan tahsil edildi işaretlenemez.";
export const COMMISSION_NO_ACCOUNT_CONFIRM =
  "Ofiste kasa ya da banka hesabı yok. Tahsilatı kasaya yazmadan işaretlemek için onaylayın; hesap açınca Kasa ve banka sekmesinden kasaya işleyebilirsiniz.";

export type CollectionAccountDecision =
  | { ok: true; accountId: string | null }
  | { ok: false; code: "account_required" | "confirm_no_cash" | "invalid_account"; error: string };

/**
 * "Tahsil edildi" işaretlemeden ÖNCE hesap kararı (SUNUCU; arayüzle aynı kural):
 *  - hesap verildiyse o hesap (biçim denetimi; yetki, mükerrer ve tavan denetimi RPC'de);
 *  - verilmediyse ve ofiste arşivlenmemiş ofis hesabı görünüyorsa → reddedilir (hesap zorunlu);
 *  - ofiste hesap yoksa (ya da muhasebe şeması yoksa) yalnız bilinçli `skipCash` onayıyla kasaya yazmadan geçer.
 * Hesap sayımı okunamazsa (beklenmeyen hata) güvenli taraf: hesap istenir.
 */
export async function decideCollectionAccount(
  supabase: SupabaseClient,
  args: { accountId?: string | null; skipCash?: boolean },
): Promise<CollectionAccountDecision> {
  const accountId = String(args.accountId ?? "").trim();
  if (accountId) {
    return isUuid(accountId) ? { ok: true, accountId } : { ok: false, code: "invalid_account", error: "Seçilen hesap geçersiz." };
  }
  const { count, error } = await supabase
    .from("finance_accounts")
    .select("id", { count: "exact", head: true })
    .eq("owner_scope", "office")
    .is("archived_at", null);
  const accounts = error ? (isMissingCashSchema(error) ? 0 : null) : (count ?? 0);
  if (accounts === null || accounts > 0) return { ok: false, code: "account_required", error: COMMISSION_ACCOUNT_REQUIRED };
  return args.skipCash ? { ok: true, accountId: null } : { ok: false, code: "confirm_no_cash", error: COMMISSION_NO_ACCOUNT_CONFIRM };
}

export type CommissionCashGap = { id: string; amount: number; date: string; label: string };

type GapRow = {
  id: string;
  gross_amount: unknown;
  vat_amount: unknown;
  created_at: string;
  deal?: { deal_type?: string | null; property?: { title?: string | null; property_code?: string | null } | { title?: string | null; property_code?: string | null }[] | null } | { deal_type?: string | null }[] | null;
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * "Kasaya işle" kuyruğu (Kasa ve banka sekmesi): tahsil edilmiş (paid/collected) ama geçerli (iptal edilmemiş) kasa hareketi
 * olmayan komisyonlar. Örnek veri dışlanır; en yeni `limit` tahsilat taranır (`partial` = tarama sınırına ulaşıldı).
 * Şema yoksa ya da okunamazsa `available=false` (sahte sıfır yok).
 */
export async function loadCommissionsMissingCash(
  supabase: SupabaseClient,
  tenantId: string,
  limit = 200,
): Promise<{ available: boolean; rows: CommissionCashGap[]; total: number; partial: boolean }> {
  const empty = { available: false, rows: [] as CommissionCashGap[], total: 0, partial: false };
  const { data, error } = await supabase
    .from("commissions")
    .select("id, gross_amount, vat_amount, created_at, deal:deals!commissions_deal_id_fkey(deal_type, property:properties!deals_property_id_fkey(title, property_code))")
    .eq("tenant_id", tenantId)
    .in("status", ["paid", "collected"])
    .eq("is_sample", false)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (!isMissingCashSchema(error)) console.error("loadCommissionsMissingCash", { code: error.code });
    return empty;
  }
  const rows = (data ?? []) as unknown as GapRow[];
  if (rows.length === 0) return { ...empty, available: true };
  const ent = await supabase
    .from("cash_entries")
    .select("source_id")
    .eq("tenant_id", tenantId)
    .eq("source_type", "commission")
    .is("voided_at", null)
    .in("source_id", rows.map((r) => r.id));
  if (ent.error) {
    if (!isMissingCashSchema(ent.error)) console.error("loadCommissionsMissingCash entries", { code: ent.error.code });
    return empty;
  }
  const linked = new Set(((ent.data ?? []) as { source_id: string | null }[]).map((e) => String(e.source_id)));
  const gaps: CommissionCashGap[] = [];
  for (const r of rows) {
    if (linked.has(r.id)) continue;
    const amount = commissionCashAmount(r);
    if (!(amount > 0)) continue;
    const deal = one(r.deal as GapRow["deal"]) as { deal_type?: string | null; property?: unknown } | null;
    const prop = one(deal?.property as { title?: string | null; property_code?: string | null } | null);
    const label = prop?.title?.trim() || prop?.property_code?.trim() || (deal?.deal_type === "rent" ? "Kiralama komisyonu" : "Satış komisyonu");
    gaps.push({ id: r.id, amount, date: r.created_at, label });
  }
  return { available: true, rows: gaps, total: Math.round(gaps.reduce((s, r) => s + r.amount, 0) * 100) / 100, partial: rows.length >= limit };
}
