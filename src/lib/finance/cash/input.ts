import { parseMoneyInput } from "@/lib/money-input";
import { parseReceiptUrl } from "@/lib/expense-input";
import { isIsoDate } from "@/lib/workflow-state";
import { cashCategoryLabel, isCashCategory, type CashDirection } from "./categories";

/**
 * Hızlı gelir/gider ve hesap formu girdi doğrulaması (SAF, sunucuda action'lar kullanır; nihai kural RPC'dedir).
 * Zorunlu 3 alan: tutar, ne için (kategori), hangi hesap. Tarih verilmezse bugün (çağıran `today` geçirir).
 */
export const ENTRY_LIMITS = { title: 160, counterparty: 120, note: 1000, accountName: 80, max: 9_999_999_999.99 } as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v.trim());

export type ParsedEntry = {
  accountId: string;
  direction: CashDirection;
  amount: number;
  date: string;
  category: string;
  title: string;
  counterparty: string | null;
  documentUrl: string | null;
  note: string | null;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

type RawEntry = Record<string, FormDataEntryValue | string | number | null | undefined>;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

export function parseEntryInput(raw: RawEntry, direction: CashDirection, today: string): ParseResult<ParsedEntry> {
  const accountId = str(raw.accountId);
  if (!isUuid(accountId)) return { ok: false, error: "Hangi hesap olduğunu seçin." };

  const amount = parseMoneyInput(raw.amount as string | number | null | undefined, { max: ENTRY_LIMITS.max });
  if (!amount.ok || amount.value == null || amount.value <= 0) return { ok: false, error: "Geçerli, en çok iki ondalık haneli bir tutar girin." };

  const category = str(raw.category);
  if (!isCashCategory(category, direction)) return { ok: false, error: "Ne için olduğunu seçin." };

  const dateRaw = str(raw.date);
  const date = dateRaw || today;
  if (!isIsoDate(date)) return { ok: false, error: "Geçerli bir tarih girin." };
  if (date > today) return { ok: false, error: "Tarih gelecekte olamaz." };
  if (date < "2000-01-01") return { ok: false, error: "Tarih çok eski." };

  // "Ne için" açıklaması boşsa başlık kategori adından gelir.
  const title = str(raw.title) || cashCategoryLabel(category);
  if (title.length > ENTRY_LIMITS.title) return { ok: false, error: `Açıklama en fazla ${ENTRY_LIMITS.title} karakter olabilir.` };
  const counterparty = str(raw.counterparty);
  if (counterparty.length > ENTRY_LIMITS.counterparty) return { ok: false, error: `Karşı taraf en fazla ${ENTRY_LIMITS.counterparty} karakter olabilir.` };
  const note = str(raw.note);
  if (note.length > ENTRY_LIMITS.note) return { ok: false, error: `Not en fazla ${ENTRY_LIMITS.note} karakter olabilir.` };
  const doc = parseReceiptUrl(str(raw.documentUrl));
  if (!doc.ok) return { ok: false, error: doc.error.replace("Fiş bağlantısı", "Belge bağlantısı") };

  return {
    ok: true,
    value: { accountId, direction, amount: amount.value, date, category, title, counterparty: counterparty || null, documentUrl: doc.value, note: note || null },
  };
}

export const ACCOUNT_KINDS = ["cash", "bank", "card"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = { cash: "Kasa (nakit)", bank: "Banka hesabı", card: "Kredi kartı" };
export const ACCOUNT_CURRENCIES = ["TRY", "USD", "EUR"] as const;
export type AccountCurrency = (typeof ACCOUNT_CURRENCIES)[number];

export type ParsedAccount = {
  scope: "office" | "user";
  kind: AccountKind;
  name: string;
  ibanLast4: string | null;
  currency: AccountCurrency;
  openingBalance: number;
  openingDate: string;
};

export function parseAccountInput(raw: RawEntry, today: string): ParseResult<ParsedAccount> {
  const scope = str(raw.scope) === "user" ? "user" : "office";
  const kind = str(raw.kind) as AccountKind;
  if (!ACCOUNT_KINDS.includes(kind)) return { ok: false, error: "Hesap türünü seçin." };
  const name = str(raw.name);
  if (!name) return { ok: false, error: "Hesaba bir ad verin (ör. Ofis kasası)." };
  if (name.length > ENTRY_LIMITS.accountName) return { ok: false, error: `Hesap adı en fazla ${ENTRY_LIMITS.accountName} karakter olabilir.` };
  const iban = str(raw.ibanLast4).replace(/\s/g, "");
  if (iban && !/^\d{4}$/.test(iban)) return { ok: false, error: "IBAN son 4 hane 4 rakam olmalı." };
  const currency = (str(raw.currency) || "TRY") as AccountCurrency;
  if (!ACCOUNT_CURRENCIES.includes(currency)) return { ok: false, error: "Para birimini seçin." };
  const opening = parseMoneyInput(raw.openingBalance as string | number | null | undefined, { allowZero: true, max: ENTRY_LIMITS.max });
  if (!opening.ok) return { ok: false, error: "Açılış bakiyesi geçerli bir tutar olmalı." };
  // Kredi kartında açılış bakiyesi borç olarak girilir (eksi bakiye).
  const debt = kind === "card" && str(raw.openingIsDebt) === "1";
  const openingBalance = (opening.value ?? 0) * (debt ? -1 : 1);
  const openingDate = str(raw.openingDate) || today;
  if (!isIsoDate(openingDate) || openingDate > today || openingDate < "2000-01-01") return { ok: false, error: "Açılış tarihi geçerli ve bugünden ileri olmayan bir tarih olmalı." };
  return { ok: true, value: { scope, kind, name, ibanLast4: iban || null, currency, openingBalance, openingDate } };
}

/** RPC `outcome` kodlarının kullanıcıya gösterilecek Türkçe karşılığı (kasa/hareket defteri). */
export function financeOutcomeMessage(outcome: string, extra?: { openingDate?: string }): string {
  switch (outcome) {
    case "unauthorized": return "Oturum bulunamadı. Yeniden giriş yapın.";
    case "forbidden": return "Bu işlem için yetkiniz yok.";
    case "invalid_input": return "Girdiğiniz bilgileri kontrol edin (tutar, tarih ve açıklama).";
    case "not_found": return "Kayıt bulunamadı.";
    case "archived": return "Hesap arşivde; önce arşivden çıkarın.";
    case "before_opening": return `Hareket tarihi hesabın açılış tarihinden${extra?.openingDate ? ` (${extra.openingDate})` : ""} önce olamaz.`;
    case "entries_before_opening": return "Bu tarihten önce hareketi olan hesabın açılış tarihi ileri alınamaz.";
    case "duplicate_name": return "Bu adla başka bir hesabınız var.";
    case "limit_reached": return "En fazla 50 etkin hesap açılabilir.";
    case "currency_mismatch": return "Farklı para birimli hesaplar arasında transfer yapılamaz.";
    case "already_voided": return "Bu hareket zaten iptal edilmiş.";
    case "locked": return "Tahsilata veya transfere bağlı hareket düzenlenemez; iptal edip yeniden girin.";
    case "source_not_found": return "Bağlı tahsilat kaydı bulunamadı.";
    default: return "İşlem tamamlanamadı. Sayfayı yenileyip tekrar deneyin.";
  }
}
