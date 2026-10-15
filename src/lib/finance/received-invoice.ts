/**
 * Gelen fatura (`invoice.received`) ve platform abonelik faturası (`subscription.invoiced`) olay kurucuları (SAF).
 * Kayıt servisi tek kapıdır (`financePost`, 20261017010000); burada yalnız girdi doğrulaması ve olay biçimi var.
 *
 *  - Gelen fatura: tedarikçiye BORÇ (KDV dahil tutar) + indirilecek KDV fatura tarihinde; gider fatura tarihinde.
 *    Ödeme sonra Cari ekranından hesap seçilerek kapatılır (nakit bu olayda yazılmaz).
 *  - Abonelik faturası: fiş kutusunda ÖNERİ olarak görünür; kullanıcı onaylamadan deftere yazılmaz (otomatik kayıt yok).
 */
import { invoiceReceivedKey, subscriptionKey } from "@/lib/finance/posting/keys";
import type { PostingEvent } from "@/lib/finance/posting/client";
import { categoriesFor, SALARY_CATEGORY } from "@/lib/finance/cash/categories";
import { LEDGER_VAT_RATES } from "@/lib/finance/ledger/vat";
import { vatBreakdown } from "@/lib/finance/expense-budget";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function validDay(v: unknown): string | null {
  if (typeof v !== "string" || !ISO_DAY.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/** Gelen faturada seçilebilen gider kategorileri (maaş fatura gideri değildir). */
export const RECEIVED_INVOICE_CATEGORIES = categoriesFor("out").filter((c) => c.value !== SALARY_CATEGORY);

export type ReceivedInvoiceInput = {
  /** İstemcinin form başına ürettiği kimlik (çift tıklama tek kayıt). */
  requestId: string;
  vendor: string;
  invoiceNo?: string | null;
  /** Fatura tarihi (YYYY-MM-DD). */
  date: string;
  dueDate?: string | null;
  /** KDV dahil fatura toplamı. */
  amount: number;
  vatRate: number;
  category: string;
};

export type ReceivedInvoiceParse = { ok: true; event: PostingEvent } | { ok: false; error: string };

export function buildReceivedInvoiceEvent(input: ReceivedInvoiceInput): ReceivedInvoiceParse {
  const requestId = String(input?.requestId ?? "").trim();
  if (!UUID_RE.test(requestId)) return { ok: false, error: "Form süresi doldu. Sayfayı yenileyip yeniden deneyin." };
  const vendor = String(input?.vendor ?? "").replace(/\s+/g, " ").trim();
  if (vendor.length < 2 || vendor.length > 120) return { ok: false, error: "Faturayı kesen firmanın adını yazın (en çok 120 karakter)." };
  const invoiceNo = String(input?.invoiceNo ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  const date = validDay(input?.date);
  if (!date) return { ok: false, error: "Fatura tarihini seçin." };
  const due = input?.dueDate ? validDay(input.dueDate) : null;
  if (input?.dueDate && !due) return { ok: false, error: "Son ödeme tarihi geçersiz." };
  if (due && due < date) return { ok: false, error: "Son ödeme tarihi fatura tarihinden önce olamaz." };
  const amount = Math.round(Number(input?.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount < 0.01 || amount > 9_999_999_999.99) return { ok: false, error: "Fatura toplamını (KDV dahil) yazın." };
  const vatRate = Number(input?.vatRate);
  if (!(LEDGER_VAT_RATES as readonly number[]).includes(vatRate)) return { ok: false, error: "KDV oranını seçin." };
  const category = String(input?.category ?? "").trim();
  if (!RECEIVED_INVOICE_CATEGORIES.some((c) => c.value === category)) return { ok: false, error: "Gider kategorisini seçin." };
  const { vat } = vatBreakdown(amount, vatRate, true);
  const title = `Gelen fatura${invoiceNo ? ` ${invoiceNo}` : ""} — ${vendor}`.slice(0, 160);
  return {
    ok: true,
    event: {
      eventType: "invoice.received",
      postingKey: invoiceReceivedKey(requestId),
      date,
      partyName: vendor,
      partyKind: "tedarikci",
      title,
      item: { amount, vatRate, vatAmount: vat, category, dueDate: due ?? undefined, title },
    },
  };
}

/** Platform (EmlakSoft) abonelik faturası satırı (`invoices`, ofisin kendi faturaları; RLS ile okunur). */
export type PlatformInvoice = {
  id: string;
  invoice_no: string;
  status: string;
  total_try: number | string;
  tax_try: number | string | null;
  paid_at: string | null;
  created_at: string;
};

export type SubscriptionSuggestion = {
  id: string;
  invoiceNo: string;
  amount: number;
  vat: number;
  /** Fatura tarihi (YYYY-MM-DD, İstanbul). */
  date: string;
  paid: boolean;
};

const istanbulDay = (iso: string): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(iso));

/** Deftere henüz işlenmemiş (öneri) abonelik faturaları; iptal/taslak ve sıfır tutarlı satır önerilmez. */
export function subscriptionSuggestions(invoices: readonly PlatformInvoice[], recorded: ReadonlySet<string>): SubscriptionSuggestion[] {
  const out: SubscriptionSuggestion[] = [];
  for (const inv of invoices) {
    if (recorded.has(inv.id)) continue;
    if (inv.status !== "paid" && inv.status !== "open") continue;
    const amount = Math.round(Number(inv.total_try) * 100) / 100;
    if (!(amount >= 0.01)) continue;
    const vat = Math.round(Math.min(Math.max(Number(inv.tax_try) || 0, 0), amount) * 100) / 100;
    out.push({ id: inv.id, invoiceNo: inv.invoice_no, amount, vat, date: istanbulDay(inv.created_at), paid: inv.status === "paid" });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Kullanıcı onayıyla abonelik faturası → yazılım gideri borcu (`subscription:{id}`; tekrar onay tek kayıt). */
export function buildSubscriptionEvent(s: SubscriptionSuggestion): PostingEvent {
  const title = `EmlakSoft abonelik faturası ${s.invoiceNo}`.slice(0, 160);
  return {
    eventType: "subscription.invoiced",
    postingKey: subscriptionKey(s.id),
    date: s.date,
    sourceId: s.id,
    partyName: "EmlakSoft",
    partyKind: "tedarikci",
    title,
    item: { amount: s.amount, vatAmount: s.vat, title },
  };
}
