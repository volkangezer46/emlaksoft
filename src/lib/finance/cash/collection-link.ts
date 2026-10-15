import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingCashSchema } from "./load";
import { isUuid } from "./input";
import { OPEN_FINANCE_ITEM_STATUSES, type FinanceOpenItemStatus } from "@/lib/workflow-state";
import { financePost, financeReverse, type PostResult, type PostingEvent } from "../posting/client";
import { buildingChargeKey, buildingPaymentKey, commissionCollectionKey, commissionKey, ownerPayoutKey, rentPaymentKey } from "../posting/keys";

/**
 * Komisyon / kira / aidat tahsilatını ve mülk sahibi ödemesini ofis hesabına yazar (SUNUCU yardımcısı; "use server" DEĞİL).
 * Tek kayıt servisinin (`finance_post`, 20261017010000) ince sarmalayıcısıdır; olay anahtarları:
 *  - komisyon tahsilatı `commission:{id}:col:{n}` (n = komisyonun sıradaki tahsilatı; kısmi tahsilat desteklenir),
 *  - kira tahsilatı `rent:{rent_payments.id}`, bina aidatı tahsilatı `building:{building_payments.id}`,
 *  - mülk sahibi ödemesi `owner_payout:{owner_payouts.id}`.
 * Aynı anahtarla tekrar çağrı `duplicate` döner (yeni satır yok). Hesap seçilmediyse HİÇBİR ŞEY yapmaz.
 * Hareket hatası tahsilatı BOZMAZ: uyarı metni döner.
 */
export type CollectionSource = "commission" | "rent" | "building";

/** Yapılandırılmış sonuç: ok=true -> hareket yazıldı ya da zaten vardı (idempotent); ok=false -> code makine okur, warning yalnız GÖSTERİM. */
export type CollectionCashResult =
  | { ok: true; skipped?: boolean; duplicate?: boolean; entryId?: string; amount?: number }
  | { ok: false; code: "invalid_id" | "rpc_error" | "amount_exceeds_source" | "rejected"; outcome?: string; warning: string };

export const COLLECTION_CASH_WARN = "Tahsilat kaydedildi ancak seçilen hesaba hareket yazılamadı. Finans > Hareketler'den ekleyebilirsiniz.";
/** Hareket tarihi kapatılmış (kilitli) muhasebe ayına düştü. */
export const PERIOD_LOCKED_CASH_WARN =
  "Kayıt yapıldı ancak tarihi kapatılmış (kilitli) bir muhasebe ayına düştüğü için hesaba hareket yazılamadı. Kilidi ofis sahibi ya da genel müdür açabilir.";
const ACCOUNT_HIDDEN_WARN = "Seçilen hesap bulunamadı ya da bu hesaba hareket yazma yetkiniz yok.";

