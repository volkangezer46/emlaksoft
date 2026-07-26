import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Form alanı sistemi — tek reçete + hata durumu.
 *
 * Projede üç farklı input zemini yaşıyordu ve hiçbir alanda invalid stili
 * yoktu. Standart: gömülü (sunken) zemin, odakta yüzeye çıkar + marka kenar,
 * `aria-invalid` ile danger kenar/halka otomatik bağlanır.
 */
const FIELD_BASE =
  "surface-sunken w-full rounded-[10px] border border-hairline px-3.5 py-2.5 text-sm text-ink-950 placeholder:text-text-faint transition focus:border-brand-400 focus:bg-surface focus:outline-none focus:shadow-[var(--focus-gap),var(--focus-ring)] aria-[invalid=true]:border-danger-400 aria-[invalid=true]:focus:shadow-[0_0_0_2px_var(--surface),0_0_0_4px_rgba(229,72,77,0.28)]";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(FIELD_BASE, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(FIELD_BASE, "min-h-24", className)} {...props} />;
}

/**
 * FormField — label (12px/600) + alan + hint/error tek düzende.
 * `error` verildiğinde hint yerine hata gösterilir; alanın kendisine
 * `aria-invalid` vermeyi unutmayın (Input stili ona bağlı).
 *
 * ERİŞİLEBİLİRLİK: `htmlFor` verildiğinde hata/ipucu paragrafları
 * `${htmlFor}-error` / `${htmlFor}-hint` id'leriyle basılır — alana
 * `aria-describedby={fieldDescribedBy(id, !!error)}` bağlayarak ekran
 * okuyucunun mesajı alanla birlikte okuması sağlanır. Geriye uyumlu:
 * id vermeyen mevcut kullanımlar aynen çalışır.
 */
export function fieldDescribedBy(id: string | undefined, hasError: boolean) {
  if (!id) return undefined;
  return hasError ? `${id}-error` : `${id}-hint`;
}

export function FormField({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-ink-950">
        {label}
        {required && <span className="ml-0.5 text-danger-500">*</span>}
      </label>
      {children}
      {error ? (
        <p
          id={htmlFor ? `${htmlFor}-error` : undefined}
          className="text-xs font-medium text-danger-600"
          role="alert"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="text-xs text-text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
