import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { KPI_CAP_DESKTOP, KPI_CAP_PHONE } from "@/components/ui/kpi-cap-limits";

/**
 * KPI şeridi sınırı (tek görünüm, sahip kararı 2026-10-16): şerit GÖRÜNÜR; masaüstünde en çok 6 kart (`.kpi-more-d`
 * gizli), telefonda 2 kart (`.kpi-more` gizli; premium.css `.kpi-compact`). Kalan kartlar "Tüm göstergeler (n)" ile aynı
 * yerde açılır. İSTEMCİ JS'İ YOK (paket bütçesi): durum gizli onay kutusu + etiketle tutulur; sınır ve anahtar yalnız
 * /app kabuğunda uygulanır (`.app-frame`). /admin'de anahtar görünmez, sınır uygulanmaz.
 */
export function KpiCap({ count, children }: { count: number; children: ReactNode }) {
  const id = useId();
  const desk = count > KPI_CAP_DESKTOP;
  const phone = count > KPI_CAP_PHONE;
  if (!desk && !phone) return <div className="kpi-cap">{children}</div>;
  return (
    <div className="kpi-cap" data-cap-phone={phone ? "" : undefined} data-cap-desk={desk ? "" : undefined}>
      <input id={id} type="checkbox" className="kpi-cap-input sr-only" aria-label={`Tüm göstergeler (${count})`} />
      {children}
      <label htmlFor={id} aria-hidden="true" className={cn("kpi-cap-toggle focus-ring press cursor-pointer")}>
        <ChevronDown className="kpi-cap-chev h-4 w-4 transition-transform" />
        <span className="kpi-cap-more">Tüm göstergeler ({count})</span>
        <span className="kpi-cap-less">Daha az gösterge</span>
      </label>
    </div>
  );
}
