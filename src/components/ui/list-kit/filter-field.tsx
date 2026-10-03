import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * FilterSelect — `ListToolbar panel` içi etiketli native <select> (sıfır JS, form GET ile URL'e yazılır).
 * Seçenekler `{ value, label }`; `value: ""` "Tümü" anlamındadır (param silinir).
 */
export function FilterSelect({
  name,
  label,
  value,
  options,
  className,
}: {
  name: string;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  className?: string;
}) {
  return (
    <label className={cn("grid gap-1 text-xs font-semibold text-text-muted", className)}>
      {label}
      <select
        name={name}
        defaultValue={value}
        className="min-h-9 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 text-sm font-normal text-text outline-none transition focus:border-brand-400 focus:bg-surface"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Panel alanlarını iki sütuna dizer (dar ekranda tek sütun). */
export function FilterGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}
