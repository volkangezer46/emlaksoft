import { cn } from "@/lib/utils";
import { isRangeInvalid } from "@/lib/ui/filter-params";

/**
 * DateRangeField — iki tarih alanı (başlangıç/bitiş), form GET ile uyumlu (name'li, uncontrolled).
 * Değerler YYYY-MM-DD. Başlangıç > bitiş ise uyarı gösterilir ve alanlar aria-invalid olur.
 */
const INPUT =
  "min-h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-text transition focus:border-brand-400 focus:outline-none focus:shadow-[var(--focus-gap),var(--focus-ring)] aria-[invalid=true]:border-danger-400";

export function DateRangeField({
  legend = "Tarih aralığı",
  fromName = "from",
  toName = "to",
  fromValue,
  toValue,
  fromLabel = "Başlangıç",
  toLabel = "Bitiş",
  idPrefix = "dr",
  className,
}: {
  legend?: string;
  fromName?: string;
  toName?: string;
  fromValue?: string;
  toValue?: string;
  fromLabel?: string;
  toLabel?: string;
  idPrefix?: string;
  className?: string;
}) {
  const invalid = isRangeInvalid(fromValue, toValue);
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="mb-1 text-xs font-semibold text-text-muted">{legend}</legend>
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={`${idPrefix}-from`} className="min-w-36 flex-1 text-xs text-text-muted">
          <span className="mb-0.5 block">{fromLabel}</span>
          <input
            id={`${idPrefix}-from`}
            type="date"
            lang="tr-TR"
            name={fromName}
            defaultValue={fromValue}
            max={toValue || undefined}
            aria-invalid={invalid || undefined}
            className={INPUT}
          />
        </label>
        <label htmlFor={`${idPrefix}-to`} className="min-w-36 flex-1 text-xs text-text-muted">
          <span className="mb-0.5 block">{toLabel}</span>
          <input
            id={`${idPrefix}-to`}
            type="date"
            lang="tr-TR"
            name={toName}
            defaultValue={toValue}
            min={fromValue || undefined}
            aria-invalid={invalid || undefined}
            className={INPUT}
          />
        </label>
      </div>
      {invalid ? (
        <p role="alert" className="mt-1 text-xs text-danger-600">
          Başlangıç tarihi bitişten sonra olamaz.
        </p>
      ) : null}
    </fieldset>
  );
}
