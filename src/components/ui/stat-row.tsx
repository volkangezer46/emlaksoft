import type { ReactNode } from "react";
import { KpiStrip } from "@/components/ui/list-kit/kpi-strip";

/**
 * StatRow — tıklanabilir KPI şeridi (eski imza korunur). WP3: görünüm liste sayfalarının TEK KPI şerididir (`KpiStrip`,
 * ince kart; telefonda yatay süzgeç şeridi) — ayrı uzun kart/ok düzeni yok. "Sıfır çıkmaz metrik": `href` zorunlu, her öğe
 * filtrelenmiş hedefe gider. Değer 0 ise sönük gösterilir (yine tıklanabilir); `attention` sıfır değilse değer tehlike tonunda.
 * `active`: öğe sayfanın etkin süzgeciyse işaretlenir.
 */
export type StatRowItem = {
  label: string;
  /** Sayı ya da önceden biçimlenmiş metin (ör. "₺1.200.000"). */
  value: number | string;
  href: string;
  /** Kısa ek bilgi (ör. "bu hafta"). */
  hint?: string;
  icon?: ReactNode;
  /** Dikkat gerektiren değer: sıfır değilse vurgulanır. */
  attention?: boolean;
  /** Süzgeç kartı: sayfanın etkin süzgeci bu öğe. */
  active?: boolean;
};

export function StatRow({
  items,
  label = "Özet göstergeler",
  className,
}: {
  items: StatRowItem[];
  label?: string;
  className?: string;
}) {
  return (
    <KpiStrip
      label={label}
      className={className}
      items={items.map((it) => ({
        label: it.label,
        value: it.value,
        href: it.href,
        hint: it.hint,
        icon: it.icon ?? null,
        tone: it.attention ? "danger" : "info",
        attention: it.attention,
        active: it.active,
      }))}
    />
  );
}
