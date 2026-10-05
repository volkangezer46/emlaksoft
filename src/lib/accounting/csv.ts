/**
 * Muhasebeci CSV biçimi (SAF). Excel TR uyumlu: UTF-8 BOM, ';' ayırıcı, CRLF, virgüllü ondalık, gg.aa.yyyy tarih.
 * Metin hücreleri HER ZAMAN tırnaklanır; = + - @ TAB CR ile başlayan metin hücreleri formül enjeksiyonuna karşı
 * başına tek tırnak alır. Sayılar tırnaksızdır ve yalnız bu dosyadaki biçimleyiciden gelir (kullanıcı metni değil).
 * Kişisel veri minimizasyonu: yalnız faturalama için gereken alanlar (ofis unvanı, vergi dairesi/no).
 */
import { trParts } from "@/lib/clock";
import {
  INVOICE_KIND_LABELS,
  INVOICE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  vatRatePercent,
  type LedgerInvoice,
} from "@/lib/accounting/ledger";

/** CSV akışı veren route handler (sayfa değil; Link ile ÖN YÜKLENMEZ, düz <a> kullanılır). */
export const ACCOUNTING_EXPORT_PATH = "/admin/muhasebe/disa-aktar";

export const CSV_BOM = "\uFEFF";
export const CSV_SEP = ";";
export const CSV_EOL = "\r\n";

export const ACCOUNTING_CSV_HEADERS = [
  "Fatura No",
  "Fatura Tarihi",
  "Ödeme Tarihi",
  "Ofis Unvanı",
  "Vergi Dairesi",
  "Vergi No",
  "Tür",
  "Net Tutar",
  "KDV Oranı (%)",
  "KDV Tutarı",
  "Toplam",
  "Durum",
  "Ödeme Yöntemi",
  "Kupon",
  "İade Tutarı",
  "Hesap Kredisi ile Ödenen",
] as const;

/** Metin hücresi: tırnakla, iç tırnağı ikile, formül öneklerini kaçır. */
export function csvText(value: string | null | undefined): string {
  let text = (value ?? "").replace(/\r\n|\r|\n/g, " ");
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Kuruş -> "1234,50" (binlik ayırıcı yok: Excel TR sayı olarak okur). */
export function csvMoney(kurus: number): string {
  const sign = kurus < 0 ? "-" : "";
  const abs = Math.abs(Math.round(kurus));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole},${frac}`;
}

/** KDV oranı: 20 -> "20", 18.5 -> "18,5". */
export function csvPercent(p: number): string {
  return String(p).replace(".", ",");
}

/** ISO an -> TR takvim günü "gg.aa.yyyy" (boşsa ""). */
export function csvDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const p = trParts(t);
  return `${String(p.day).padStart(2, "0")}.${String(p.month + 1).padStart(2, "0")}.${p.year}`;
}

export function csvHeaderLine(): string {
  return CSV_BOM + ACCOUNTING_CSV_HEADERS.map((h) => csvText(h)).join(CSV_SEP) + CSV_EOL;
}

export function csvInvoiceLine(inv: LedgerInvoice): string {
  const cells = [
    csvText(inv.invoiceNo),
    csvDate(inv.createdAt),
    csvDate(inv.paidAt),
    csvText(inv.tenantName),
    csvText(inv.taxOffice),
    csvText(inv.taxNumber),
    csvText(INVOICE_KIND_LABELS[inv.kind]),
    csvMoney(inv.netKurus),
    csvPercent(vatRatePercent(inv)),
    csvMoney(inv.taxKurus),
    csvMoney(inv.grossKurus),
    csvText(INVOICE_STATUS_LABELS[inv.status] ?? inv.status),
    csvText(PAYMENT_METHOD_LABELS[inv.method]),
    csvText(inv.couponCode),
    csvMoney(inv.refundKurus),
    csvMoney(inv.walletCreditKurus),
  ];
  return cells.join(CSV_SEP) + CSV_EOL;
}

/** Tek seferde (küçük veri/test) tam CSV. Akış için başlık + satırlar ayrı üretilir. */
export function buildAccountingCsv(rows: readonly LedgerInvoice[]): string {
  return csvHeaderLine() + rows.map(csvInvoiceLine).join("");
}
