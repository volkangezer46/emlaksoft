import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * BulkBar — toplu işlem çubuğu kabuğu (seçim sayısı + eylemler + temizle).
 * Saf sunum: seçim durumu ve eylemler çağıranın (istemci sağlayıcısının) işidir;
 * çubuk yalnız seçim varken çağıran tarafından çizilir. Satırların üstünde
 * sticky durur, böylece uzun listede de eylemler erişilebilir kalır.
 */
export function BulkBar({
  count,
  noun,
  onClear,
  children,
  className,
}: {
  count: number;
  /** "portföy", "müşteri" … */
  noun: string;
  onClear: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="region"
      aria-label="Toplu işlemler"
      className={cn(
        "sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-brand-300/50 bg-surface px-4 py-2.5 shadow-[var(--shadow-lg)]",
        className,
      )}
    >
      <span className="numeric text-sm font-semibold text-brand-700">
        {count} {noun} seçildi
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <button
        type="button"
        onClick={onClear}
        aria-label="Seçimi temizle"
        className="focus-ring ml-auto grid h-8 w-8 touch:h-11 touch:w-11 place-items-center rounded-[var(--radius-control)] text-text-muted transition hover:bg-surface-hover hover:text-text active:bg-surface-pressed"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}
