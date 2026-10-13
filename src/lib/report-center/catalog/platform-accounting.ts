/**
 * Platform raporları — muhasebe (eski "Muhasebeci CSV" dışa aktarımının yerini alır).
 * Veri kaynağı ve süzgeçler muhasebe sayfalarıyla AYNI okuyuculardır (`lib/accounting`); tutarlar kuruştan TL'ye çevrilir.
 * - Fatura defteri: faturalar + alacak dekontları (dekont tarihinde EKSİ satır).
 * - Tahsilat yaşlandırması: açık faturalar 0-30 / 31-60 / 61-90 / 90+ gün kovalarında (muhasebe kartıyla aynı hesap).
 * - Fatura kalemleri: faturanın satırları (PDF olarak fatura dökümü); satırı olmayan fatura tek satır olarak gelir.
 */
import { INVOICE_KIND_LABELS, INVOICE_STATUS_LABELS, LEDGER_STATUS_FILTER_LABELS, PAYMENT_METHOD_LABELS, matchesLedger, parseLedgerFilter, vatRatePercent, type LedgerInvoice, type LedgerParams } from "@/lib/accounting/ledger";
import { AGING_BUCKET_LABELS, agingBucketOf, daysPastDue, isAgingBucket, type AgingBucket } from "@/lib/accounting/aging";
import { resolvePeriod } from "@/lib/accounting/period";
import { fromRawLine, synthesizeLine, type InvoiceLine, type RawInvoiceLine } from "@/lib/billing/manual-invoice";
import { now } from "@/lib/clock";
import { safeLike } from "@/lib/pgrst";
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
  description:
    "Muhasebeci formatında fatura defteri: ofis unvanı, vergi dairesi / no, net tutar, KDV, toplam, durum, ödeme yöntemi, kupon, iade ve hesap kredisiyle ödenen tutar. Alacak dekontları dekont tarihinde eksi satırdır.",
  category: "gelir",
  scope: "platform",
  platformModule: "billing",
  personalData: true,
  keywords: ["muhasebeci", "kdv", "vergi", "fatura defteri", "iade", "alacak dekontu"],
  filters: [
    { kind: "select", key: "donem", label: "Dönem", options: PERIODS },
    ...DATE_RANGE_FIELDS("Özel dönem başlangıcı", "Özel dönem bitişi"),
    { kind: "select", key: "durum", label: "Durum", options: opts(LEDGER_STATUS_FILTER_LABELS) },
    { kind: "select", key: "tur", label: "Fatura türü", options: opts(INVOICE_KIND_LABELS) },
    { kind: "select", key: "yontem", label: "Ödeme yöntemi", options: opts(PAYMENT_METHOD_LABELS) },
    { kind: "select", key: "yas", label: "Yaşlandırma (açık fatura)", options: opts(AGING_BUCKET_LABELS) },
    { kind: "text", key: "q", label: "Arama", placeholder: "Fatura no / ofis" },
  ],
  columns: [
    { key: "no", label: "Belge no", type: "text", width: 18, get: (r: LedgerInvoice) => r.invoiceNo },
    { key: "belge", label: "Belge türü", type: "text", width: 14, get: (r: LedgerInvoice) => (r.status === "credit_note" ? "Alacak dekontu" : "Fatura") },
    { key: "ilgili", label: "İlgili fatura", type: "text", width: 18, get: (r: LedgerInvoice) => r.refInvoiceNo ?? null },
    { key: "tarih", label: "Belge tarihi", type: "date", get: (r: LedgerInvoice) => r.createdAt },
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
      const { enrichPage, iterateInvoicePages, loadCreditNoteRows, LEDGER_MAX_ROWS } = await import("@/lib/accounting/loaders");
      const params: LedgerParams = {};
      for (const key of ["donem", "from", "to", "durum", "tur", "yontem", "yas", "q"] as const) if (f[key]) params[key] = f[key];
      const nowMs = now();
      const period = resolvePeriod(params, nowMs);
      const filter = parseLedgerFilter(params);
      const mode = filter.durum === "iade" ? "refund" : "accounting";
      const out: LedgerInvoice[] = [];
      const seen = new Set<string>();
      if (filter.durum !== "dekont") {
        outer: for await (const page of iterateInvoicePages(ctx.supabase, period, mode)) {
          const fresh = page.filter((r) => !seen.has(r.id));
          for (const r of fresh) seen.add(r.id);
          for (const inv of await enrichPage(ctx.supabase, fresh)) if (matchesLedger(inv, filter, period, nowMs)) out.push(inv);
          if (seen.size >= LEDGER_MAX_ROWS) break outer;
        }
      }
      // Alacak dekontları: dekont tarihinde eksi satır (iade/yaşlandırma görünümünde süzgeç zaten eler).
      if (seen.size < LEDGER_MAX_ROWS && mode === "accounting") {
        for (const cn of (await loadCreditNoteRows(ctx.supabase, period)).rows) if (matchesLedger(cn, filter, period, nowMs)) out.push(cn);
      }
      return out;
    },
  },
});