/** RPC hatası finans ay kilidi tetiğinden mi geldi (DONEM_KILITLI). */
export function isPeriodLockedError(error: { message?: string | null } | null | undefined): boolean {
  return typeof error?.message === "string" && error.message.includes("DONEM_KILITLI");
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Kayıt servisi sonucu → tahsilat sonucu (SAF; test edilir). */
export function collectionResultOf(res: PostResult, amount: number, fallbackWarn = COLLECTION_CASH_WARN): CollectionCashResult {
  if (res.ok) {
    if (res.outcome === "duplicate") return { ok: true, duplicate: true, entryId: res.entryIds[0] };
    return { ok: true, entryId: res.entryIds[0], amount };
  }
  if (res.outcome === "amount_exceeds_open") {
    return { ok: false, code: "amount_exceeds_source", outcome: res.outcome, warning: "Tahsilat tutarı kaynak kaydın kalan tutarını aşıyor; hareket yazılmadı." };
  }
  if (res.outcome === "period_locked") return { ok: false, code: "rejected", outcome: res.outcome, warning: PERIOD_LOCKED_CASH_WARN };
  if (res.outcome === "rpc_error" || res.outcome === "unknown") return { ok: false, code: "rpc_error", outcome: res.outcome, warning: fallbackWarn };
  return { ok: false, code: "rejected", outcome: res.outcome, warning: res.message ? `${fallbackWarn} (${res.message})` : fallbackWarn };
}

/* ------------------------------------------------------------------------------------------------
 * Komisyon tahsilat durumu (kısmi tahsilat)
 * ---------------------------------------------------------------------------------------------- */

export type SourceEntryRow = {
  id: string;
  direction: string;
  amount: unknown;
  posting_key: string | null;
  voided_at: string | null;
  reversal_of: string | null;
};

export type CommissionCollection = {
  /** Net tahsil edilen (iptal edilmemiş giriş − ayna çıkış), KDV dahil. */
  collected: number;
  /** Sıradaki tahsilatın sırası (`commission:{id}:col:{n}`); iptal edilmiş anahtarlar da sayılır (anahtar bir kez kullanılır). */
  nextSeq: number;
};

/** SAF: komisyonun kasa hareketlerinden net tahsilat ve sıradaki tahsilat sırası. */
export function summarizeCommissionEntries(rows: readonly SourceEntryRow[]): CommissionCollection {
  let collected = 0;
  let maxSeq = 0;
  for (const r of rows) {
    const m = /:col:(\d+)/.exec(r.posting_key ?? "");
    if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
    if (r.voided_at) continue;
    const amt = Number(r.amount) || 0;
    collected += r.direction === "in" ? amt : -amt;
  }
  return { collected: Math.max(0, round2(collected)), nextSeq: maxSeq + 1 };
}

/** Kaynağın (komisyon/kira/aidat/mülk sahibi ödemesi) ofis hareketleri; okunamazsa null. */
async function loadSourceEntries(supabase: SupabaseClient, sourceType: string, sourceId: string): Promise<SourceEntryRow[] | null> {
  const { data, error } = await supabase
    .from("cash_entries")
    .select("id, direction, amount, posting_key, voided_at, reversal_of")
    .eq("source_type", sourceType)
    .eq("source_id", sourceId);
  if (error) {
    if (!isMissingCashSchema(error)) console.error("loadSourceEntries", { code: error.code });
    return null;
  }
  return (data ?? []) as SourceEntryRow[];
}

/** Komisyonun tahsilat durumu (KDV dahil toplam, net tahsil edilen, kalan, sıradaki sıra). Okunamazsa null. */
export async function loadCommissionCollection(
  supabase: SupabaseClient,
  commissionId: string,
): Promise<(CommissionCollection & { total: number; remaining: number }) | null> {
  if (!isUuid(commissionId)) return null;
  const [{ data: c, error }, rows] = await Promise.all([
    supabase.from("commissions").select("id, gross_amount, vat_amount").eq("id", commissionId).maybeSingle(),
    loadSourceEntries(supabase, "commission", commissionId),
  ]);
  if (error || !c || rows === null) return null;
  const total = commissionCashAmount(c);
  const s = summarizeCommissionEntries(rows);
  return { ...s, total, remaining: Math.max(0, round2(total - s.collected)) };
}

/** Kayıt servisiyle açılmış açık kalem (anahtarıyla); açık ve kalanı tutarı karşılıyorsa kimliği, değilse null. */
async function settleableItem(supabase: SupabaseClient, key: string, amount: number): Promise<string | null> {
  const { data, error } = await supabase
    .from("finance_open_items")
    .select("id, amount, paid_amount, status")
    .eq("posting_key", key)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; amount: unknown; paid_amount: unknown; status: FinanceOpenItemStatus };
  if (!OPEN_FINANCE_ITEM_STATUSES.includes(row.status)) return null;
  return Number(row.amount) - Number(row.paid_amount ?? 0) + 0.005 >= amount ? row.id : null;
}

/** Hesap bu oturuma görünür bir ofis hesabı mı (RLS: expenses:view). Görünmüyorsa kaynak hareketleri de okunamaz. */
async function officeAccountVisible(supabase: SupabaseClient, accountId: string): Promise<boolean> {
  const { data, error } = await supabase.from("finance_accounts").select("id, owner_scope").eq("id", accountId).maybeSingle();
  return !error && Boolean(data) && (data as { owner_scope?: string }).owner_scope === "office";
}

