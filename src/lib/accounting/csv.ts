/**
 * Muhasebe sayfaları için tarih biçimleyici (SAF). Muhasebeci CSV dışa aktarımı kaldırıldı: dosya üretimi
 * (Excel / PDF / CSV) artık TEK yerde, Rapor merkezi'nde ("muhasebe-fatura-defteri" platform raporu,
 * `src/lib/report-center/catalog/platform-accounting.ts`); aynı okuyucular ve süzgeçler kullanılır.
 */
import { trParts } from "@/lib/clock";

/** ISO an -> TR takvim günü "gg.aa.yyyy" (boşsa ""). */
export function csvDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const p = trParts(t);
  return `${String(p.day).padStart(2, "0")}.${String(p.month + 1).padStart(2, "0")}.${p.year}`;
}
