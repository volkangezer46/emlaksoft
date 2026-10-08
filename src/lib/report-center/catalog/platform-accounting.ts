/**
 * Platform raporu — muhasebeci fatura defteri (eski "Muhasebeci CSV" dışa aktarımının yerini alır).
 * Veri kaynağı ve süzgeçler muhasebe sayfalarıyla AYNI okuyuculardır (`lib/accounting`); tutarlar kuruştan TL'ye çevrilir.
 */
import { INVOICE_KIND_LABELS, INVOICE_STATUS_LABELS, LEDGER_STATUS_FILTER_LABELS, PAYMENT_METHOD_LABELS, matchesLedger, parseLedgerFilter, vatRatePercent, type LedgerInvoice, type LedgerParams } from "@/lib/accounting/ledger";
import { resolvePeriod } from "@/lib/accounting/period";
import { now } from "@/lib/clock";
import { DATE_RANGE_FIELDS } from "../filters";
import { defineReport, opts } from "./define";

const tl = (kurus: number) => Math.round(kurus) / 100;
const PERIODS = [
  { value: "bu-ay", label: "Bu ay" },
  { value: "gecen-ay", label: "Geçen ay" },
  { value: "tumu", label: "Tüm zamanlar" },
];

export const muhasebeFaturaDefteri = defineReport({
  id: "muhasebe-fatura-defteri",
  title: "Muhasebe fatura defteri",
  description: "Muhasebeci formatında fatura defteri: ofis unvanı, vergi dairesi / no, net tutar, KDV, toplam, durum, ödeme yöntemi, kupon, iade ve hesap kredisiyle ödenen tutar.",
  category: "gelir",
  scope: "platform",
  platformModule: "billing",
  personalData: true,
  keywords: ["muhasebeci", "kdv", "vergi", "fatura defteri", "iade"],
  filters: [
    { kind: "select", key: "donem", label: "Dönem", options: PERIODS },
    ...DATE_RANGE_FIELDS("Özel dönem başlangıcı", "Özel dönem bitişi"),
    { kind: "select", key: "durum", label: "Durum", options: opts(LEDGER_STATUS_FILTER_LABELS) },
    { kind: "select", key: "tur", label: "Fatura türü", options: opts(INVOICE_KIND_LABELS) },
    { kind: "select", key: "yontem", label: "Ödeme yöntemi", options: opts(PAYMENT_METHOD_LABELS) },
    { kind: "text", key: "q", label: "Arama", placeholder: "Fatura no / ofis" },
  ],
  columns: [
    { key: "no", label: "Fatura no", type: "text", width: 18, get: (r: LedgerInvoice) => r.invoiceNo },
    { key: "tarih", label: "Fatura tarihi", type: "date", get: (r: LedgerInvoice) => r.createdAt },
    { key: "odeme", label: "Ödeme tarihi", type: "date", get: (r: LedgerInvoice) => r.paidAt },
    { key: "ofis", label: "Ofis unvanı", type: "text", width: 30, get: (r: LedgerInvoice) => r.tenantName },
    { key: "vd", label: "Vergi dairesi", type: "text", width: 18, get: (r: LedgerInvoice) => r.taxOffice },
    { key: "vn", label: "Vergi no", type: "text", width: 14, get: (r: LedgerInvoice) => r.taxNumber },
    { key: "tur", label: "Tür", type: "text", width: 16, get: (r: LedgerInvoice) => INVOICE_KIND_LABELS[r.kind] },
    { key: "net", label: "Net tutar", type: "money", total: true, get: (r: LedgerInvoice) => tl(r.netKurus) },
    { key: "oran", label: "KDV oranı", type: "percent", decimals: 0, get: (r: LedgerInvoice) => vatRatePercent(r) },
    { key: "kdv", label: "KDV tutarı", type: "money", total: true, get: (r: LedgerInvoice) => tl(r.taxKurus) },
    { key: "toplam", label: "Toplam", type: "money", total: true, get: (r: LedgerInvoice) => tl(r.grossKurus) },
    { key: "durum", label: "Durum", type: "text", width: 14, get: (r: LedgerInvoice) => INVOICE_STATUS_LABELS[r.status] ?? r.status },
    { key: "yontem", label: "Ödeme yöntemi", type: "text", width: 16, get: (r: LedgerInvoice) => PAYMENT_METHOD_LABELS[r.method] },
    { key: "kupon", label: "Kupon", type: "text", width: 14, get: (r: LedgerInvoice) => r.couponCode },
    { key: "iade", label: "İade tutarı", type: "money", total: true, get: (r: LedgerInvoice) => tl(r.refundKurus) },
    { key: "kredi", label: "Hesap kredisiyle ödenen", type: "money", total: true, get: (r: LedgerInvoice) => tl(r.walletCreditKurus) },
  ],
  source: {
    kind: "compute",
    run: async (ctx, f) => {
      // Sunucu-yalnız okuyucular tembel yüklenir (katalog sözleşme testlerinde yüklenmez).
      const { enrichPage, iterateInvoicePages, LEDGER_MAX_ROWS } = await import("@/lib/accounting/loaders");
      const params: LedgerParams = {};
      for (const key of ["donem", "from", "to", "durum", "tur", "yontem", "q"] as const) if (f[key]) params[key] = f[key];
      const nowMs = now();
      const period = resolvePeriod(params, nowMs);
      const filter = parseLedgerFilter(params);
      const mode = filter.durum === "iade" ? "refund" : "accounting";
      const out: LedgerInvoice[] = [];
      const seen = new Set<string>();
      outer: for await (const page of iterateInvoicePages(ctx.supabase, period, mode)) {
        const fresh = page.filter((r) => !seen.has(r.id));
        for (const r of fresh) seen.add(r.id);
        for (const inv of await enrichPage(ctx.supabase, fresh)) if (matchesLedger(inv, filter, period, nowMs)) out.push(inv);
        if (seen.size >= LEDGER_MAX_ROWS) break outer;
      }
      return out;
    },
  },
});
