/**
 * Kayıt servisinin tipli sarmalayıcıları (SUNUCU yardımcısı; "use server" DEĞİL): `finance_post` / `finance_reverse` RPC'leri
 * (20261017010000_finance_posting_core.sql). Çağıran oturumlu Supabase istemcisini verir; yetki, kiracı ve dönem kilidi
 * veritabanında uygulanır. Sonuç makine okunur `outcome` + gösterim için Türkçe `message` taşır.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPostingKey } from "./keys";
import { isPostingEventType, type PostingEventType } from "./rules";

export type PostingItemInput = {
  direction?: "receivable" | "payable";
  category?: string;
  /** KDV dahil brüt (açık kalem tutarı). Komisyon alacağı = matrah + KDV. */
  amount: number;
  currency?: "TRY" | "USD" | "EUR";
  vatRate?: number;
  vatAmount?: number;
  withholdingAmount?: number;
  dueDate?: string;
  invoiceId?: string;
  title?: string;
};

export type PostingEntryInput = {
  accountId: string;
  direction?: "in" | "out";
  amount: number;
  category?: string;
  title?: string;
  counterparty?: string;
  vatRate?: number;
  vatAmount?: number;
  withholdingAmount?: number;
  /** Kapatılan açık kalem kimliği ya da aynı olayda açılan kalem için "item". */
  settles?: string | "item";
};

export type PostingEvent = {
  eventType: PostingEventType;
  postingKey: string;
  /** YYYY-MM-DD; boşsa bugün (İstanbul). */
  date?: string;
  sourceId?: string;
  partyId?: string;
  partyName?: string;
  partyKind?: "musteri" | "malik" | "kiraci" | "tedarikci" | "danisman" | "diger";
  propertyId?: string;
  title?: string;
  note?: string;
  item?: PostingItemInput;
  entries?: PostingEntryInput[];
};

export const POST_OUTCOMES = [
  "posted", "duplicate", "memo",
  "unauthorized", "forbidden", "invalid_input", "invalid_key", "invalid_category", "unknown_event",
  "source_not_found", "party_not_found", "account_not_found", "not_found", "archived", "before_opening",
  "item_closed", "amount_exceeds_open", "period_locked",
] as const;
export type PostOutcome = (typeof POST_OUTCOMES)[number];

export const REVERSE_OUTCOMES = [
  "voided", "cancelled", "mirrored", "already_reversed",
  "unauthorized", "forbidden", "invalid_input", "not_found", "has_settlements", "legacy_expense_linked",
  "no_open_period", "period_locked",
] as const;
export type ReverseOutcome = (typeof REVERSE_OUTCOMES)[number];

export type PostResult = {
  ok: boolean;
  outcome: PostOutcome | "rpc_error" | "unknown";
  entryIds: string[];
  openItemId: string | null;
  /** Tahakkuk kilitli aya düştü ve ilk açık aya tarihlendi. */
  redated: boolean;
  /** duplicate: var olan kayıt iptal edilmiş / ters kaydı alınmış (yeniden kayıt yeni sürüm anahtarı ister). */
  reversed: boolean;
  message: string | null;
};

export type ReverseResult = {
  ok: boolean;
  outcome: ReverseOutcome | "rpc_error" | "unknown";
  entryIds: string[];
  openItemId: string | null;
  reversalIds: string[];
  reversalDate: string | null;
  message: string | null;
};

const MESSAGES: Readonly<Record<string, string>> = {
  unauthorized: "Oturumunuz sona ermiş. Lütfen yeniden giriş yapın.",
  forbidden: "Bu işlem için yetkiniz yok.",
  invalid_input: "Kayıt bilgileri eksik ya da geçersiz.",
  invalid_key: "Kayıt anahtarı geçersiz.",
  invalid_category: "Seçilen kategori bu ofiste tanımlı değil.",
  unknown_event: "Bu kayıt türü tanınmıyor.",
  source_not_found: "Bağlı kayıt bulunamadı.",
  party_not_found: "Seçilen cari bulunamadı.",
  account_not_found: "Seçilen hesap bulunamadı.",
  not_found: "Kayıt bulunamadı.",
  archived: "Seçilen hesap arşivde.",
  before_opening: "Tarih, hesabın açılış tarihinden önce olamaz.",
  item_closed: "Bu açık kalem zaten kapanmış.",
  amount_exceeds_open: "Tutar, kalemin kalan tutarını aşıyor.",
  period_locked: "Bu ay kilitli; kilidi ofis sahibi ya da genel müdür açabilir.",
  has_settlements: "Bu kalemin tahsilat/ödemesi var. Önce o hareketleri geri alın.",
  legacy_expense_linked: "Bu hareket bir gider kaydına bağlı; Hareketler ekranından iptal edin.",
  no_open_period: "Ters kayıt için açık bir ay bulunamadı.",
  rpc_error: "Kayıt şu anda yapılamadı. Lütfen tekrar deneyin.",
  unknown: "Kayıt şu anda yapılamadı. Lütfen tekrar deneyin.",
};

