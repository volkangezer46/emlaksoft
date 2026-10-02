import { cn } from "@/lib/utils";

const compactFmt = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  notation: "compact",
  maximumFractionDigits: 1,
});
const fullPrefixFmt = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 0,
});
const fullSuffixFmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

/**
 * MoneyValue — KPI kartlarında para tutarı tek satırda kalır.
 * Mobilde (< sm) kompakt gösterim ("44,3 Mn ₺"), geniş ekranda tam tutar; tam tutar
 * her zaman `title` ile (fare/uzun basış) ve ekran okuyucu için erişilebilir.
 * Tutarı iki satıra kıran/sembolü alta düşüren taşmayı `whitespace-nowrap` önler.
 */
export function MoneyValue({
  amount,
  symbol = "prefix",
  className,
}: {
  amount: number;
  /** prefix: "₺44.300.000"; suffix: "44.300.000 ₺" (sayfanın mevcut biçimi korunur). */
  symbol?: "prefix" | "suffix";
  className?: string;
}) {
  const full = symbol === "prefix" ? fullPrefixFmt.format(amount) : `${fullSuffixFmt.format(amount)} ₺`;
  return (
    <span title={full} className={cn("whitespace-nowrap", className)}>
      <span className="sm:hidden" aria-hidden="true">{compactFmt.format(amount)}</span>
      <span className="hidden sm:inline" aria-hidden="true">{full}</span>
      <span className="sr-only">{full}</span>
    </span>
  );
}
