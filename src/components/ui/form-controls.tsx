import { Children, cloneElement, isValidElement } from "react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { errorNextStep, fieldAriaProps, type NextStep } from "@/lib/form-logic";

/**
 * Form alanı sistemi — "Yeni X" formları için tek kaynak.
 *
 * - `fieldClass`: tüm alanların stili (aria-invalid ile danger kenar otomatik).
 * - `FormField`: label + htmlFor + gerekli işareti + ipucu + hata; tek çocuğa
 *   id / aria-required / aria-invalid / aria-describedby enjekte eder.
 * - `FormError`: role=alert hata bandı (+ isteğe bağlı "sonraki adım" bağlantısı).
 */
export const fieldClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger-400";

export function FormInput({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldClass, className)} {...props} />;
}

export function FormTextarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(fieldClass, "resize-none", className)} {...props} />;
}

export function FormSelect({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(fieldClass, className)} {...props} />;
}

export function FormField({
  label,
  htmlFor,
  required,
  hint,
  error,
  inject = true,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor: string;
  /** Gerekli işareti + aria-required. */
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  /** false: çocuk özel bir bileşense (ör. Radix Select) aria öznitelikleri elle verilir. */
  inject?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const aria = fieldAriaProps({ id: htmlFor, required, error, hint: Boolean(hint) });
  const only = Children.count(children) === 1 ? Children.toArray(children)[0] : null;
  const control =
    inject && isValidElement(only)
      ? cloneElement(only as ReactElement<Record<string, unknown>>, {
          ...aria,
          ...(only.props as Record<string, unknown>),
        })
      : children;

  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink-950">
        {label}
        {required ? <span aria-hidden="true" className="ml-0.5 text-danger-500">*</span> : null}
      </label>
      {control}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1 text-xs font-medium text-danger-600">{error}</p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="mt-1 text-xs text-text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

/** Form üstü/altı hata bandı. `nextStep` verilmezse hata metninden türetilir. */
export function FormError({
  error,
  nextStep,
  className,
}: {
  error?: string | null;
  nextStep?: NextStep | null;
  className?: string;
}) {
  if (!error) return null;
  const step = nextStep === undefined ? errorNextStep(error) : nextStep;
  return (
    <div
      role="alert"
      className={cn("rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600", className)}
    >
      <p>{error}</p>
      {step ? (
        <Link href={step.href} className="mt-1 inline-block text-xs font-semibold underline underline-offset-2">
          {step.label}
        </Link>
      ) : null}
    </div>
  );
}