export function postingMessage(outcome: string): string | null {
  return MESSAGES[outcome] ?? null;
}

const OK_POST: ReadonlySet<string> = new Set(["posted", "duplicate", "memo"]);
const OK_REVERSE: ReadonlySet<string> = new Set(["voided", "cancelled", "mirrored", "already_reversed"]);

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Olayı RPC'nin jsonb biçimine çevirir (tanımsız alanlar gönderilmez). */
export function toEventPayload(e: PostingEvent): Record<string, unknown> {
  const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  return clean({
    event_type: e.eventType,
    posting_key: e.postingKey,
    date: e.date,
    source_id: e.sourceId,
    party_id: e.partyId,
    party_name: e.partyName,
    party_kind: e.partyKind,
    property_id: e.propertyId,
    title: e.title,
    note: e.note,
    item: e.item
      ? clean({
          direction: e.item.direction,
          category: e.item.category,
          amount: e.item.amount,
          currency: e.item.currency,
          vat_rate: e.item.vatRate,
          vat_amount: e.item.vatAmount,
          withholding_amount: e.item.withholdingAmount,
          due_date: e.item.dueDate,
          invoice_id: e.item.invoiceId,
          title: e.item.title,
        })
      : undefined,
    entries: e.entries?.map((x) =>
      clean({
        account_id: x.accountId,
        direction: x.direction,
        amount: x.amount,
        category: x.category,
        title: x.title,
        counterparty: x.counterparty,
        vat_rate: x.vatRate,
        vat_amount: x.vatAmount,
        withholding_amount: x.withholdingAmount,
        settles: x.settles,
      }),
    ),
  });
}

export function parsePostResult(data: unknown): PostResult {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const raw = typeof d.outcome === "string" ? d.outcome : "unknown";
  const outcome = (POST_OUTCOMES as readonly string[]).includes(raw) ? (raw as PostOutcome) : "unknown";
  const ok = OK_POST.has(outcome);
  return {
    ok,
    outcome,
    entryIds: strings(d.entry_ids),
    openItemId: str(d.open_item_id),
    redated: d.redated === true,
    reversed: d.reversed === true,
    message: ok ? null : postingMessage(outcome),
  };
}

export function parseReverseResult(data: unknown): ReverseResult {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const raw = typeof d.outcome === "string" ? d.outcome : "unknown";
  const outcome = (REVERSE_OUTCOMES as readonly string[]).includes(raw) ? (raw as ReverseOutcome) : "unknown";
  const ok = OK_REVERSE.has(outcome);
  return {
    ok,
    outcome,
    entryIds: strings(d.entry_ids),
    openItemId: str(d.open_item_id),
    reversalIds: strings(d.reversal_ids),
    reversalDate: str(d.reversal_date),
    message: ok ? null : postingMessage(outcome),
  };
}

/** Tek kayıt servisi: olay bir kez yazılır; aynı anahtarla tekrar çağrı `duplicate` (ok) döner. */
export async function financePost(supabase: SupabaseClient, event: PostingEvent): Promise<PostResult> {
  if (!isPostingEventType(event.eventType) || !isPostingKey(event.postingKey, event.eventType)) {
    return parsePostResult({ outcome: !isPostingEventType(event.eventType) ? "unknown_event" : "invalid_key" });
  }
  const { data, error } = await supabase.rpc("finance_post", { p_event: toEventPayload(event) });
  if (error) {
    console.error("financePost", { code: error.code, event: event.eventType });
    const outcome = typeof error.message === "string" && error.message.includes("DONEM_KILITLI") ? "period_locked" : "rpc_error";
    return { ok: false, outcome, entryIds: [], openItemId: null, redated: false, reversed: false, message: postingMessage(outcome) };
  }
  return parsePostResult(data);
}

/** Ters kayıt: açık dönemde iptal; kilitli dönemde ilk açık aya `reversal_of` bağlı ayna kayıt. Hiçbir şey silinmez. */
export async function financeReverse(
  supabase: SupabaseClient,
  args: { targetId: string; reason: string; date?: string | null },
): Promise<ReverseResult> {
  const { data, error } = await supabase.rpc("finance_reverse", {
    p_target: args.targetId,
    p_reason: args.reason,
    p_date: args.date ?? null,
  });
  if (error) {
    console.error("financeReverse", { code: error.code });
    return { ok: false, outcome: "rpc_error", entryIds: [], openItemId: null, reversalIds: [], reversalDate: null, message: postingMessage("rpc_error") };
  }
  return parseReverseResult(data);
}