export async function recordCollectionCashResult(
  supabase: SupabaseClient,
  args: { accountId?: string | null; sourceType: CollectionSource; sourceId: string; amount: number; date: string; title: string },
): Promise<CollectionCashResult> {
  const accountId = (args.accountId ?? "").trim();
  if (!accountId) return { ok: true, skipped: true };
  if (!isUuid(accountId) || !isUuid(args.sourceId)) return { ok: false, code: "invalid_id", warning: COLLECTION_CASH_WARN };
  const title = args.title.slice(0, 160);
  let amount = round2(Number(args.amount));
  if (!(amount > 0)) return { ok: false, code: "rejected", warning: COLLECTION_CASH_WARN };

  let event: PostingEvent;
  if (args.sourceType === "commission") {
    // Tahsilat sırası ve kalan tutar kasa hareketlerinden okunur: hesap görünmüyorsa hareketler de görünmez (yanlış kalan) → yazılmaz.
    if (!(await officeAccountVisible(supabase, accountId))) return { ok: false, code: "rejected", warning: ACCOUNT_HIDDEN_WARN };
    const state = await loadCommissionCollection(supabase, args.sourceId);
    if (!state) return { ok: false, code: "rpc_error", warning: COLLECTION_CASH_WARN };
    // Tamamı tahsil edilmiş: tekrar çağrı (yeniden dene / çift tıklama) yeni hareket yazmaz.
    if (state.remaining < 0.005) return { ok: true, duplicate: true };
    // "Tahsil edildi" işaretleme kalan tutarı yazar (önceki kısmi tahsilatlar düşülür).
    amount = Math.min(amount, state.remaining);
    const settles = await settleableItem(supabase, commissionKey(args.sourceId), amount);
    event = {
      eventType: "commission.collected",
      postingKey: commissionCollectionKey(args.sourceId, state.nextSeq),
      date: args.date,
      sourceId: args.sourceId,
      title,
      entries: [{ accountId, amount, title, ...(settles ? { settles } : {}) }],
    };
  } else if (args.sourceType === "rent") {
    event = {
      eventType: "rent.collected",
      postingKey: rentPaymentKey(args.sourceId),
      date: args.date,
      sourceId: args.sourceId,
      title,
      entries: [{ accountId, amount, title }],
    };
  } else {
    // Bina aidatı tahsilatı, tahakkuk kalemi (building_charge:{charge_id}) kayıt servisinde açıksa onu kapatır.
    const { data: pay } = await supabase.from("building_payments").select("charge_id").eq("id", args.sourceId).maybeSingle();
    const chargeId = (pay as { charge_id?: string | null } | null)?.charge_id ?? null;
    const settles = chargeId && isUuid(chargeId) ? await settleableItem(supabase, buildingChargeKey(chargeId), amount) : null;
    event = {
      eventType: "building.collected",
      postingKey: buildingPaymentKey(args.sourceId),
      date: args.date,
      sourceId: args.sourceId,
      title,
      entries: [{ accountId, amount, title, ...(settles ? { settles } : {}) }],
    };
  }
  return collectionResultOf(await financePost(supabase, event), amount);
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
 * Mülk sahibi hakediş ödemesini ofis hesabına ÇIKIŞ olarak yazar (`owner.paid`, anahtar `owner_payout:{id}`).
 * Hesap seçilmediyse hiçbir şey yapmaz. Hareket hatası ödemeyi BOZMAZ: uyarı metni döner (null = sorun yok).
 */
export async function recordOwnerPayoutCash(
  supabase: SupabaseClient,
  args: { accountId?: string | null; payoutId: string; amount: number; date: string; title: string; counterparty?: string | null },
): Promise<string | null> {
  const accountId = (args.accountId ?? "").trim();
  if (!accountId) return null;
  if (!isUuid(accountId) || !isUuid(args.payoutId)) return OWNER_PAYOUT_CASH_WARN;
  const title = args.title.slice(0, 160);
  const res = await financePost(supabase, {
    eventType: "owner.paid",
    postingKey: ownerPayoutKey(args.payoutId),
    date: args.date,
    sourceId: args.payoutId,
    title,
    entries: [{ accountId, amount: round2(Number(args.amount)), title, counterparty: args.counterparty ? args.counterparty.slice(0, 120) : undefined }],
  });
  const out = collectionResultOf(res, args.amount, OWNER_PAYOUT_CASH_WARN);
  return out.ok ? null : out.warning;
}

export type SourceReverseResult = { ok: boolean; reversed: number; mirrored: number; failed: number; message: string | null };

/**
 * Kaynağın (tahsilat / ödeme) tüm geçerli ofis hareketlerini geri alır: kayıt servisinin `finance_reverse`'i (açık ayda iptal,
 * kilitli ayda ilk açık aya `reversal_of` bağlı ayna). Hiçbir şey silinmez. Hareketler bu oturuma görünmüyorsa ya da yalnız
 * eski yol (anahtarsız) hareketler varsa eski `finance_void_source_entries` RPC'si (kaynak modülü yetkisiyle) kullanılır.
 */
export async function reverseSourceCash(
  supabase: SupabaseClient,
  sourceType: CollectionSource | "owner_payout",
  sourceId: string,
  reason: string,
): Promise<SourceReverseResult> {
  const done = (r: Partial<SourceReverseResult>): SourceReverseResult => ({ ok: true, reversed: 0, mirrored: 0, failed: 0, message: null, ...r });
  if (!isUuid(sourceId)) return done({ ok: false, message: "Kayıt bulunamadı." });
  const rows = await loadSourceEntries(supabase, sourceType, sourceId);
  const mirroredIds = new Set((rows ?? []).filter((r) => r.reversal_of).map((r) => r.reversal_of as string));
  const live = (rows ?? []).filter((r) => !r.voided_at && !r.reversal_of && !mirroredIds.has(r.id));
  const posted = live.filter((r) => r.posting_key);
  if (rows === null || rows.length === 0 || (posted.length === 0 && live.length > 0)) {
    const { error } = await supabase.rpc("finance_void_source_entries", { p_source_type: sourceType, p_source_id: sourceId, p_reason: reason });
    if (error && !isMissingCashSchema(error)) {
      console.error("reverseSourceCash legacy", { code: error.code });
      return done({ ok: false, failed: live.length || 1, message: isPeriodLockedError(error) ? PERIOD_LOCKED_CASH_WARN : "Bağlı kasa hareketi iptal edilemedi." });
    }
    return done({ reversed: live.length });
  }
  let reversed = 0;
  let mirrored = 0;
  let failed = 0;
  let message: string | null = null;
  for (const e of live) {
    const r = await financeReverse(supabase, { targetId: e.id, reason });
    if (r.ok) {
      reversed += 1;
      if (r.outcome === "mirrored") mirrored += 1;
    } else {
      failed += 1;
      message = r.message;
    }
  }
  return { ok: failed === 0, reversed, mirrored, failed, message };
}

/** Tahsilat geri alınınca/iptal edilince bağlı hareketi geri alır (en iyi çaba). Ödeme iptalinde 'owner_payout'. */
export async function voidCollectionCash(
  supabase: SupabaseClient,
  sourceType: CollectionSource | "owner_payout",
  sourceId: string,
  reason = "Tahsilat geri alındı",
): Promise<void> {
  const res = await reverseSourceCash(supabase, sourceType, sourceId, reason);
  if (!res.ok) console.error("voidCollectionCash", { sourceType, failed: res.failed });
}

/* ================================================================================================
 * Komisyon tahsilatı ↔ kasa (SK6/B109)
 * ============================================================================================== */

/**
 * Komisyon tahsilatının kasaya yazılacak tutarı: KDV DAHİL. `gross_amount` KDV hariç matrahtır (kapanış RPC'si v_net'i yazar);
 * müşteriden tahsil edilen matrah + KDV'dir (açık kalem v3 alacağı da gross_amount + vat_amount). Kuruşa yuvarlanır.
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
 * "Kasaya işle" kuyruğu (Kasa ve banka sekmesi): tahsil edilmiş (paid/collected) ama KDV dahil tutarının tamamı geçerli
 * (iptal edilmemiş) kasa hareketiyle karşılanmamış komisyonlar; tutar = eksik kalan kısım. Örnek veri dışlanır; en yeni `limit` tahsilat taranır (`partial` = tarama sınırına ulaşıldı).
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
    .select("source_id, direction, amount")
    .eq("tenant_id", tenantId)
    .eq("source_type", "commission")
    .is("voided_at", null)
    .in("source_id", rows.map((r) => r.id));
  if (ent.error) {
    if (!isMissingCashSchema(ent.error)) console.error("loadCommissionsMissingCash entries", { code: ent.error.code });
    return empty;
  }
  // Kısmi tahsilat: kuyruktaki tutar = KDV dahil toplam − net kasaya yazılan (ayna çıkışlar düşer).
  const linked = new Map<string, number>();
  for (const e of (ent.data ?? []) as { source_id: string | null; direction: string; amount: unknown }[]) {
    const k = String(e.source_id);
    linked.set(k, (linked.get(k) ?? 0) + (e.direction === "in" ? 1 : -1) * (Number(e.amount) || 0));
  }
  const gaps: CommissionCashGap[] = [];
  for (const r of rows) {
    const amount = Math.round((commissionCashAmount(r) - Math.max(0, linked.get(r.id) ?? 0)) * 100) / 100;
    if (!(amount >= 0.01)) continue;
    const deal = one(r.deal as GapRow["deal"]) as { deal_type?: string | null; property?: unknown } | null;
    const prop = one(deal?.property as { title?: string | null; property_code?: string | null } | null);
    const label = prop?.title?.trim() || prop?.property_code?.trim() || (deal?.deal_type === "rent" ? "Kiralama komisyonu" : "Satış komisyonu");
    gaps.push({ id: r.id, amount, date: r.created_at, label });
  }
  return { available: true, rows: gaps, total: Math.round(gaps.reduce((s, r) => s + r.amount, 0) * 100) / 100, partial: rows.length >= limit };
}
