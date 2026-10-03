import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ViewSwitcher — Liste / Kart / Galeri / Harita anahtarı (URL: ?gorunum=).
 * YALNIZ verilen görünümler çizilir: sayfada karşılığı olmayan görünüm için
 * sahte düğme yoktur. Tek görünüm varsa anahtar hiç çizilmez.
 */
export type ViewOption = { value: string; label: string; icon: LucideIcon; href: string };

export function ViewSwitcher({
  options,
  active,
  label = "Görünüm",
  className,
}: {
  options: readonly ViewOption[];
  active: string;
  label?: string;
  className?: string;
}) {
  if (options.length < 2) return null;
  return (
    <nav
      aria-label={label}
      className={cn("inline-flex items-center gap-0.5 rounded-[var(--radius-control)] border border-line bg-canvas p-0.5", className)}
    >
      {options.map((o) => {
        const on = o.value === active;
        return (
          <Link
            key={o.value}
            href={o.href}
            aria-current={on ? "page" : undefined}
            aria-label={o.label}
            className={cn(
              "focus-ring press inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-sm font-semibold transition",
              on ? "bg-surface text-brand-700 shadow-[var(--elev-1)]" : "text-text-muted hover:text-text",
            )}
          >
            <o.icon aria-hidden="true" className="h-4 w-4" />
            <span className="hidden sm:inline">{o.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