type AgingRow = LedgerInvoice & { days: number; bucket: AgingBucket };

export const tahsilatYaslandirma = defineReport({
  id: "tahsilat-yaslandirma",
  title: "Tahsilat yaşlandırması",
  description: "Açık faturalar vadeden bu yana geçen güne göre 0-30 / 31-60 / 61-90 / 90+ gün kovalarında; toplam, muhasebe Bekleyen + Gecikmiş kartlarına eşittir.",
  category: "gelir",
  scope: "platform",
  platformModule: "billing",
  personalData: true,
  keywords: ["alacak", "yaşlandırma", "vade", "gecikmiş", "tahsilat"],
  filters: [
    { kind: "select", key: "yas", label: "Kova", options: opts(AGING_BUCKET_LABELS) },
    { kind: "text", key: "q", label: "Arama", placeholder: "Fatura no / ofis" },
  ],
  columns: [
    { key: "no", label: "Fatura no", type: "text", width: 18, get: (r: AgingRow) => r.invoiceNo },
    { key: "ofis", label: "Ofis unvanı", type: "text", width: 30, get: (r: AgingRow) => r.tenantName },
    { key: "tur", label: "Tür", type: "text", width: 16, get: (r: AgingRow) => INVOICE_KIND_LABELS[r.kind] },
    { key: "tarih", label: "Fatura tarihi", type: "date", get: (r: AgingRow) => r.createdAt },
    { key: "vade", label: "Vade", type: "date", get: (r: AgingRow) => r.dueAt },
    { key: "gun", label: "Vadeden bu yana gün", type: "number", decimals: 0, get: (r: AgingRow) => r.days },
    { key: "kova", label: "Kova", type: "text", width: 12, get: (r: AgingRow) => AGING_BUCKET_LABELS[r.bucket] },
    { key: "toplam", label: "Açık tutar (brüt)", type: "money", total: true, get: (r: AgingRow) => tl(r.grossKurus) },
  ],
  source: {
    kind: "compute",
    run: async (ctx, f) => {
      const { loadOpenInvoices } = await import("@/lib/accounting/loaders");
      const nowMs = now();
      const bucket = isAgingBucket(f.yas) ? f.yas : null;
      const q = (f.q ?? "").trim().toLocaleLowerCase("tr-TR").slice(0, 80);
      const out: AgingRow[] = [];
      for (const inv of await loadOpenInvoices(ctx.supabase)) {
        const days = daysPastDue(inv, nowMs);
        const b = agingBucketOf(days);
        if (bucket && b !== bucket) continue;
        if (q && !inv.invoiceNo.toLocaleLowerCase("tr-TR").includes(q) && !inv.tenantName.toLocaleLowerCase("tr-TR").includes(q)) continue;
        out.push({ ...inv, days, bucket: b });
      }
      return out.sort((a, b) => b.days - a.days || b.grossKurus - a.grossKurus);
    },
  },
});

type LineRow = InvoiceLine & { invoiceNo: string; status: string; createdAt: string; tenantName: string; taxOffice: string; taxNumber: string };

const LINE_INVOICE_LIMIT = 2000;

