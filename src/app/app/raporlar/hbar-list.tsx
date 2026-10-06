import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export type HBarItem = {
  key: string;
  label: string;
  /** Filtrelenmiş hedef (sıfır çıkmaz metrik). */
  href: string;
  /** Çubuk dolgusu 0-100 (çağıran hesaplar; bkz. report-math `shareOfMax`). */
  pct: number;
  /** Sağdaki değer metni (tabular). */
  valueText: string;
  /** Etiket altı ince açıklama. */
  sub?: string;
  /** Vurgulu (en iyi) satır. */
  highlight?: boolean;
};

/**
 * HBarList — doğrudan etiketli yatay çubuk listesi (7+ kategoride pasta yerine).
 * Satır yüksekliği >= 40px, değer sağa hizalı tabular-nums, çerçevesiz (kart içinde kart yok).
 * Çubuk ortak `Progress`'tir: dolum tek seferlik (motion-progress-fill), sonsuz animasyon yok.
 * Her satır bir bağlantıdır; çubuk `role=progressbar` olarak değeri ekran okuyucuya da verir.
 */
export function HBarList({
  items,
  tone = "accent",
  ariaLabel,
  className,
}: {
  items: readonly HBarItem[];
  tone?: "accent" | "success" | "warning" | "danger";
  ariaLabel: string;
  className?: string;
}) {
  return (
    <ul aria-label={ariaLabel} className={cn("divide-y divide-line/60", className)}>
      {items.map((it) => (
        <li key={it.key}>
          <Link
            href={it.href}
            className={cn(
              "focus-ring group grid min-h-10 gap-1 rounded-[var(--radius-control)] px-2 py-2 transition hover:bg-surface-hover",
              it.highlight && "bg-surface-selected",
            )}
          >
            <span className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-1.5 font-semibold text-text">
                <span className="truncate text-balance">{it.label}</span>
                {it.highlight ? (
                  <span className="shrink-0 rounded-full bg-accent-subtle px-2 py-0.5 text-xs font-bold text-accent-text">En değerli</span>
                ) : null}
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-text-faint opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
              </span>
              <span className="shrink-0 text-right text-xs tabular-nums text-text-muted">{it.valueText}</span>
            </span>
            {it.sub ? <span className="text-xs text-text-faint">{it.sub}</span> : null}
            <Progress value={it.pct} label={`${it.label}: ${it.valueText}`} tone={tone} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
