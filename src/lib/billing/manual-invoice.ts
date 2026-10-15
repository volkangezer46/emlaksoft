/**
 * Elle fatura / tek seferlik ücret (AD2) — SAF yardımcılar (sunucu, istemci ön izlemesi ve test ortak).
 * Kural: satır neti = miktar × KDV hariç birim fiyat (kuruşa yuvarlı), satır KDV'si = net × oran (kuruşa yuvarlı),
 * toplam = net + KDV. Fatura tutarları satır toplamıdır (SQL `platform_create_manual_invoice` aynı tutarlılığı doğrular).
 * Abonelik bağı yoktur: fatura MRR'a girmez; tahsilat ve muhasebe ekranlarına "Tek seferlik" türüyle girer.
 */
import { MAX_MONEY_TRY } from "@/lib/billing/invoice-ops";
import { parseMoneyInput } from "@/lib/money-input";

export const MANUAL_INVOICE_CATEGORIES = [
  { value: "kurulum", label: "Kurulum ücreti" },
  { value: "egitim", label: "Eğitim" },
  { value: "yillik", label: "Yıllık ödeme (elle)" },
  { value: "diger", label: "Diğer hizmet" },
] as const;
export type ManualInvoiceCategory = (typeof MANUAL_INVOICE_CATEGORIES)[number]["value"];

export function manualCategoryLabel(v: unknown): string {
  return MANUAL_INVOICE_CATEGORIES.find((c) => c.value === v)?.label ?? "Tek seferlik ücret";
}

export const MAX_MANUAL_LINES = 50;

export type ManualLineInput = { description: string; quantity: string; unitNet: string };

export type InvoiceLine = {
  position: number;
  description: string;
  quantity: number;
  unitNetTry: number;
  /** 0..<1 (0,2 = %20). */
  vatRate: number;
  netTry: number;
  taxTry: number;
  totalTry: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** KDV hariç birim fiyat: "2.500", "2500", "2.500,50" (TR gruplama) → TL; boş/sıfır/eksi/bozuk null. */
export function parseUnitPrice(raw: string): number | null {
  const r = parseMoneyInput(raw, { max: MAX_MONEY_TRY });
  return r.ok && r.value !== null && r.value > 0 ? Math.round(r.value * 100) / 100 : null;
}

/** "1", "2,5" → sayı (0 < x ≤ 100.000, en çok 2 ondalık); geçersiz null. */
export function parseQuantity(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 100_000 ? n : null;
}

export function computeLine(position: number, description: string, quantity: number, unitNetTry: number, vatRate: number): InvoiceLine {
  const netTry = r2(quantity * unitNetTry);
  const taxTry = r2(netTry * vatRate);
  return { position, description, quantity, unitNetTry, vatRate, netTry, taxTry, totalTry: r2(netTry + taxTry) };
}

/** Satırda herhangi bir alan dolu mu (tamamen boş satır atlanır; miktarın varsayılan "1"i tek başına doluluk sayılmaz). */
export function isManualLineFilled(l: ManualLineInput): boolean {
  return Boolean(l.description.trim() || l.unitNet.trim() || (l.quantity.trim() && l.quantity.trim() !== "1"));
}

export type ManualLineIssue = { field: "description" | "quantity" | "unitNet"; message: string };

/**
 * Tek satır doğrulaması — istemci (satır içi hata, düğme kapısı) ve sunucu (buildManualLines) AYNI kural (SK6/B112).
 * Boş satır null (atlanır). Geçersiz kalem artık önizlemeden sessizce düşüp sunucuda reddedilmez: düğme kapalı kalır.
 */
export function manualLineIssue(l: ManualLineInput): ManualLineIssue | null {
  if (!isManualLineFilled(l)) return null;
  const description = l.description.trim().replace(/\s+/g, " ");
  if (description.length < 2 || description.length > 200) return { field: "description", message: "açıklama 2-200 karakter olmalı." };
  if (parseQuantity(l.quantity || "1") === null) return { field: "quantity", message: "miktar geçersiz (0'dan büyük, en çok 2 ondalık)." };
  if (parseUnitPrice(l.unitNet) === null) return { field: "unitNet", message: "birim fiyat geçersiz (KDV hariç, pozitif)." };
  return null;
}

/** Form satırlarını doğrular ve hesaplar; tamamen boş satırlar atlanır. */
export function buildManualLines(inputs: readonly ManualLineInput[], vatRate: number): { lines: InvoiceLine[] } | { error: string } {
  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate >= 1) return { error: "KDV oranı geçersiz." };
  const filled = inputs.filter(isManualLineFilled);
  if (filled.length === 0) return { error: "En az bir kalem girin." };
  if (filled.length > MAX_MANUAL_LINES) return { error: `En çok ${MAX_MANUAL_LINES} kalem girilebilir.` };
  const lines: InvoiceLine[] = [];
  for (const [i, l] of filled.entries()) {
    const n = i + 1;
    const issue = manualLineIssue(l);
    if (issue) return { error: `${n}. kalem: ${issue.message}` };
    const description = l.description.trim().replace(/\s+/g, " ");
    lines.push(computeLine(n, description, parseQuantity(l.quantity || "1")!, parseUnitPrice(l.unitNet)!, vatRate));
  }
  const t = sumLines(lines);
  if (t.totalTry > MAX_MONEY_TRY) return { error: "Fatura toplamı üst sınırı aşıyor." };
  return { lines };
}

