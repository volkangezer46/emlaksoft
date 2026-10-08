"use client";

import { cn } from "@/lib/utils";

/**
 * Tıklanabilir lejant (Recharts İÇERMEZ). Tıklayınca seri/dilim gösterilir-gizlenir; en az bir öğe her zaman açık kalır
 * (boş grafik çizilmez). Üzerine gelince `onHover` ile ilgili öğe vurgulanır. Renk tek başına anlam taşımaz:
 * gizli öğe üstü çizili + soluk, `aria-pressed` ile duyurulur.
 */
export type ChartLegendItem = {
  key: string;
  label: string;
  color: string;
  /** Etiketin yanında küçük ek (ör. "%23"). */
  suffix?: string;
  dashed?: boolean;
};

export function ChartLegend({
  items,
  hidden,
  onToggle,
  onHover,
  className,
}: {
  items: readonly ChartLegendItem[];
  hidden: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onHover?: (key: string | null) => void;
  className?: string;
}) {
  const visibleCount = items.filter((i) => !hidden.has(i.key)).length;
  return (
    <ul className={cn("flex flex-wrap items-center justify-center gap-x-1 gap-y-1", className)} aria-label="Grafik göstergesi">
      {items.map((item) => {
        const off = hidden.has(item.key);
        const lastVisible = !off && visibleCount <= 1;
        return (
          <li key={item.key}>
            <button
              type="button"
              aria-pressed={!off}
              onClick={() => {
                if (lastVisible) return;
                onToggle(item.key);
              }}
              onPointerEnter={() => onHover?.(item.key)}
              onPointerLeave={() => onHover?.(null)}
              onFocus={() => onHover?.(item.key)}
              onBlur={() => onHover?.(null)}
              title={off ? "Göstermek için tıklayın" : lastVisible ? item.label : "Gizlemek için tıklayın"}
              className={cn(
                "focus-ring inline-flex min-h-7 items-center gap-1.5 rounded-full px-2 text-xs font-medium transition-colors hover:bg-surface-hover",
                off ? "text-text-faint line-through opacity-60" : "text-text-muted",
              )}
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: off ? "transparent" : item.color, boxShadow: `inset 0 0 0 1.5px ${item.color}` }}
              />
              {item.label}
              {item.suffix ? <span className="numeric font-semibold text-text-faint">{item.suffix}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
