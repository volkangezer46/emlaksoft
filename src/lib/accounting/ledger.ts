/**
 * Muhasebe fatura modeli (SAF: DB/sunucu bağımlılığı yok; sunucu ve test ortak).
 * Tüm tutarlar KURUŞ (tam sayı) olarak tutulur: float toplama kayması olmaz.
 *
 * Kaynak sözleşmesi (invoices tablosu): amount_try = KDV HARİÇ net, tax_try = KDV, total_try = brüt.
 * Tür: meta.kind ('extra_seats' | 'credit_pack'); kind yoksa plan faturasıdır (meta.plan / subscription_id).
 * Ödeme yöntemi: meta.manual_payment.method (elle), meta.paidWith='account_credit' (tamamı hesap kredisi) ya da iyzico_payment_id (kart).
 * Hesap kredisi payı: meta.walletCreditTry (000500 SQL'i yazar; karma ödemede kalan nakit meta.walletCashTry).
 * İade: meta.refund = { amount_try (BRÜT), reason, at } (recordInvoiceRefund; faturada durum "paid" kalır).
 */
import { inPeriod, type Period } from "@/lib/accounting/period";
import { MANUAL_PAYMENT_METHODS } from "@/lib/billing/invoice-ops";

export type InvoiceKind = "plan" | "extra_seats" | "credit_pack" | "other";

export const INVOICE_KIND_LABELS: Record<InvoiceKind, string> = {
  plan: "Abonelik planı",
  extra_seats: "Ek koltuk",
  credit_pack: "Kontör paketi",
  other: "Diğer",
};
export const INVOICE_KINDS = Object.keys(INVOICE_KIND_LABELS) as InvoiceKind[];

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: "Taslak",
  open: "Açık",
  paid: "Ödendi",
  void: "İptal",
  uncollectible: "Tahsil edilemez",
};

export type PaymentMethodCode = "iyzico" | "hesap_kredisi" | "havale" | "nakit" | "kart_pos" | "diger" | "belirsiz";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodCode, string> = {
  iyzico: "Kart (iyzico)",
  hesap_kredisi: "Hesap kredisi",
  havale: MANUAL_PAYMENT_METHODS.find((m) => m.value === "havale")?.label ?? "Havale / EFT",
  nakit: "Nakit",
  kart_pos: "POS / kart (elle)",
  diger: "Diğer (elle)",
  belirsiz: "Belirsiz",
};
export const PAYMENT_METHOD_CODES = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethodCode[];

/** Veritabanından gelen ham fatura satırı (yalnız muhasebe için gereken alanlar). */
export type RawInvoiceRow = {
  id: string;
  tenant_id: string;
  subscription_id?: string | null;
  invoice_no: string | null;
  status: string;
  amount_try: number | string | null;
  tax_try: number | string | null;
  total_try: number | string | null;
  currency?: string | null;
  due_at: string | null;
  paid_at: string | null;
  created_at: string;
  iyzico_payment_id?: string | null;
  meta?: unknown;
  tenant?: unknown;
};

export type LedgerInvoice = {
  id: string;
  invoiceNo: string;
  tenantId: string;
  tenantName: string;
  taxOffice: string;
  taxNumber: string;
  status: string;
  /** KDV hariç net (kuruş). */
  netKurus: number;
  /** KDV tutarı (kuruş). */
  taxKurus: number;
  /** Brüt toplam (kuruş). */
  grossKurus: number;
  currency: string;
  createdAt: string;
  paidAt: string | null;
  dueAt: string | null;
  kind: InvoiceKind;
  method: PaymentMethodCode;
  /** İade BRÜT tutarı (kuruş), yoksa 0. */
  refundKurus: number;
  refundAt: string | null;
  /** Hesap kredisi ile ödenen kısım (kuruş), yoksa 0 (meta.walletCreditTry). */
  walletCreditKurus: number;
  couponCode: string | null;
  couponDiscountKurus: number;
};

