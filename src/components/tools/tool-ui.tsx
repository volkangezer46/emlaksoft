"use client";

import { useId, type ReactNode } from "react";

export const INPUT_CLS =
  "h-11 w-full rounded-[var(--radius-control)] border bg-surface px-3 text-base text-ink-950 placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

export function ToolField({
  label,
  hint,
  unit,
  value,
  onChange,
  invalid,
  placeholder,
}: {
  label: string;
  hint: string;
  unit?: string;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink-950">
        {label}
      </label>
      <div className="relative mt-1.5">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          aria-invalid={invalid}
          aria-describedby={`${id}-hint`}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CLS} ${unit ? "pr-9" : ""} ${invalid ? "border-danger-600" : "border-line-strong"}`}
        />
        {unit ? (
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-sm text-text-muted">
            {unit}
          </span>
        ) : null}
      </div>
      <p id={`${id}-hint`} className={`mt-1 text-xs ${invalid ? "font-semibold text-danger-700" : "text-text-muted"}`}>
        {invalid ? "Geçerli bir sayı girin (örn. 1.500.000 veya 2,5)." : hint}
      </p>
    </div>
  );
}

export function ToolShellLayout({
  form,
  resultTitle,
  children,
  onReset,
  disclaimer,
}: {
  form: ReactNode;
  resultTitle: string;
  children: ReactNode;
  onReset: () => void;
  disclaimer: string;
}) {
  const id = useId();
  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <form
        className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-sm)] sm:p-7"
        onSubmit={(e) => e.preventDefault()}
        noValidate
      >
        <div className="grid gap-5 sm:grid-cols-2">{form}</div>
        <button
          type="button"
          onClick={onReset}
          className="mt-5 inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Girdileri temizle
        </button>
      </form>
      <section aria-labelledby={`${id}-sonuc`} className="rounded-[var(--radius-panel)] border border-line bg-surface-2 p-5 sm:p-7">
        <h2 id={`${id}-sonuc`} className="font-display text-lg font-bold text-ink-950">
          {resultTitle}
        </h2>
        <div aria-live="polite" aria-atomic="true" className="mt-4">
          {children}
        </div>
        <p className="mt-5 text-xs leading-relaxed text-text-muted">{disclaimer}</p>
      </section>
    </div>
  );
}

export function Row({ dt, dd }: { dt: string; dd: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-text-muted">{dt}</dt>
      <dd className="text-right font-semibold tabular-nums text-ink-950">{dd}</dd>
    </div>
  );
}

export function EmptyMsg({ invalid }: { invalid: boolean }) {
  return (
    <p className="text-sm text-text-muted">
      {invalid
        ? "Kırmızı işaretli alanlara geçerli bir sayı girdiğinizde sonuç hesaplanır."
        : "Sayıları girin; sonuç burada, formülüyle birlikte görünür. Girdiğiniz veriler sunucuya gönderilmez."}
    </p>
  );
}
