/**
 * TL kredi cüzdanı — SAF görünüm modeli (zaman/Date.now YOK: `nowMs` parametredir; bileşen `now()` (clock.ts) verir).
 * Her görünen sayı tıklanabilir bir hedefe bağlanır (sıfır çıkmaz metrik): hedefler `TRY_WALLET_LINKS`.
 */
import { TRY_GRANT_KIND_LABELS, TRY_WALLET_LINKS, type TryGrantKind } from "./constants";
import type { TryOverview } from "./config";
import { maxCreditForInvoice } from "./invoice-credit";
import type { TryMovementRow } from "./reader";

export { TRY_WALLET_LINKS };

export function invoiceLink(invoiceId: string): string {
  return `/app/abonelik/fatura/${invoiceId}`;
}

const SOURCE_LABELS: Record<string, string> = {
  referral: "Tavsiye ödülü",
  partner: "Ortaklık ödülü",
  campaign: "Kampanya kredisi",
  manual: "Yönetici yüklemesi",
  bonus: "Hediye kredi",
  refund: "İade edilen kredi",
  usage: "Fatura ödemesi",
  plan: "Paket kredisi",
  purchase: "Satın alma",
};

export type MovementView = {
  id: number;
  label: string;
  detail: string | null;
  amountTry: number;
  kind: "in" | "out";
  at: string;
  expiresAt: string | null;
};

export function describeMovement(row: TryMovementRow): MovementView {
  const out = row.amount < 0;
  let label: string;
  if (row.entryType === "spend") label = "Fatura ödemesinde kullanıldı";
  else if (row.entryType === "reverse" && out) label = "Kredi geri alındı";
  else if (row.entryType === "reverse") label = row.feature === "invoice_refund" ? "İade: kullanılan kredi geri yazıldı" : "Kredi iadesi";
  else if (row.entryType === "expire") label = "Süresi dolan kredi";
  else if (row.entryType === "adjust") label = "Düzeltme";
  else label = SOURCE_LABELS[row.source] ?? TRY_GRANT_KIND_LABELS[row.source as TryGrantKind] ?? "Kredi yüklemesi";
  return {
    id: row.id,
    label,
    detail: row.expiresAt ? "Vadeli kredi" : null,
    amountTry: row.amount,
    kind: out ? "out" : "in",
    at: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

/** Vade metni: "12 gün sonra" / "bugün" / "süresi doldu". */
export function expiryText(expiresAt: string | null, nowMs: number): string | null {
  if (!expiresAt) return null;
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.ceil((t - nowMs) / 86_400_000);
  if (t <= nowMs) return "süresi doldu";
  if (days <= 1) return "bugün/yarın sona erer";
  return `${days} gün sonra sona erer`;
}

export type WalletSummary = {
  /** Harcanabilir tutar (açık rezervler düşülmüş). */
  availableTry: number;
  /** Ham bakiye (clawback sonrası eksi olabilir). */
  balanceTry: number;
  reservedTry: number;
  debtTry: number;
  negative: boolean;
  expiringTry: number;
  nextExpiryText: string | null;
  /** Örnek bir faturada ("sonraki ödemeniz") uygulanabilecek en yüksek kredi. */
  exampleCap: (invoiceTotalTry: number, maxShare: number) => number;
};

export function summarizeWallet(overview: TryOverview, nowMs: number): WalletSummary {
  return {
    availableTry: overview.available,
    balanceTry: overview.balance,
    reservedTry: overview.reserved,
    debtTry: overview.debt,
    negative: overview.balance < 0,
    expiringTry: overview.expiring_amount,
    nextExpiryText: expiryText(overview.next_expiry_at, nowMs),
    exampleCap: (invoiceTotalTry, maxShare) =>
      maxCreditForInvoice({ totalTry: invoiceTotalTry, availableTry: overview.available, maxShare }),
  };
}

const tl2 = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function formatTry(n: number): string {
  return `${tl2.format(n)} ₺`;
}

/** Pay → "%50" */
export function formatShare(maxShare: number): string {
  return `%${Math.round(maxShare * 100)}`;
}