export function toKurus(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function first<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export function classifyInvoiceKind(meta: unknown, subscriptionId?: string | null): InvoiceKind {
  const m = asRecord(meta);
  const kind = typeof m.kind === "string" ? m.kind : null;
  if (kind === "extra_seats") return "extra_seats";
  if (kind === "credit_pack") return "credit_pack";
  if (kind === null || kind === "plan" || kind === "plan_renewal" || kind === "subscription") {
    if (typeof m.plan === "string" || subscriptionId || kind !== null) return "plan";
    return "other";
  }
  return "other";
}

export function paymentMethodOf(meta: unknown, iyzicoPaymentId?: string | null): PaymentMethodCode {
  const manual = asRecord(asRecord(meta).manual_payment);
  const m = typeof manual.method === "string" ? manual.method : null;
  if (m && MANUAL_PAYMENT_METHODS.some((x) => x.value === m)) return m as PaymentMethodCode;
  if (m) return "diger";
  if (asRecord(meta).paidWith === "account_credit") return "hesap_kredisi";
  if (iyzicoPaymentId) return "iyzico";
  return "belirsiz";
}

export function refundOf(meta: unknown): { kurus: number; at: string | null } {
  const r = asRecord(asRecord(meta).refund);
  const kurus = toKurus(r.amount_try);
  if (kurus <= 0) return { kurus: 0, at: null };
  return { kurus, at: typeof r.at === "string" ? r.at : null };
}

/** Hesap kredisi ile ödenen kısım (kuruş). Alan yoksa/geçersizse 0; uydurma yok. */
export function walletCreditOf(meta: unknown): number {
  const kurus = toKurus(asRecord(meta).walletCreditTry);
  return kurus > 0 ? kurus : 0;
}

export function toLedgerInvoice(
  row: RawInvoiceRow,
  coupon?: { code: string | null; discountKurus: number } | null,
): LedgerInvoice {
  const tenant = asRecord(first(row.tenant as unknown));
  const refund = refundOf(row.meta);
  return {
    id: row.id,
    invoiceNo: row.invoice_no ?? "",
    tenantId: row.tenant_id,
    tenantName: typeof tenant.name === "string" ? tenant.name : "",
    taxOffice: typeof tenant.tax_office === "string" ? tenant.tax_office : "",
    taxNumber: typeof tenant.tax_number === "string" ? tenant.tax_number : "",
    status: row.status,
    netKurus: toKurus(row.amount_try),
    taxKurus: toKurus(row.tax_try),
    grossKurus: toKurus(row.total_try),
    currency: row.currency ?? "TRY",
    createdAt: row.created_at,
    paidAt: row.paid_at,
    dueAt: row.due_at,
    kind: classifyInvoiceKind(row.meta, row.subscription_id),
    method: paymentMethodOf(row.meta, row.iyzico_payment_id),
    refundKurus: refund.kurus,
    refundAt: refund.at,
    walletCreditKurus: walletCreditOf(row.meta),
    couponCode: coupon?.code ?? null,
    couponDiscountKurus: coupon?.discountKurus ?? 0,
  };
}

/** KDV oranı (yüzde, 2 ondalığa yuvarlı). Net sıfırsa 0. */
export function vatRatePercent(inv: Pick<LedgerInvoice, "netKurus" | "taxKurus">): number {
  if (inv.netKurus <= 0) return 0;
  return Math.round((inv.taxKurus / inv.netKurus) * 10000) / 100;
}

/** Muhasebe tarihi: ödeme tarihi varsa o, yoksa oluşturma tarihi (sorgudaki OR koşuluyla aynı kural). */
export function accountingDate(inv: Pick<LedgerInvoice, "paidAt" | "createdAt">): string {
  return inv.paidAt ?? inv.createdAt;
}

export function isOverdue(inv: Pick<LedgerInvoice, "status" | "dueAt">, nowMs: number): boolean {
  return inv.status === "open" && inv.dueAt !== null && Date.parse(inv.dueAt) < nowMs;
}

/** İadenin net/KDV kırılımı: iade BRÜT tutardır; fatura oranında bölünür (net = brüt × net/brüt). */
export function refundSplit(inv: Pick<LedgerInvoice, "netKurus" | "grossKurus" | "refundKurus">): { net: number; tax: number; gross: number } {
  const gross = inv.refundKurus;
  if (gross <= 0) return { net: 0, tax: 0, gross: 0 };
  const net = inv.grossKurus > 0 ? Math.round((gross * inv.netKurus) / inv.grossKurus) : gross;
  return { net, tax: gross - net, gross };
}

// ---------------------------------------------------------------------------
// Özet
// ---------------------------------------------------------------------------
export type Money3 = { count: number; net: number; tax: number; gross: number };
const zero3 = (): Money3 => ({ count: 0, net: 0, tax: 0, gross: 0 });
function add3(t: Money3, inv: Pick<LedgerInvoice, "netKurus" | "taxKurus" | "grossKurus">) {
  t.count += 1;
  t.net += inv.netKurus;
  t.tax += inv.taxKurus;
  t.gross += inv.grossKurus;
}

export type LedgerSummary = {
  collected: Money3;
  refunds: Money3;
  /** Brüt tahsilat − brüt iade. */
  netOfRefundsGross: number;
  byKind: Record<InvoiceKind, Money3>;
  byMethod: Record<PaymentMethodCode, Money3>;
  coupon: { count: number; discountKurus: number };
  /** Dönemde tahsil edilen faturalarda hesap kredisiyle ödenen toplam (karma ödemelerin kredi payı dahil; kuruş). */
  walletCreditKurus: number;
  /** Anlık (dönemden bağımsız): vadesi gelmemiş açık faturalar. */
  pending: { count: number; gross: number };
  /** Anlık: vadesi geçmiş açık faturalar. */
  overdue: { count: number; gross: number };
};

/**
 * `rows`: dönemde muhasebe tarihi ya da iade tarihi düşen faturalar.
 * `openRows`: tüm zamanların açık faturaları (bekleyen/gecikmiş anlık görüntü).
 * Tahsilat = durumu "paid" ve ödeme tarihi dönemde; iade = iade tarihi dönemde.
 */
export function summarizeLedger(rows: readonly LedgerInvoice[], openRows: readonly LedgerInvoice[], period: Period, nowMs: number): LedgerSummary {
  const collected = zero3();
  const refunds = zero3();
  const byKind = Object.fromEntries(INVOICE_KINDS.map((k) => [k, zero3()])) as Record<InvoiceKind, Money3>;
  const byMethod = Object.fromEntries(PAYMENT_METHOD_CODES.map((k) => [k, zero3()])) as Record<PaymentMethodCode, Money3>;
  const coupon = { count: 0, discountKurus: 0 };
  let walletCreditKurus = 0;

  for (const inv of rows) {
    if (isCollectedIn(inv, period)) {
      add3(collected, inv);
      walletCreditKurus += inv.walletCreditKurus;
      add3(byKind[inv.kind], inv);
      add3(byMethod[inv.method], inv);
      if (inv.couponDiscountKurus > 0) {
        coupon.count += 1;
        coupon.discountKurus += inv.couponDiscountKurus;
      }
    }
    if (isRefundedIn(inv, period)) {
      const s = refundSplit(inv);
      refunds.count += 1;
      refunds.net += s.net;
      refunds.tax += s.tax;
      refunds.gross += s.gross;
    }
  }

  const pending = { count: 0, gross: 0 };
  const overdue = { count: 0, gross: 0 };
  for (const inv of openRows) {
    if (inv.status !== "open") continue;
    const bucket = isOverdue(inv, nowMs) ? overdue : pending;
    bucket.count += 1;
    bucket.gross += inv.grossKurus;
  }

  return { collected, refunds, netOfRefundsGross: collected.gross - refunds.gross, byKind, byMethod, coupon, walletCreditKurus, pending, overdue };
}

export function isCollectedIn(inv: LedgerInvoice, period: Pick<Period, "fromIso" | "toIso">): boolean {
  return inv.status === "paid" && inPeriodOrUnbounded(inv.paidAt ?? inv.createdAt, period);
}

export function isRefundedIn(inv: LedgerInvoice, period: Pick<Period, "fromIso" | "toIso">): boolean {
  return inv.refundKurus > 0 && inPeriodOrUnbounded(inv.refundAt, period);
}

function inPeriodOrUnbounded(iso: string | null, period: Pick<Period, "fromIso" | "toIso">): boolean {
  if (!period.fromIso && !period.toIso) return true;
  return inPeriod(iso, period);
}

// ---------------------------------------------------------------------------
// Defter filtresi
// ---------------------------------------------------------------------------
export const LEDGER_STATUS_FILTERS = ["paid", "open", "gecikmis", "draft", "void", "uncollectible", "iade"] as const;
export type LedgerStatusFilter = (typeof LEDGER_STATUS_FILTERS)[number];

export const LEDGER_STATUS_FILTER_LABELS: Record<LedgerStatusFilter, string> = {
  paid: "Ödendi",
  open: "Açık",
  gecikmis: "Gecikmiş",
  draft: "Taslak",
  void: "İptal",
  uncollectible: "Tahsil edilemez",
  iade: "İade edilen",
};

export type LedgerFilter = {
  durum?: LedgerStatusFilter;
  tur?: InvoiceKind;
  yontem?: PaymentMethodCode;
  /** Ofis kimliği (tam eşleşme). */
  ofis?: string;
  /** Yalnız kupon kullanılan faturalar. */
  kupon?: boolean;
  /** Fatura no / ofis unvanı araması. */
  q?: string;
  /** Brüt tutar aralığı (kuruş, uçlar dahil). */
  minKurus?: number;
  maxKurus?: number;
};

const TR_LOWER = (s: string) => s.toLocaleLowerCase("tr-TR");

/** Satır dönem + filtre koşullarını sağlıyor mu? ("iade" görünümü iade tarihine, diğerleri muhasebe tarihine bakar.) */
export function matchesLedger(inv: LedgerInvoice, f: LedgerFilter, period: Pick<Period, "fromIso" | "toIso">, nowMs: number): boolean {
  if (f.durum === "iade") {
    if (!isRefundedIn(inv, period)) return false;
  } else if (!inPeriodOrUnbounded(accountingDate(inv), period)) {
    return false;
  }
  if (f.durum === "gecikmis") {
    if (!isOverdue(inv, nowMs)) return false;
  } else if (f.durum && f.durum !== "iade" && inv.status !== f.durum) {
    return false;
  }
  if (f.tur && inv.kind !== f.tur) return false;
  if (f.yontem && inv.method !== f.yontem) return false;
  if (f.ofis && inv.tenantId !== f.ofis) return false;
  if (f.kupon && inv.couponDiscountKurus <= 0) return false;
  if (f.minKurus !== undefined && inv.grossKurus < f.minKurus) return false;
  if (f.maxKurus !== undefined && inv.grossKurus > f.maxKurus) return false;
  if (f.q) {
    const q = TR_LOWER(f.q.trim());
    if (q && !TR_LOWER(inv.invoiceNo).includes(q) && !TR_LOWER(inv.tenantName).includes(q)) return false;
  }
  return true;
}

export function totalsOf(rows: readonly LedgerInvoice[]): Money3 {
  const t = zero3();
  for (const r of rows) add3(t, r);
  return t;
}

// ---------------------------------------------------------------------------
// Sorgu parametreleri
// ---------------------------------------------------------------------------
export type LedgerParams = {
  donem?: string;
  from?: string;
  to?: string;
  durum?: string;
  tur?: string;
  yontem?: string;
  ofis?: string;
  kupon?: string;
  q?: string;
  min?: string;
  max?: string;
  sayfa?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "1.234,56" / "1234.56" -> kuruş (>=0, en çok 2 ondalık); geçersiz undefined. */
export function parseTlToKurus(raw: string | undefined): number | undefined {
  let s = (raw ?? "").trim().replace(/\s/g, "").replace(/₺|TRY|TL/gi, "");
  if (!s) return undefined;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n <= 100_000_000 ? Math.round(n * 100) : undefined;
}

export function parseLedgerFilter(p: LedgerParams): LedgerFilter {
  const f: LedgerFilter = {};
  if ((LEDGER_STATUS_FILTERS as readonly string[]).includes(p.durum ?? "")) f.durum = p.durum as LedgerStatusFilter;
  if ((INVOICE_KINDS as readonly string[]).includes(p.tur ?? "")) f.tur = p.tur as InvoiceKind;
  if ((PAYMENT_METHOD_CODES as readonly string[]).includes(p.yontem ?? "")) f.yontem = p.yontem as PaymentMethodCode;
  if (p.ofis && UUID.test(p.ofis)) f.ofis = p.ofis;
  if (p.kupon === "1") f.kupon = true;
  const q = (p.q ?? "").trim().slice(0, 80);
  if (q) f.q = q;
  const min = parseTlToKurus(p.min);
  const max = parseTlToKurus(p.max);
  if (min !== undefined) f.minKurus = min;
  if (max !== undefined) f.maxKurus = max;
  return f;
}

/** Filtreyi URL parametrelerine geri çevirir (bağlantılar/dışa aktarım için; boş değer yazılmaz). */
export function ledgerFilterParams(f: LedgerFilter): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.durum) out.durum = f.durum;
  if (f.tur) out.tur = f.tur;
  if (f.yontem) out.yontem = f.yontem;
  if (f.ofis) out.ofis = f.ofis;
  if (f.kupon) out.kupon = "1";
  if (f.q) out.q = f.q;
  if (f.minKurus !== undefined) out.min = (f.minKurus / 100).toFixed(2).replace(".", ",");
  if (f.maxKurus !== undefined) out.max = (f.maxKurus / 100).toFixed(2).replace(".", ",");
  return out;
}