export const faturaKalemleri = defineReport({
  id: "fatura-kalemleri",
  title: "Fatura kalemleri (fatura dökümü)",
  description: "Faturaların satır kalemleri: açıklama, miktar, KDV hariç birim fiyat, KDV oranı, net, KDV ve toplam. Tek fatura için fatura numarasıyla arayıp PDF alın.",
  category: "gelir",
  scope: "platform",
  platformModule: "billing",
  personalData: true,
  keywords: ["fatura", "kalem", "pdf", "döküm", "tek seferlik", "kurulum"],
  filters: [
    { kind: "text", key: "q", label: "Fatura no", placeholder: "ES-…" },
    { kind: "select", key: "donem", label: "Dönem (fatura tarihi)", options: PERIODS },
    ...DATE_RANGE_FIELDS("Özel dönem başlangıcı", "Özel dönem bitişi"),
  ],
  columns: [
    { key: "no", label: "Fatura no", type: "text", width: 18, get: (r: LineRow) => r.invoiceNo },
    { key: "tarih", label: "Fatura tarihi", type: "date", get: (r: LineRow) => r.createdAt },
    { key: "ofis", label: "Ofis unvanı", type: "text", width: 28, get: (r: LineRow) => r.tenantName },
    { key: "vd", label: "Vergi dairesi", type: "text", width: 16, get: (r: LineRow) => r.taxOffice },
    { key: "vn", label: "Vergi no", type: "text", width: 14, get: (r: LineRow) => r.taxNumber },
    { key: "sira", label: "Sıra", type: "number", decimals: 0, get: (r: LineRow) => r.position },
    { key: "aciklama", label: "Açıklama", type: "text", width: 32, get: (r: LineRow) => r.description },
    { key: "miktar", label: "Miktar", type: "number", decimals: 2, get: (r: LineRow) => r.quantity },
    { key: "birim", label: "Birim fiyat (KDV hariç)", type: "money", get: (r: LineRow) => r.unitNetTry },
    { key: "oran", label: "KDV oranı", type: "percent", decimals: 0, get: (r: LineRow) => Math.round(r.vatRate * 10000) / 100 },
    { key: "net", label: "Net", type: "money", total: true, get: (r: LineRow) => r.netTry },
    { key: "kdv", label: "KDV", type: "money", total: true, get: (r: LineRow) => r.taxTry },
    { key: "toplam", label: "Toplam", type: "money", total: true, get: (r: LineRow) => r.totalTry },
    { key: "durum", label: "Fatura durumu", type: "text", width: 14, get: (r: LineRow) => INVOICE_STATUS_LABELS[r.status] ?? r.status },
  ],
  source: {
    kind: "compute",
    run: async (ctx, f) => {
      const period = resolvePeriod({ donem: f.donem, from: f.from, to: f.to }, now());
      const q = (f.q ?? "").trim().slice(0, 64);
      let iq = ctx.supabase
        .from("invoices")
        .select("id, invoice_no, status, amount_try, tax_try, total_try, meta, created_at, tenant:tenants(name, tax_office, tax_number)")
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .limit(LINE_INVOICE_LIMIT);
      if (q) iq = iq.ilike("invoice_no", safeLike(q));
      if (period.fromIso) iq = iq.gte("created_at", period.fromIso);
      if (period.toIso) iq = iq.lt("created_at", period.toIso);
      const { data: invoices, error } = await iq;
      if (error) throw new Error(`invoices okunamadı: ${error.message}`);
      const list = (invoices ?? []) as unknown as {
        id: string;
        invoice_no: string;
        status: string;
        amount_try: number;
        tax_try: number;
        total_try: number;
        meta: unknown;
        created_at: string;
        tenant: { name?: string; tax_office?: string; tax_number?: string } | { name?: string; tax_office?: string; tax_number?: string }[] | null;
      }[];
      const linesBy = new Map<string, InvoiceLine[]>();
      for (let i = 0; i < list.length; i += 100) {
        const ids = list.slice(i, i + 100).map((r) => r.id);
        const { data, error: lineError } = await ctx.supabase
          .from("invoice_lines")
          .select("invoice_id, position, description, quantity, unit_net_try, vat_rate, net_try, tax_try, total_try")
          .in("invoice_id", ids)
          .order("position", { ascending: true });
        if (lineError) break; // tablo yoksa (migration bekliyor) satır faturadan türetilir
        for (const r of (data ?? []) as unknown as (RawInvoiceLine & { invoice_id: string })[]) {
          linesBy.set(r.invoice_id, [...(linesBy.get(r.invoice_id) ?? []), fromRawLine(r)]);
        }
      }
      const out: LineRow[] = [];
      for (const inv of list) {
        const t = Array.isArray(inv.tenant) ? inv.tenant[0] : inv.tenant;
        const head = { invoiceNo: inv.invoice_no, status: inv.status, createdAt: inv.created_at, tenantName: t?.name ?? "", taxOffice: t?.tax_office ?? "", taxNumber: t?.tax_number ?? "" };
        for (const line of linesBy.get(inv.id) ?? [synthesizeLine(inv)]) out.push({ ...line, ...head });
      }
      return out;
    },
  },
});

export const PLATFORM_ACCOUNTING_REPORTS = [muhasebeFaturaDefteri, tahsilatYaslandirma, faturaKalemleri];
