"use client";

import { useId, useState } from "react";
import type { ChangeEvent, InputHTMLAttributes, Ref } from "react";
import { cn } from "@/lib/utils";

/**
 * FileInput — yerel (tarayıcı dilinde "Choose file / No file chosen") dosya girişi yerine
 * Türkçe "Dosya seç" düğmesi + seçilen dosya adı. Gerçek `<input type="file">` ekran okuyucu ve form
 * gönderimi için DOM'da kalır (sr-only); `ref`, `name`, `accept`, `onChange` aynen çalışır.
 */
export type FileInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  ref?: Ref<HTMLInputElement>;
  className?: string;
  /** Düğme metni (varsayılan "Dosya seç"). */
  buttonLabel?: string;
  /** Dosya seçilmediğinde gösterilen metin. */
  emptyLabel?: string;
};

export function FileInput({
  id,
  className,
  buttonLabel = "Dosya seç",
  emptyLabel = "Dosya seçilmedi",
  onChange,
  multiple,
  ref,
  ...rest
}: FileInputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [names, setNames] = useState<string[]>([]);

  function handle(e: ChangeEvent<HTMLInputElement>) {
    setNames(Array.from(e.target.files ?? []).map((f) => f.name));
    onChange?.(e);
  }

  const text = names.length === 0 ? emptyLabel : names.length === 1 ? names[0] : `${names.length} dosya seçildi`;

  return (
    <div className={cn("flex min-w-0 max-w-full items-center gap-3", className)}>
      <input {...rest} ref={ref} id={inputId} type="file" multiple={multiple} onChange={handle} className="peer sr-only" />
      <label
        htmlFor={inputId}
        className="inline-flex min-h-9 shrink-0 cursor-pointer items-center rounded-[var(--radius-control)] bg-brand-600/10 px-3 py-2 text-xs font-bold text-brand-700 transition hover:bg-brand-600/15 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-400 peer-disabled:cursor-not-allowed peer-disabled:opacity-60"
      >
        {buttonLabel}
      </label>
      <span className="min-w-0 truncate text-xs text-text-muted" title={names.join(", ") || undefined}>
        {text}
      </span>
    </div>
  );
}
