import { CountUp } from "@/components/ui/count-up";

/**
 * Eski ad — tek sayaç artık `CountUp` (ilk görünümde bir kez sayar, sonuç SSR'da basılır,
 * reduced-motion'da durağan). Dikey kayan basamak (odometre) süs sayıldığı için kaldırıldı;
 * ekran okuyucu zaten gerçek metni okur.
 */
export function OdometerNumber({ value, className = "" }: { value: string; className?: string }) {
  return <CountUp value={value} className={className} />;
}
