import { cn } from "@/lib/utils";

const fullPrefixFmt = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 0,
});
const fullSuffixFmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

/**
 * MoneyValue — KPI kartlarında para tutarı tek satırda kalır.
 * Her ekranda tam tutar (kısaltma yok); dar alanda yazı boyutu kabın genişliğine göre küçülür.
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
      {full}
    </span>
  );
}