export function sumLines(lines: readonly Pick<InvoiceLine, "netTry" | "taxTry" | "totalTry">[]): { amountTry: number; taxTry: number; totalTry: number } {
  let net = 0;
  let tax = 0;
  for (const l of lines) {
    net += Math.round(l.netTry * 100);
    tax += Math.round(l.taxTry * 100);
  }
  return { amountTry: net / 100, taxTry: tax / 100, totalTry: (net + tax) / 100 };
}

/** RPC yükü (snake_case). */
export function linesToRpc(lines: readonly InvoiceLine[]) {
  return lines.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unit_net_try: l.unitNetTry,
    vat_rate: l.vatRate,
    net_try: l.netTry,
    tax_try: l.taxTry,
    total_try: l.totalTry,
  }));
}

export type RawInvoiceLine = {
  position: number | string;
  description: string;
  quantity: number | string;
  unit_net_try: number | string;
  vat_rate: number | string;
  net_try: number | string;
  tax_try: number | string;
  total_try: number | string;
};

export function fromRawLine(r: RawInvoiceLine): InvoiceLine {
  return {
    position: Number(r.position),
    description: r.description,
    quantity: Number(r.quantity),
    unitNetTry: Number(r.unit_net_try),
    vatRate: Number(r.vat_rate),
    netTry: Number(r.net_try),
    taxTry: Number(r.tax_try),
    totalTry: Number(r.total_try),
  };
}

/**
 * Otomatik faturanın tek satır açıklaması (fatura meta'sından). AD2 geriye dönük doldurması (20261013004100) ve otomatik
 * kesilen faturanın yazdığı satır (`autoInvoiceLineRow`) aynı metni kullanır.
 */
export function invoiceLineDescription(metaRaw: unknown): string {
  const meta = (metaRaw && typeof metaRaw === "object" ? metaRaw : {}) as Record<string, unknown>;
  const kind = typeof meta.kind === "string" ? meta.kind : "";
  return kind === "extra_seats"
    ? "Ek kullanıcı"
    : kind === "credit_pack"
      ? "EmlakFiyatı analiz bakiyesi paketi"
      : kind === "plan_upgrade"
        ? "Paket yükseltme farkı"
        : typeof meta.plan === "string" && meta.plan
          ? `Abonelik: ${meta.plan.slice(0, 60)}`
          : "Hizmet bedeli";
}

/** Satırı olmayan (otomatik kesilmiş ya da migration öncesi) fatura için tek satır: tutarlar faturadan aynen. */
export function synthesizeLine(inv: { amount_try: unknown; tax_try: unknown; total_try: unknown; meta?: unknown }): InvoiceLine {
  const net = Number(inv.amount_try ?? 0) || 0;
  const tax = Number(inv.tax_try ?? 0) || 0;
  const description = invoiceLineDescription(inv.meta);
  return {
    position: 1,
    description,
    quantity: 1,
    unitNetTry: net,
    vatRate: net > 0 ? Math.round((tax / net) * 10000) / 10000 : 0,
    netTry: net,
    taxTry: tax,
    totalTry: Number(inv.total_try ?? net + tax) || r2(net + tax),
  };
}

/** Elle fatura mı (taslak > kesildi akışı yalnız bunlarda)? */
export function isManualInvoice(meta: unknown): boolean {
  const m = (meta && typeof meta === "object" ? meta : {}) as Record<string, unknown>;
  return m.kind === "one_time" && Boolean(m.manual_invoice);
}

/** Taslaktaki elle fatura kesilebilir mi (ödeme oturumu yok)? */
export function canIssueManual(inv: { status: string; checkout_status?: string | null; meta?: unknown }): boolean {
  return inv.status === "draft" && !inv.checkout_status && isManualInvoice(inv.meta);
}

const tryFmt = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n);

/** Fatura e-postası (düz metin; HTML yok). Satırlar + toplamlar + vade; ödeme bağlantısı içermez. */
export function buildInvoiceEmail(input: {
  invoiceNo: string;
  tenantName: string;
  lines: readonly InvoiceLine[];
  amountTry: number;
  taxTry: number;
  totalTry: number;
  dueLabel: string | null;
  statusLabel: string;
}): { subject: string; text: string } {
  const rows = input.lines.map(
    (l) =>
      `${l.position}. ${l.description} — ${String(l.quantity).replace(".", ",")} x ${tryFmt(l.unitNetTry)} + %${Math.round(l.vatRate * 10000) / 100} KDV = ${tryFmt(l.totalTry)}`,
  );
  const text = [
    `Sayın ${input.tenantName || "Müşterimiz"},`,
    "",
    `${input.invoiceNo} numaralı faturanızın dökümü aşağıdadır (durum: ${input.statusLabel}).`,
    "",
    ...rows,
    "",
    `Ara toplam (KDV hariç): ${tryFmt(input.amountTry)}`,
    `KDV: ${tryFmt(input.taxTry)}`,
    `Genel toplam: ${tryFmt(input.totalTry)}`,
    ...(input.dueLabel ? [`Son ödeme tarihi: ${input.dueLabel}`] : []),
    "",
    "Faturanızı EmlakSoft panelinde Abonelik sayfasından görebilirsiniz. Sorularınız için bu e-postayı yanıtlayabilirsiniz.",
    "",
    "EmlakSoft",
  ].join("\n");
  return { subject: `EmlakSoft fatura ${input.invoiceNo}`, text };
}

/** Kesimde vade: kesim anı + gün (gün 0 = aynı an). */
export function manualDueIso(issuedAtMs: number, dueDays: number): string {
  const days = Number.isFinite(dueDays) ? Math.max(0, Math.min(120, Math.floor(dueDays))) : 14;
  return new Date(issuedAtMs + days * 86_400_000).toISOString();
}