// ---------------------------------------------------------------------------
// Ofis 360 finans özeti
// ---------------------------------------------------------------------------
export type OfficeFinance = {
  paidCount: number;
  paidGross: number;
  refundGross: number;
  /** Brüt ödeme − brüt iade. */
  netPaidGross: number;
  lastPaidAt: string | null;
  openCount: number;
  openGross: number;
  overdueCount: number;
};

export function summarizeOffice(rows: readonly LedgerInvoice[], nowMs: number): OfficeFinance {
  const out: OfficeFinance = { paidCount: 0, paidGross: 0, refundGross: 0, netPaidGross: 0, lastPaidAt: null, openCount: 0, openGross: 0, overdueCount: 0 };
  for (const inv of rows) {
    if (inv.status === "paid") {
      out.paidCount += 1;
      out.paidGross += inv.grossKurus;
      out.refundGross += inv.refundKurus;
      const at = inv.paidAt ?? inv.createdAt;
      if (!out.lastPaidAt || Date.parse(at) > Date.parse(out.lastPaidAt)) out.lastPaidAt = at;
    } else if (inv.status === "open") {
      out.openCount += 1;
      out.openGross += inv.grossKurus;
      if (isOverdue(inv, nowMs)) out.overdueCount += 1;
    }
  }
  out.netPaidGross = out.paidGross - out.refundGross;
  return out;
}
